import { Hono } from 'hono';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  createDb,
  products,
  users,
  wishlistFolders,
  wishlistProducts,
} from '@repo/db';
import type Env from '@/types/env';
import { errorJson, type EnvContext } from '@/utils/errorJson';
import config from '@/mine.config';
import { createAuth } from '@repo/auth/server';
import {
  resolveProductImageUrlForClient,
  requestOriginFromUrl,
} from '@/utils/productImageHost';

const storeWishlists = new Hono<{ Bindings: Env }>();

const ICONS = new Set([
  'Heart',
  'Star',
  'Gift',
  'ShoppingBag',
  'Sparkles',
  'Home',
  'Briefcase',
  'Plane',
  'Flower2',
  'Gamepad2',
  'BookHeart',
  'Bookmark',
]);

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

async function requireUser(c: EnvContext) {
  const { db, auth } = authForRequest(c);
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user?.id || !session.session?.id) {
      return {
        ok: false as const,
        response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.'),
      };
    }
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    if (!user || user.isDeleted || user.isBanned) {
      return {
        ok: false as const,
        response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.'),
      };
    }
    await getOrCreateFavourites(db, user.id);
    return { ok: true as const, db, user };
  } catch (error) {
    console.error('store wishlists: session lookup failed', error);
    return {
      ok: false as const,
      response: errorJson(c, 500, 'SESSION_ERROR', 'Unable to verify your session.'),
    };
  }
}

function allowedOrigins(env: Env): Set<string> {
  const configured = env.ORIGINS
    ?.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return new Set(
    (configured?.length
      ? configured
      : [config.storeFrontURI, config.adminURI, 'http://localhost:8000', 'http://localhost:8001']
    ).map((origin) => origin.replace(/\/$/, ''))
  );
}

function requireTrustedMutationOrigin(c: EnvContext) {
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
  if (
    !requestOrigin ||
    !allowedOrigins(c.env).has(requestOrigin) ||
    (origin && refererOrigin && origin !== refererOrigin)
  ) {
    return errorJson(
      c,
      403,
      'UNTRUSTED_ORIGIN',
      'This request did not come from an approved application.'
    );
  }
  return null;
}

function jsonRequest(c: EnvContext) {
  const contentType = c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase();
  return contentType === 'application/json'
    ? null
    : errorJson(c, 415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON is required.');
}

async function getOrCreateFavourites(
  db: ReturnType<typeof createDb>,
  userId: string
) {
  const [existing] = await db
    .select()
    .from(wishlistFolders)
    .where(
      and(eq(wishlistFolders.userId, userId), eq(wishlistFolders.isDefault, true))
    )
    .limit(1);
  if (existing) return existing;

  const now = new Date();
  const id = crypto.randomUUID();
  await db
    .insert(wishlistFolders)
    .values({
      id,
      userId,
      name: 'Favourites',
      icon: 'Heart',
      isDefault: true,
      totalProducts: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
  const [created] = await db
    .select()
    .from(wishlistFolders)
    .where(
      and(eq(wishlistFolders.userId, userId), eq(wishlistFolders.isDefault, true))
    )
    .limit(1);
  return created;
}

function serializeProduct(
  product: typeof products.$inferSelect,
  env: Env,
  origin: string
) {
  const images = Array.isArray(product.images) ? product.images : [];
  const firstImage = images[0];
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    image: firstImage
      ? resolveProductImageUrlForClient(firstImage.url, env, { origin })
      : null,
    price: product.defaultPrice?.normalPrice?.from ?? null,
    href: `/product/${product.slug}`,
  };
}

function serializeFolder(
  folder: typeof wishlistFolders.$inferSelect,
  productIds: string[] = [],
  folderProducts: ReturnType<typeof serializeProduct>[] = []
) {
  return {
    id: folder.id,
    name: folder.name,
    icon: folder.icon,
    isDefault: folder.isDefault,
    totalProducts: folder.totalProducts,
    productIds,
    products: folderProducts,
  };
}

storeWishlists.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  c.header('Vary', 'Cookie');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});

storeWishlists.get('/', async (c) => {
  try {
    const access = await requireUser(c);
    if (!access.ok) return access.response;
    const folders = await access.db
      .select()
      .from(wishlistFolders)
      .where(eq(wishlistFolders.userId, access.user.id))
      .orderBy(desc(wishlistFolders.isDefault), asc(wishlistFolders.createdAt));

    if (folders.length === 0) {
      const favourites = await getOrCreateFavourites(access.db, access.user.id);
      if (favourites) folders.push(favourites);
    }

    const folderProductRows = await access.db
      .select({
        folderId: wishlistProducts.folderId,
        productId: wishlistProducts.productId,
      })
      .from(wishlistProducts)
      .where(inArray(wishlistProducts.folderId, folders.map((folder) => folder.id)));

    return c.json({
      success: true,
      data: {
        folders: folders.map((folder) =>
          serializeFolder(
            folder,
            folderProductRows
              .filter((item) => item.folderId === folder.id)
              .map((item) => item.productId)
          )
        ),
      },
    });
  } catch (error) {
    console.error('store wishlists: load failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to load your wishlists.');
  }
});

storeWishlists.get('/:folderId', async (c) => {
  try {
    const access = await requireUser(c);
    if (!access.ok) return access.response;
    const folderId = c.req.param('folderId')?.trim();
    const [folder] = await access.db
      .select()
      .from(wishlistFolders)
      .where(and(eq(wishlistFolders.id, folderId), eq(wishlistFolders.userId, access.user.id)))
      .limit(1);
    if (!folder) return errorJson(c, 404, 'FOLDER_NOT_FOUND', 'Wishlist folder not found.');

    const folderProducts = await access.db
      .select({
        product: products,
      })
      .from(wishlistProducts)
      .innerJoin(products, eq(products.id, wishlistProducts.productId))
      .where(eq(wishlistProducts.folderId, folder.id))
      .orderBy(asc(wishlistProducts.createdAt));
    const origin = requestOriginFromUrl(c.req.url);

    return c.json({
      success: true,
      data: {
        folder: serializeFolder(
          folder,
          folderProducts.map((item) => item.product.id),
          folderProducts
            .filter((item) => item.product.published)
            .map((item) => serializeProduct(item.product, c.env, origin))
        ),
      },
    });
  } catch (error) {
    console.error('store wishlists: load failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to load your wishlists.');
  }
});

storeWishlists.post('/folders', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const mediaError = jsonRequest(c);
    if (mediaError) return mediaError;
    const access = await requireUser(c);
    if (!access.ok) return access.response;
    const body = await c.req.json<unknown>();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorJson(c, 400, 'INVALID_BODY', 'A JSON object is required.');
    }
    const fields = body as Record<string, unknown>;
    const name = typeof fields.name === 'string' ? fields.name.trim() : '';
    const icon = typeof fields.icon === 'string' ? fields.icon.trim() : 'Heart';
    if (name.length < 1 || name.length > 60) {
      return errorJson(c, 400, 'INVALID_NAME', 'Folder name must be between 1 and 60 characters.');
    }
    if (!ICONS.has(icon)) {
      return errorJson(c, 400, 'INVALID_ICON', 'That folder icon is not supported.');
    }
    const [existing] = await access.db
      .select()
      .from(wishlistFolders)
      .where(and(eq(wishlistFolders.userId, access.user.id), eq(wishlistFolders.name, name)))
      .limit(1);
    if (existing) {
      return errorJson(c, 409, 'FOLDER_EXISTS', 'You already have a folder with that name.');
    }
    const now = new Date();
    const folder = {
      id: crypto.randomUUID(),
      userId: access.user.id,
      name,
      icon,
      isDefault: false,
      totalProducts: 0,
      createdAt: now,
      updatedAt: now,
    };
    await access.db.insert(wishlistFolders).values(folder);
    return c.json({ success: true, data: { folder: serializeFolder(folder) } }, 201);
  } catch (error) {
    console.error('store wishlists: folder create failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to create that folder.');
  }
});

storeWishlists.post('/:folderId/products', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const mediaError = jsonRequest(c);
    if (mediaError) return mediaError;
    const access = await requireUser(c);
    if (!access.ok) return access.response;
    const folderId = c.req.param('folderId')?.trim();
    const body = await c.req.json<unknown>();
    const productId =
      body && typeof body === 'object' && !Array.isArray(body) && typeof (body as Record<string, unknown>).productId === 'string'
        ? ((body as Record<string, unknown>).productId as string).trim()
        : '';
    if (!folderId || !productId) {
      return errorJson(c, 400, 'INVALID_INPUT', 'A folderId and productId are required.');
    }
    const [folder] = await access.db
      .select()
      .from(wishlistFolders)
      .where(and(eq(wishlistFolders.id, folderId), eq(wishlistFolders.userId, access.user.id)))
      .limit(1);
    if (!folder) return errorJson(c, 404, 'FOLDER_NOT_FOUND', 'Wishlist folder not found.');
    const [product] = await access.db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.published, true)))
      .limit(1);
    if (!product) return errorJson(c, 404, 'PRODUCT_NOT_FOUND', 'Published product not found.');
    const [alreadySaved] = await access.db
      .select()
      .from(wishlistProducts)
      .where(and(eq(wishlistProducts.folderId, folderId), eq(wishlistProducts.productId, productId)))
      .limit(1);
    if (alreadySaved) {
      return c.json({ success: true, data: { saved: true, alreadySaved: true, folderId } });
    }
    const insertResult = await access.db
      .insert(wishlistProducts)
      .values({
        id: crypto.randomUUID(),
        folderId,
        productId,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .run();
    if (insertResult.meta.changes === 0) {
      return c.json({ success: true, data: { saved: true, alreadySaved: true, folderId } });
    }
    await access.db
      .update(wishlistFolders)
      .set({
        totalProducts: sql`${wishlistFolders.totalProducts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(wishlistFolders.id, folderId));
    return c.json({ success: true, data: { saved: true, alreadySaved: false, folderId } }, 201);
  } catch (error) {
    console.error('store wishlists: product add failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to save that product.');
  }
});

storeWishlists.post('/:folderId/products/:productId/move', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const mediaError = jsonRequest(c);
    if (mediaError) return mediaError;
    const access = await requireUser(c);
    if (!access.ok) return access.response;

    const folderId = c.req.param('folderId')?.trim();
    const productId = c.req.param('productId')?.trim();
    const body = await c.req.json<unknown>();
    const targetFolderId =
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      typeof (body as Record<string, unknown>).targetFolderId === 'string'
        ? ((body as Record<string, unknown>).targetFolderId as string).trim()
        : '';

    if (!folderId || !productId || !targetFolderId) {
      return errorJson(
        c,
        400,
        'INVALID_INPUT',
        'A source folder, product, and target folder are required.'
      );
    }
    if (folderId === targetFolderId) {
      return errorJson(c, 400, 'SAME_FOLDER', 'Choose a different folder.');
    }

    const ownedFolders = await access.db
      .select()
      .from(wishlistFolders)
      .where(
        and(
          eq(wishlistFolders.userId, access.user.id),
          inArray(wishlistFolders.id, [folderId, targetFolderId])
        )
      );
    const source = ownedFolders.find((folder) => folder.id === folderId);
    const target = ownedFolders.find((folder) => folder.id === targetFolderId);
    if (!source || !target) {
      return errorJson(c, 404, 'FOLDER_NOT_FOUND', 'Wishlist folder not found.');
    }

    const [entry] = await access.db
      .select()
      .from(wishlistProducts)
      .where(
        and(
          eq(wishlistProducts.folderId, source.id),
          eq(wishlistProducts.productId, productId)
        )
      )
      .limit(1);
    if (!entry) {
      return errorJson(c, 404, 'PRODUCT_NOT_SAVED', 'That product is not saved in this folder.');
    }

    const insertResult = await access.db
      .insert(wishlistProducts)
      .values({
        id: crypto.randomUUID(),
        folderId: target.id,
        productId,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .run();
    await access.db
      .delete(wishlistProducts)
      .where(eq(wishlistProducts.id, entry.id))
      .run();
    await access.db
      .update(wishlistFolders)
      .set({ totalProducts: sql`max(0, ${wishlistFolders.totalProducts} - 1)`, updatedAt: new Date() })
      .where(eq(wishlistFolders.id, source.id));
    if (insertResult.meta.changes > 0) {
      await access.db
        .update(wishlistFolders)
        .set({ totalProducts: sql`${wishlistFolders.totalProducts} + 1`, updatedAt: new Date() })
        .where(eq(wishlistFolders.id, target.id));
    }

    return c.json({ success: true, data: { moved: true, sourceFolderId: source.id, targetFolderId: target.id, productId } });
  } catch (error) {
    console.error('store wishlists: product move failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to move that product.');
  }
});

storeWishlists.delete('/:folderId/products/:productId', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const access = await requireUser(c);
    if (!access.ok) return access.response;
    const folderId = c.req.param('folderId')?.trim();
    const productId = c.req.param('productId')?.trim();
    const [folder] = await access.db
      .select()
      .from(wishlistFolders)
      .where(and(eq(wishlistFolders.id, folderId), eq(wishlistFolders.userId, access.user.id)))
      .limit(1);
    if (!folder) return errorJson(c, 404, 'FOLDER_NOT_FOUND', 'Wishlist folder not found.');
    const result = await access.db
      .delete(wishlistProducts)
      .where(and(eq(wishlistProducts.folderId, folderId), eq(wishlistProducts.productId, productId)))
      .run();
    if (result.meta.changes === 0) {
      return errorJson(c, 404, 'PRODUCT_NOT_SAVED', 'That product is not saved in this folder.');
    }
    await access.db
      .update(wishlistFolders)
      .set({
        totalProducts: sql`max(0, ${wishlistFolders.totalProducts} - 1)`,
        updatedAt: new Date(),
      })
      .where(eq(wishlistFolders.id, folderId));
    return c.json({ success: true, data: { removed: true, folderId, productId } });
  } catch (error) {
    console.error('store wishlists: product remove failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to remove that product.');
  }
});

storeWishlists.all('*', (c) =>
  errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
);

export default storeWishlists;
