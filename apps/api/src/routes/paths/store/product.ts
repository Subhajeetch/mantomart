import { Hono } from 'hono';
import { createDb } from '@repo/db';
import type Env from '@/types/env';
import { errorJson } from '@/utils/errorJson';
import { requestOriginFromUrl } from '@/utils/productImageHost';
import {
  DEFAULT_FEED_PAGE_SIZE,
  MAX_FEED_PAGE_SIZE,
  MIN_FEED_PAGE_SIZE,
} from '@/utils/homepageContent';
import {
  isValidProductSlug,
  loadMoreForYou,
  loadPublicProduct,
  PUBLIC_PRODUCT_CACHE_TTL_SECONDS,
} from '@/utils/storeProduct';

/**
 * Public storefront product page.
 *
 * GET /:slug        — published product, public-safe fields only
 * GET /:slug/more   — "More for you" infinite feed (category → parent → rest)
 */
const storeProduct = new Hono<{ Bindings: Env }>();

function cacheHeaders(c: { header: (name: string, value: string) => void }) {
  c.header(
    'Cache-Control',
    `public, max-age=60, s-maxage=${PUBLIC_PRODUCT_CACHE_TTL_SECONDS}, stale-while-revalidate=3600`
  );
  c.header('Vary', 'Origin');
}

function parsePageSize(raw: string | undefined): number {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_FEED_PAGE_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_FEED_PAGE_SIZE;
  return Math.max(MIN_FEED_PAGE_SIZE, Math.min(MAX_FEED_PAGE_SIZE, parsed));
}

storeProduct.get('/:slug/more', async (c) => {
  const slug = c.req.param('slug')?.trim().toLowerCase() ?? '';
  if (!isValidProductSlug(slug)) {
    return errorJson(c, 400, 'INVALID_SLUG', 'Invalid product slug.');
  }

  try {
    const db = createDb(c.env.DB);
    const result = await loadMoreForYou(
      db,
      slug,
      c.req.query('cursor') ?? null,
      parsePageSize(c.req.query('pageSize')),
      c.env,
      requestOriginFromUrl(c.req.url)
    );

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return errorJson(c, 404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      }
      if (result.code === 'INVALID_SLUG') {
        return errorJson(c, 400, 'INVALID_SLUG', 'Invalid product slug.');
      }
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to load related products.'
      );
    }

    cacheHeaders(c);
    return c.json({
      success: true,
      data: {
        items: result.page.items,
        nextCursor: result.page.nextCursor,
      },
    });
  } catch (error) {
    console.error('Error loading more-for-you feed:', error);
    return errorJson(
      c,
      500,
      'INTERNAL_ERROR',
      'Failed to load related products.'
    );
  }
});

storeProduct.get('/:slug', async (c) => {
  const slug = c.req.param('slug')?.trim().toLowerCase() ?? '';
  if (!isValidProductSlug(slug)) {
    return errorJson(c, 400, 'INVALID_SLUG', 'Invalid product slug.');
  }

  try {
    const db = createDb(c.env.DB);
    const result = await loadPublicProduct(
      db,
      slug,
      c.env,
      requestOriginFromUrl(c.req.url)
    );

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return errorJson(c, 404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      }
      if (result.code === 'INVALID_SLUG') {
        return errorJson(c, 400, 'INVALID_SLUG', 'Invalid product slug.');
      }
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load product.');
    }

    cacheHeaders(c);
    return c.json({
      success: true,
      data: result.product,
    });
  } catch (error) {
    console.error('Error loading store product:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load product.');
  }
});

export default storeProduct;
