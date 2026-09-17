import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { cartItems, checkoutSessionItems, checkoutSessions } from '@repo/db';
import type Env from '@/types/env';
import { errorJson } from '@/utils/errorJson';
import {
  getOrCreateCart,
  guestIdFromHeader,
  mergeGuestCartIntoUser,
  requireJson,
  requireStoreUser,
  requireTrustedMutationOrigin,
  skuSnapshot,
} from './cart';
import {
  requestOriginFromUrl,
  resolveProductImageUrlForClient,
} from '@/utils/productImageHost';

const storeCheckout = new Hono<{ Bindings: Env }>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function sessionResponse(session: typeof checkoutSessions.$inferSelect, items: (typeof checkoutSessionItems.$inferSelect)[]) {
  return {
    id: session.id,
    source: session.source,
    status: session.status,
    expiresAt: session.expiresAt.toISOString(),
    items,
    total: items.reduce((sum, item) => sum + item.quantity * item.unitPriceSnapshot, 0),
  };
}

storeCheckout.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  c.header('Vary', 'Cookie');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});

storeCheckout.post('/cart', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;
    // A guest cart lingering from before login is folded in so checkout matches
    // what the shopper actually placed.
    const guestId = guestIdFromHeader(c);
    if (guestId) await mergeGuestCartIntoUser(access.db, access.user.id, guestId);
    const cart = await getOrCreateCart(access.db, { userId: access.user.id });
    const items = await access.db.select().from(cartItems).where(eq(cartItems.cartId, cart.id));
    if (items.length === 0) return errorJson(c, 400, 'EMPTY_CART', 'Add an item before starting checkout.');
    const now = new Date();
    const session = {
      id: nanoid(),
      userId: access.user.id,
      source: 'cart' as const,
      status: 'pending' as const,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      createdAt: now,
      updatedAt: now,
    };
    const statements = [
      access.db.insert(checkoutSessions).values(session),
      ...items.map((item) =>
        access.db.insert(checkoutSessionItems).values({
          id: nanoid(),
          sessionId: session.id,
          productId: item.productId,
          skuId: item.skuId,
          quantity: item.quantity,
          unitPriceSnapshot: item.unitPriceSnapshot,
          compareAtPriceSnapshot: item.compareAtPriceSnapshot,
          productNameSnapshot: item.productNameSnapshot,
          productSlugSnapshot: item.productSlugSnapshot,
          variantLabelSnapshot: item.variantLabelSnapshot,
          imageSnapshot: item.imageSnapshot,
          createdAt: now,
        })
      ),
    ];
    await access.db.batch(
      statements as [
        (typeof statements)[number],
        ...(typeof statements)[number][],
      ]
    );
    return c.json({ success: true, data: { sessionId: session.id } }, 201);
  } catch (error) {
    console.error('store checkout: cart session failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to start checkout.');
  }
});

storeCheckout.post('/buy-now', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const bodyError = requireJson(c);
    if (bodyError) return bodyError;
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;
    const body = await c.req.json<unknown>();
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    const skuId = typeof input?.skuId === 'string' ? input.skuId.trim() : '';
    const quantity = typeof input?.quantity === 'number' && Number.isInteger(input.quantity) ? input.quantity : NaN;
    if (!skuId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return errorJson(c, 400, 'INVALID_ITEM', 'A valid skuId and quantity are required.');
    const snapshot = await skuSnapshot(access.db, skuId);
    if (!snapshot) return errorJson(c, 404, 'SKU_NOT_FOUND', 'That product variant no longer exists.');
    if (snapshot.sku.stock < quantity) return errorJson(c, 409, 'INSUFFICIENT_STOCK', 'The requested quantity is not available.');
    const now = new Date();
    const session = {
      id: nanoid(),
      userId: access.user.id,
      source: 'buy_now' as const,
      status: 'pending' as const,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      createdAt: now,
      updatedAt: now,
    };
    const item = {
      id: nanoid(),
      sessionId: session.id,
      productId: snapshot.product.id,
      skuId,
      quantity,
      unitPriceSnapshot: snapshot.sku.price,
      compareAtPriceSnapshot: snapshot.sku.compareAtPrice,
      productNameSnapshot: snapshot.product.name,
      variantLabelSnapshot: snapshot.label,
      imageSnapshot: Array.isArray(snapshot.product.images) && snapshot.product.images[0] && typeof snapshot.product.images[0] === 'object'
        ? snapshot.product.images[0].url ?? null
        : null,
      productSlugSnapshot: snapshot.product.slug,
      createdAt: now,
    };
    await access.db.batch([
      access.db.insert(checkoutSessions).values(session),
      access.db.insert(checkoutSessionItems).values(item),
    ]);
    return c.json({ success: true, data: { sessionId: session.id } }, 201);
  } catch (error) {
    console.error('store checkout: buy-now session failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to start checkout.');
  }
});

storeCheckout.get('/:sessionId', async (c) => {
  try {
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;
    const [session] = await access.db.select().from(checkoutSessions).where(and(
      eq(checkoutSessions.id, c.req.param('sessionId')),
      eq(checkoutSessions.userId, access.user.id),
    )).limit(1);
    if (!session) return errorJson(c, 404, 'CHECKOUT_NOT_FOUND', 'Checkout session not found.');
    if (session.expiresAt.getTime() <= Date.now() && session.status === 'pending') {
      await access.db.update(checkoutSessions).set({ status: 'expired', updatedAt: new Date() }).where(eq(checkoutSessions.id, session.id));
      return errorJson(c, 410, 'CHECKOUT_EXPIRED', 'This checkout session has expired.');
    }
    const items = await access.db.select().from(checkoutSessionItems).where(eq(checkoutSessionItems.sessionId, session.id));
    const origin = requestOriginFromUrl(c.req.url);
    return c.json({
      success: true,
      data: {
        ...sessionResponse(session, items),
        items: items.map((item) => ({
          ...item,
          imageSnapshot: item.imageSnapshot
            ? resolveProductImageUrlForClient(item.imageSnapshot, c.env, { origin }) ||
              item.imageSnapshot
            : null,
          href: `/product/${encodeURIComponent(item.productSlugSnapshot)}`,
        })),
      },
    });
  } catch (error) {
    console.error('store checkout: session load failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to load checkout.');
  }
});

storeCheckout.all('*', (c) => errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));

export default storeCheckout;