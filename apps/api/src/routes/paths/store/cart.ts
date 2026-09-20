import { Hono } from 'hono';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
export const MAX_QUANTITY = 10;

/** Guest tokens are generated client-side with crypto.randomUUID(). */
const GUEST_ID_PATTERN = /^[0-9a-zA-Z-]{8,128}$/;

type CartOwner = { userId: string } | { guestId: string };

/**
 * An authenticated shopper, or an anonymous guest resolved from the
 * `X-Guest-Id` header. Every cart row is scoped to exactly one of these.
 */
type CartActor =
  | { kind: 'user'; db: ReturnType<typeof createDb>; user: typeof users.$inferSelect; requestedGuestId: string | null }
  | { kind: 'guest'; db: ReturnType<typeof createDb>; guestId: string };

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

function guestIdFromHeader(c: EnvContext): string | null {
  const raw = c.req.header('X-Guest-Id')?.trim();
  if (!raw || raw.length > 128 || !GUEST_ID_PATTERN.test(raw)) return null;
  return raw;
}

/**
 * Resolve the cart actor for any cart request.
 * - A valid session wins (the request may also carry a guest id to merge).
 * - Otherwise the request must identify a guest via `X-Guest-Id`; we never
 *   fabricate an id here — reads simply reflect the (possibly empty) guest cart.
 */
export async function resolveCartActor(c: EnvContext) {
  const db = createDb(c.env.DB);
  const login = await requireStoreUser(c);
  const requestedGuestId = guestIdFromHeader(c);
  if (login.ok) {
    return {
      actor: { kind: 'user' as const, db: login.db, user: login.user, requestedGuestId },
      login,
    };
  }
  if (requestedGuestId) {
    return { actor: { kind: 'guest' as const, db, guestId: requestedGuestId }, login };
  }
  return { actor: null, login };
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

/**
 * Find the active cart for a user or a guest, creating it if necessary.
 * The nullable userId unique index still guarantees at most one row per user;
 * guest rows store only a guestId.
 */
async function getOrCreateCart(
  db: ReturnType<typeof createDb>,
  owner: CartOwner,
) {
  if ('userId' in owner) {
    const [existing] = await db.select().from(carts).where(and(eq(carts.userId, owner.userId), eq(carts.status, 'active'))).limit(1);
    if (existing) return existing;
    const now = new Date();
    const id = nanoid();
    await db.insert(carts).values({ id, userId: owner.userId, status: 'active', createdAt: now, updatedAt: now });
    return { id, userId: owner.userId as string | null, guestId: null as string | null, status: 'active' as const, createdAt: now, updatedAt: now };
  }
  const [existing] = await db.select().from(carts).where(and(eq(carts.guestId, owner.guestId), eq(carts.status, 'active'))).limit(1);
  if (existing) return existing;
  const now = new Date();
  const id = nanoid();
  await db.insert(carts).values({ id, guestId: owner.guestId, status: 'active', createdAt: now, updatedAt: now });
  return { id, userId: null as string | null, guestId: owner.guestId, status: 'active' as const, createdAt: now, updatedAt: now };
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

async function productVariants(
  db: ReturnType<typeof createDb>,
  productId: string,
  env: Env,
  origin: string,
) {
  const rows = await db.select({ sku: productSkus }).from(productSkus)
    .where(eq(productSkus.productId, productId));
  const properties = rows.length
    ? await db.select().from(skuProperties).where(inArray(skuProperties.skuId, rows.map((row) => row.sku.id)))
    : [];
  const propertiesBySku = new Map<string, typeof properties>();
  for (const property of properties) {
    const current = propertiesBySku.get(property.skuId) ?? [];
    current.push(property);
    propertiesBySku.set(property.skuId, current);
  }
  return rows.map((row) => ({
    id: row.sku.id,
    price: row.sku.price,
    compareAtPrice: row.sku.compareAtPrice,
    stock: row.sku.stock,
    options: Object.fromEntries(
      (propertiesBySku.get(row.sku.id) ?? []).map((property) => [property.propertyName, property.value]),
    ),
    optionImages: Object.fromEntries(
      (propertiesBySku.get(row.sku.id) ?? [])
        .filter((property) => property.image)
        .map((property) => [
          property.propertyName,
          resolveProductImageUrlForClient(property.image, env, { origin }) || property.image,
        ]),
    ),
  }));
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

/**
 * Upsert `quantity` of `skuId` into `cartId`, adding to any existing line and
 * capping at the available stock / MAX_QUANTITY. Re-snapshots the product so a
 * merged guest cart never caches stale pricing/name data on the user's cart.
 */
async function writeCartItem(
  db: ReturnType<typeof createDb>,
  cartId: string,
  skuId: string,
  quantity: number,
  now: Date,
) {
  const snapshot = await skuSnapshot(db, skuId);
  if (!snapshot) return null;
  const capped = Math.min(quantity, snapshot.sku.stock, MAX_QUANTITY);
  const [existing] = await db.select().from(cartItems).where(and(eq(cartItems.cartId, cartId), eq(cartItems.skuId, skuId))).limit(1);
  const nextQuantity = Math.min((existing?.quantity ?? 0) + capped, snapshot.sku.stock, MAX_QUANTITY);
  const id = existing?.id ?? nanoid();
  const values = {
    cartId,
    productId: snapshot.product.id,
    skuId,
    quantity: nextQuantity,
    unitPriceSnapshot: snapshot.sku.price,
    compareAtPriceSnapshot: snapshot.sku.compareAtPrice,
    productNameSnapshot: snapshot.product.name,
    productSlugSnapshot: snapshot.product.slug,
    variantLabelSnapshot: snapshot.label,
    imageSnapshot: normalizeImage(snapshot.product),
    updatedAt: now,
  };
  if (existing) {
    await db.update(cartItems).set(values).where(and(eq(cartItems.id, existing.id), eq(cartItems.cartId, cartId)));
  } else {
    await db.insert(cartItems).values({ id, ...values, createdAt: now });
  }
  return { id, quantity: nextQuantity, skuId };
}

/**
 * Move a guest's active cart into the user's cart (merge quantities) and mark
 * the guest row `merged` so a stale client guest id stays replay-safe.
 */
async function mergeGuestCartIntoUser(
  db: ReturnType<typeof createDb>,
  userId: string,
  guestId: string,
) {
  const [guestCart] = await db
    .select()
    .from(carts)
    .where(and(eq(carts.guestId, guestId), eq(carts.status, 'active')))
    .limit(1);
  if (!guestCart) return;
  const userCart = await getOrCreateCart(db, { userId });
  if (guestCart.id === userCart.id) return;
  const now = new Date();
  const guestItems = await db.select().from(cartItems).where(eq(cartItems.cartId, guestCart.id));
  for (const item of guestItems) {
    await writeCartItem(db, userCart.id, item.skuId, item.quantity, now);
  }
  await db.update(carts)
    .set({ status: 'merged', guestId: null, updatedAt: now })
    .where(eq(carts.id, guestCart.id));
  await db.update(carts).set({ updatedAt: now }).where(eq(carts.id, userCart.id));
}

storeCart.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  c.header('Vary', 'Cookie');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});

storeCart.get('/', async (c) => {
  try {
    const { actor } = await resolveCartActor(c);
    if (!actor) {
      return c.json({
        success: true,
        data: { cartId: null, mode: 'guest', guestId: null, items: [], summary: { itemCount: 0, total: 0 } },
      });
    }
    if (actor.kind === 'user') {
      if (actor.requestedGuestId) await mergeGuestCartIntoUser(actor.db, actor.user.id, actor.requestedGuestId);
      const cart = await getOrCreateCart(actor.db, { userId: actor.user.id });
      const items = await actor.db.select().from(cartItems).where(eq(cartItems.cartId, cart.id)).orderBy(cartItems.createdAt);
      const origin = requestOriginFromUrl(c.req.url);
      return c.json({
        success: true,
        data: {
          cartId: cart.id,
          mode: 'user',
          guestId: null,
          items: await Promise.all(items.map(async (item) => ({
            ...serializeCartItem(item, c.env, origin),
            variants: await productVariants(actor.db, item.productId, c.env, origin),
          }))),
          summary: await cartSummary(actor.db, cart.id),
        },
      });
    }
    const cart = await getOrCreateCart(actor.db, { guestId: actor.guestId });
    const items = await actor.db.select().from(cartItems).where(eq(cartItems.cartId, cart.id)).orderBy(cartItems.createdAt);
    const origin = requestOriginFromUrl(c.req.url);
    return c.json({
      success: true,
      data: {
        cartId: cart.id,
        mode: 'guest',
        guestId: cart.guestId,
        items: await Promise.all(items.map(async (item) => ({
          ...serializeCartItem(item, c.env, origin),
          variants: await productVariants(actor.db, item.productId, c.env, origin),
        }))),
        summary: await cartSummary(actor.db, cart.id),
      },
    });
  } catch (error) {
    console.error('store cart: load failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to load your cart.');
  }
});

storeCart.get('/summary', async (c) => {
  try {
    const { actor } = await resolveCartActor(c);
    if (!actor) {
      return c.json({
        success: true,
        data: { summary: { itemCount: 0, total: 0 }, mode: 'guest', guestId: null },
      });
    }
    if (actor.kind === 'user') {
      if (actor.requestedGuestId) await mergeGuestCartIntoUser(actor.db, actor.user.id, actor.requestedGuestId);
      const cart = await getOrCreateCart(actor.db, { userId: actor.user.id });
      return c.json({
        success: true,
        data: { summary: await cartSummary(actor.db, cart.id), mode: 'user', guestId: null },
      });
    }
    const [cart] = await actor.db.select().from(carts).where(and(eq(carts.guestId, actor.guestId), eq(carts.status, 'active'))).limit(1);
    const summary = cart ? await cartSummary(actor.db, cart.id) : { itemCount: 0, total: 0 };
    return c.json({
      success: true,
      data: { summary, mode: 'guest', guestId: cart?.guestId ?? actor.guestId },
    });
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
    const { actor } = await resolveCartActor(c);
    if (!actor) return errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.');
    const body = await c.req.json<unknown>();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return errorJson(c, 400, 'INVALID_BODY', 'A JSON object is required.');
    const input = body as Record<string, unknown>;
    const skuId = typeof input.skuId === 'string' ? input.skuId.trim() : '';
    const quantity = typeof input.quantity === 'number' && Number.isInteger(input.quantity) ? input.quantity : NaN;
    if (!skuId || skuId.length > 128 || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return errorJson(c, 400, 'INVALID_ITEM', `skuId and a quantity from 1 to ${MAX_QUANTITY} are required.`);
    }
    const snapshot = await skuSnapshot(actor.db, skuId);
    if (!snapshot) return errorJson(c, 404, 'SKU_NOT_FOUND', 'That product variant no longer exists.');
    if (snapshot.sku.stock < 1) return errorJson(c, 409, 'OUT_OF_STOCK', 'That product variant is out of stock.');

    const owner: CartOwner = actor.kind === 'user' ? { userId: actor.user.id } : { guestId: actor.guestId };
    const cart = await getOrCreateCart(actor.db, owner);
    const now = new Date();
    const written = await writeCartItem(actor.db, cart.id, skuId, quantity, now);
    const nextQuantity = written?.quantity ?? quantity;
    await actor.db.update(carts).set({ updatedAt: now }).where(eq(carts.id, cart.id));
    return c.json({
      success: true,
      data: {
        itemId: written?.id ?? null,
        previousQuantity: Math.max(0, nextQuantity - quantity),
        quantity: nextQuantity,
        summary: await cartSummary(actor.db, cart.id),
        mode: actor.kind,
        guestId: actor.kind === 'guest' ? actor.guestId : null,
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
    const { actor } = await resolveCartActor(c);
    if (!actor) return errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.');
    const body = await c.req.json<unknown>();
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    const quantity = input && typeof input.quantity === 'number'
      ? (body as Record<string, number>).quantity
      : NaN;
    const selected = input?.selected;
    const skuId = typeof input?.skuId === 'string' ? input.skuId.trim() : null;
    if (quantity !== quantity && selected !== true && selected !== false && !skuId) {
      return errorJson(c, 400, 'INVALID_UPDATE', 'A quantity, selection, or variant is required.');
    }
    if (quantity === quantity && (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY)) {
      return errorJson(c, 400, 'INVALID_QUANTITY', `Quantity must be between 1 and ${MAX_QUANTITY}.`);
    }
    const owner: CartOwner = actor.kind === 'user' ? { userId: actor.user.id } : { guestId: actor.guestId };
    const cart = await getOrCreateCart(actor.db, owner);
    const [item] = await actor.db.select({ item: cartItems, stock: productSkus.stock }).from(cartItems).innerJoin(productSkus, eq(productSkus.id, cartItems.skuId)).where(and(eq(cartItems.id, c.req.param('itemId')), eq(cartItems.cartId, cart.id))).limit(1);
    if (!item) return errorJson(c, 404, 'ITEM_NOT_FOUND', 'Cart item not found.');
    if (skuId) {
      const nextSku = await skuSnapshot(actor.db, skuId);
      if (!nextSku || nextSku.product.id !== item.item.productId) return errorJson(c, 400, 'INVALID_VARIANT', 'That variant is not available for this product.');
      if (nextSku.sku.stock < item.item.quantity) return errorJson(c, 409, 'INSUFFICIENT_STOCK', 'The selected variant does not have enough stock.');
      const duplicate = await actor.db.select({ id: cartItems.id }).from(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.skuId, skuId))).limit(1);
      if (duplicate[0] && duplicate[0].id !== item.item.id) return errorJson(c, 409, 'DUPLICATE_VARIANT', 'That variant is already in your cart.');
      await actor.db.update(cartItems).set({
        skuId,
        unitPriceSnapshot: nextSku.sku.price,
        compareAtPriceSnapshot: nextSku.sku.compareAtPrice,
        variantLabelSnapshot: nextSku.label,
        updatedAt: new Date(),
      }).where(and(eq(cartItems.id, item.item.id), eq(cartItems.cartId, cart.id)));
    }
    if (item.stock < quantity) return errorJson(c, 409, 'INSUFFICIENT_STOCK', 'The requested quantity is not available.');
    const now = new Date();
    await actor.db.update(cartItems).set({
      ...(quantity === quantity ? { quantity } : {}),
      ...(selected === true || selected === false ? { selected } : {}),
      updatedAt: now,
    }).where(and(eq(cartItems.id, item.item.id), eq(cartItems.cartId, cart.id)));
    await actor.db.update(carts).set({ updatedAt: now }).where(eq(carts.id, cart.id));
    return c.json({
      success: true,
      data: { summary: await cartSummary(actor.db, cart.id), mode: actor.kind, guestId: actor.kind === 'guest' ? actor.guestId : null },
    });
  } catch (error) {
    console.error('store cart: quantity update failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to update your cart.');
  }
});

storeCart.delete('/items/:itemId', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const { actor } = await resolveCartActor(c);
    if (!actor) return errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.');
    const owner: CartOwner = actor.kind === 'user' ? { userId: actor.user.id } : { guestId: actor.guestId };
    const cart = await getOrCreateCart(actor.db, owner);
    const result = await actor.db.delete(cartItems).where(and(eq(cartItems.id, c.req.param('itemId')), eq(cartItems.cartId, cart.id))).run();
    if (result.meta.changes === 0) return errorJson(c, 404, 'ITEM_NOT_FOUND', 'Cart item not found.');
    await actor.db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    return c.json({
      success: true,
      data: { summary: await cartSummary(actor.db, cart.id), mode: actor.kind, guestId: actor.kind === 'guest' ? actor.guestId : null },
    });
  } catch (error) {
    console.error('store cart: remove failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to remove that item.');
  }
});

storeCart.all('*', (c) => errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));

export {
  getOrCreateCart,
  cartSummary,
  skuSnapshot,
  writeCartItem,
  mergeGuestCartIntoUser,
  guestIdFromHeader,
};
export default storeCart;