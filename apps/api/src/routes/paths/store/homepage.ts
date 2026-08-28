import { Hono } from 'hono';
import { createDb } from '@repo/db';
import type Env from '@/types/env';
import { errorJson } from '@/utils/errorJson';
import {
  DEFAULT_FEED_PAGE_SIZE,
  getPublicHomepage,
  HOMEPAGE_CACHE_TTL_SECONDS,
  loadProductFeedPage,
} from '@/utils/homepageContent';
import { requestOriginFromUrl } from '@/utils/productImageHost';

/**
 * Public storefront homepage.
 *
 * Cache strategy:
 * 1. Cloudflare KV (5-day TTL) — shared across all visitors (sessionless)
 * 2. D1 on miss — then re-seed KV
 * 3. HTTP Cache-Control so edge/browsers also cache
 *
 * Mutations from the admin panel invalidate the KV key.
 */
const storeHomepage = new Hono<{ Bindings: Env }>();

function cacheHeaders(
  c: { header: (name: string, value: string) => void },
  source: string
) {
  c.header(
    'Cache-Control',
    `public, max-age=${HOMEPAGE_CACHE_TTL_SECONDS}, s-maxage=${HOMEPAGE_CACHE_TTL_SECONDS}, stale-while-revalidate=86400`
  );
  c.header('X-Cache-Source', source);
  c.header('Vary', 'Origin');
}

storeHomepage.get('/', async (c) => {
  try {
    const db = createDb(c.env.DB);
    const { data, source } = await getPublicHomepage(
      db,
      c.env.KV,
      c.env,
      requestOriginFromUrl(c.req.url)
    );

    cacheHeaders(c, source);

    return c.json({
      success: true,
      data: {
        blocks: data.blocks,
        updatedAt: data.updatedAt,
        cachedAt: data.cachedAt,
      },
      meta: {
        cacheTtlSeconds: HOMEPAGE_CACHE_TTL_SECONDS,
        source,
      },
    });
  } catch (error) {
    console.error('Error loading store homepage:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load homepage.');
  }
});

storeHomepage.get('/feed', async (c) => {
  try {
    const db = createDb(c.env.DB);
    const cursor = c.req.query('cursor') ?? null;
    const pageSizeRaw = c.req.query('pageSize');
    let pageSize = DEFAULT_FEED_PAGE_SIZE;
    if (typeof pageSizeRaw === 'string' && pageSizeRaw.trim() !== '') {
      const parsed = Number.parseInt(pageSizeRaw, 10);
      if (Number.isFinite(parsed)) pageSize = parsed;
    }

    const data = await loadProductFeedPage(
      db,
      cursor,
      pageSize,
      c.env,
      requestOriginFromUrl(c.req.url)
    );

    cacheHeaders(c, 'db');

    return c.json({
      success: true,
      data: {
        items: data.items,
        nextCursor: data.nextCursor,
      },
    });
  } catch (error) {
    console.error('Error loading homepage product feed:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load product feed.');
  }
});

export default storeHomepage;
