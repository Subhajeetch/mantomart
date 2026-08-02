/**
 * Public image serve route — streams objects from the R2_IMAGES binding.
 *
 * GET /api/images/{folder}/{filename}
 *   e.g. /api/images/category/fashion_category_1712345678.webp
 *
 * Used when R2_PUBLIC_URL is unset (local wrangler + default prod).
 * Local files live under apps/api/.wrangler/state/v3/r2/.
 * Production uses the real R2 bucket bound in wrangler.jsonc.
 */

import { Hono } from 'hono';
import {
  errorJson,
  type AppEnv,
  type AppContext,
} from '@/utils/errorJson';
import { getFromR2, R2_PUBLIC_SERVE_PREFIX } from '@/utils/r2';

const imagesRouter = new Hono<AppEnv>();

/**
 * Extract object key from the request URL.
 * Prefer the full pathname so mount-path quirks don't matter.
 */
function keyFromRequest(c: AppContext): string | null {
  try {
    const pathname = new URL(c.req.url).pathname;
    const prefix = `${R2_PUBLIC_SERVE_PREFIX}/`;
    if (!pathname.startsWith(prefix)) {
      // Fallback: path relative to this router mount
      const relative = c.req.path.replace(/^\/+/, '');
      return relative || null;
    }
    const key = pathname.slice(prefix.length);
    return key || null;
  } catch {
    return null;
  }
}

imagesRouter.get('/*', async (c) => {
  const key = keyFromRequest(c);
  if (!key) {
    return errorJson(c, 400, 'MISSING_KEY', 'Image key is required.');
  }

  const object = await getFromR2(c.env, key);
  if (!object) {
    return errorJson(c, 404, 'NOT_FOUND', 'Image not found.');
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set(
    'Cache-Control',
    object.httpMetadata?.cacheControl ??
      'public, max-age=31536000, immutable'
  );
  // Allow <img> from admin/store origins (and canvas reads if needed later).
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(object.body, { headers });
});

imagesRouter.notFound((c: AppContext) =>
  errorJson(c, 404, 'NOT_FOUND', 'Image not found.')
);

export default imagesRouter;
