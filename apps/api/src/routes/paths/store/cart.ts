import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  cartItems,
  carts,
  createDb,
  productSkus,
  products,
  skuProperties,
  users,
} from '@repo/db';
import { createAuth } from '@repo/auth/server';
import type Env from '@/types/env';
import { errorJson, type EnvContext } from '@/utils/errorJson';
import config from '@/mine.config';
import {
  requestOriginFromUrl,
  resolveProductImageUrlForClient,
} from '@/utils/productImageHost';

const storeCart = new Hono<{ Bindings: Env }>();
const MAX_QUANTITY = 99;

function authForRequest(c: { env: Env; req: { raw: Request } }) {
  const db = createDb(c.env.DB);
  const auth = createAuth(db, {
    GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
    NODE_ENV: c.env.NODE_ENV,
    API_URL: c.env.API_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    ORIGINS: c.env.ORIGINS,
    DOMAIN: c.env.DOMAIN,
  });
  return { db, auth };
}

export async function requireStoreUser(c: EnvContext) {
  const { db, auth } = authForRequest(c);
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user?.id || !session.session?.id) {
      return { ok: false as const, response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.') };
    }
    const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
    if (!user || user.isDeleted || user.isBanned) {
      return { ok: false as const, response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.') };
    }
    return { ok: true as const, db, user };
  } catch (error) {
    console.error('store cart: session lookup failed', error);
    return { ok: false as const, response: errorJson(c, 500, 'SESSION_ERROR', 'Unable to verify your session.') };
  }
}

function allowedOrigins(env: Env): Set<string> {
  const configured = env.ORIGINS?.split(',').map((value) => value.trim().replace(/\/$/, '')).filter(Boolean);
  return new Set((configured?.length ? configured : [
    config.storeFrontURI,
    config.adminURI,
    'http://localhost:8000',
    'http://localhost:8001',
  ]).map((value) => value.replace(/\/$/, '')));
}

export function requireTrustedMutationOrigin(c: EnvContext) {
  const origin = c.req.header('Origin')?.trim().replace(/\/$/, '');
  const referer = c.req.header('Referer');
  let refererOrigin: string | null = null;
  if (referer) {
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      refererOrigin = null;
    }
  }
  const requestOrigin = origin || refererOrigin;
  if (!requestOrigin || !allowedOrigins(c.env).has(requestOrigin) || (origin && refererOrigin && origin !== refererOrigin)) {
    return errorJson(c, 403, 'UNTRUSTED_ORIGIN', 'This request did not come from an approved application.');
  }
  return null;
}

export function requireJson(c: EnvContext) {
  const contentType = c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase();
  return contentType === 'application/json'
    ? null
    : errorJson(c, 415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON is required.');
}

async function getOrCreateCart(db: ReturnType<typeof createDb>, userId: string) {
  const [existing] = await db.select().from(carts).where(and(eq(carts.userId, userId), eq(carts.status, 'active'))).limit(1);
  if (existing) return existing;
  const now = new Date();
  const id = nanoid();
  await db.insert(carts).values({ id, userId, status: 'active', createdAt: now, updatedAt: now });
  return { id, userId, status: 'active' as const, createdAt: now, updatedAt: now };
}

function normalizeImage(product: typeof products.$inferSelect): string | null {
  const image = Array.isArray(product.images) ? product.images[0] : null;
  return image && typeof image === 'object' && typeof image.url === 'string' ? image.url : null;
}

function serializeCartItem(
  item: typeof cartItems.$inferSelect,
  env: Env,
  origin: string
) {
  return {
    ...item,
    imageSnapshot: item.imageSnapshot
      ? resolveProductImageUrlForClient(item.imageSnapshot, env, { origin }) ||
        item.imageSnapshot
      : null,
    href: `/product/${encodeURIComponent(item.productSlugSnapshot)}`,
  };
}

async function skuSnapshot(db: ReturnType<typeof createDb>, skuId: string) {
  const [row] = await db
    .select({
      sku: productSkus,
      product: products,
    })
    .from(productSkus)
    .innerJoin(products, eq(products.id, productSkus.productId))
    .where(eq(productSkus.id, skuId))
    .limit(1);
  if (!row) return null;
  const properties = await db
    .select({ name: skuProperties.propertyName, value: skuProperties.value })
    .from(skuProperties)
    .where(eq(skuProperties.skuId, skuId));
  return {
    ...row,
    label: properties.map((property) => `${property.name}: ${property.value}`).join(' · ') || null,
  };
}

async function cartSummary(db: ReturnType<typeof createDb>, cartId: string) {
  const [summary] = await db
    .select({
      itemCount: sql<number>`coalesce(sum(${cartItems.quantity}), 0)`,
      total: sql<number>`coalesce(sum(${cartItems.quantity} * ${cartItems.unitPriceSnapshot}), 0)`,
    })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  return { itemCount: Number(summary?.itemCount ?? 0), total: Number(summary?.total ?? 0) };
}

storeCart.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  c.header('Vary', 'Cookie');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});

storeCart.get('/', async (c) => {
  try {
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;
    const cart = await getOrCreateCart(access.db, access.user.id);
    const items = await access.db
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, cart.id))
      .orderBy(cartItems.createdAt);
    const origin = requestOriginFromUrl(c.req.url);
    return c.json({
      success: true,
      data: {
        cartId: cart.id,
        items: items.map((item) => serializeCartItem(item, c.env, origin)),
        summary: await cartSummary(access.db, cart.id),
      },
    });
  } catch (error) {
    console.error('store cart: load failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to load your cart.');
  }
});

storeCart.get('/summary', async (c) => {
  try {
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;
    const cart = await getOrCreateCart(access.db, access.user.id);
    return c.json({ success: true, data: await cartSummary(access.db, cart.id) });
  } catch (error) {
    console.error('store cart: summary load failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to load your cart summary.');
  }
});

storeCart.post('/items', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const bodyError = requireJson(c);
    if (bodyError) return bodyError;
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;
    const body = await c.req.json<unknown>();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return errorJson(c, 400, 'INVALID_BODY', 'A JSON object is required.');
    const input = body as Record<string, unknown>;
    const skuId = typeof input.skuId === 'string' ? input.skuId.trim() : '';
    const quantity = typeof input.quantity === 'number' && Number.isInteger(input.quantity) ? input.quantity : NaN;
    if (!skuId || skuId.length > 128 || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return errorJson(c, 400, 'INVALID_ITEM', `skuId and a quantity from 1 to ${MAX_QUANTITY} are required.`);
    }
    const snapshot = await skuSnapshot(access.db, skuId);
    if (!snapshot) return errorJson(c, 404, 'SKU_NOT_FOUND', 'That product variant no longer exists.');
    if (snapshot.sku.stock < 1) return errorJson(c, 409, 'OUT_OF_STOCK', 'That product variant is out of stock.');
    const cart = await getOrCreateCart(access.db, access.user.id);
    const now = new Date();
    const [existing] = await access.db.select().from(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.skuId, skuId))).limit(1);
    const nextQuantity = Math.min((existing?.quantity ?? 0) + quantity, snapshot.sku.stock, MAX_QUANTITY);
    const itemId = existing?.id ?? nanoid();
    const previousQuantity = existing?.quantity ?? 0;
    if (existing) {
      await access.db.update(cartItems).set({
        quantity: nextQuantity,
        unitPriceSnapshot: snapshot.sku.price,
        compareAtPriceSnapshot: snapshot.sku.compareAtPrice,
        productNameSnapshot: snapshot.product.name,
        productSlugSnapshot: snapshot.product.slug,
        variantLabelSnapshot: snapshot.label,
        imageSnapshot: normalizeImage(snapshot.product),
        updatedAt: now,
      }).where(and(eq(cartItems.id, existing.id), eq(cartItems.cartId, cart.id)));
    } else {
      await access.db.insert(cartItems).values({
        id: itemId,
        cartId: cart.id,
        productId: snapshot.product.id,
        skuId,
        quantity: nextQuantity,
        unitPriceSnapshot: snapshot.sku.price,
        compareAtPriceSnapshot: snapshot.sku.compareAtPrice,
        productNameSnapshot: snapshot.product.name,
        productSlugSnapshot: snapshot.product.slug,
        variantLabelSnapshot: snapshot.label,
        imageSnapshot: normalizeImage(snapshot.product),
        createdAt: now,
        updatedAt: now,
      });
    }
    await access.db.update(carts).set({ updatedAt: now }).where(eq(carts.id, cart.id));
    return c.json({
      success: true,
      data: {
        itemId,
        previousQuantity,
        quantity: nextQuantity,
        summary: await cartSummary(access.db, cart.id),
      },
    });
  } catch (error) {
    console.error('store cart: add failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to add that item to your cart.');
  }
});

storeCart.patch('/items/:itemId', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const bodyError = requireJson(c);
    if (bodyError) return bodyError;
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;
    const body = await c.req.json<unknown>();
    const quantity = body && typeof body === 'object' && !Array.isArray(body) && typeof (body as Record<string, unknown>).quantity === 'number'
      ? (body as Record<string, number>).quantity
      : NaN;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return errorJson(c, 400, 'INVALID_QUANTITY', `Quantity must be between 1 and ${MAX_QUANTITY}.`);
    const cart = await getOrCreateCart(access.db, access.user.id);
    const [item] = await access.db.select({ item: cartItems, stock: productSkus.stock }).from(cartItems).innerJoin(productSkus, eq(productSkus.id, cartItems.skuId)).where(and(eq(cartItems.id, c.req.param('itemId')), eq(cartItems.cartId, cart.id))).limit(1);
    if (!item) return errorJson(c, 404, 'ITEM_NOT_FOUND', 'Cart item not found.');
    if (item.stock < quantity) return errorJson(c, 409, 'INSUFFICIENT_STOCK', 'The requested quantity is not available.');
    const now = new Date();
    await access.db.update(cartItems).set({ quantity, updatedAt: now }).where(and(eq(cartItems.id, item.item.id), eq(cartItems.cartId, cart.id)));
    await access.db.update(carts).set({ updatedAt: now }).where(eq(carts.id, cart.id));
    return c.json({ success: true, data: { summary: await cartSummary(access.db, cart.id) } });
  } catch (error) {
    console.error('store cart: quantity update failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to update your cart.');
  }
});

storeCart.delete('/items/:itemId', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;
    const cart = await getOrCreateCart(access.db, access.user.id);
    const result = await access.db.delete(cartItems).where(and(eq(cartItems.id, c.req.param('itemId')), eq(cartItems.cartId, cart.id))).run();
    if (result.meta.changes === 0) return errorJson(c, 404, 'ITEM_NOT_FOUND', 'Cart item not found.');
    await access.db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    return c.json({ success: true, data: { summary: await cartSummary(access.db, cart.id) } });
  } catch (error) {
    console.error('store cart: remove failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to remove that item.');
  }
});

storeCart.all('*', (c) => errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));

export { getOrCreateCart, cartSummary, skuSnapshot };
export default storeCart;