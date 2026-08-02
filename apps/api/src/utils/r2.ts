/**
 * Cloudflare R2 helpers via Worker binding only.
 *
 * Config (wrangler.jsonc):
 *   r2_buckets: [{ binding: "R2_IMAGES", bucket_name: "…", preview_bucket_name: "…" }]
 *
 * Optional env:
 *   R2_PUBLIC_URL — public CDN / custom domain base (e.g. https://imgs.mantomart.com).
 *                   When unset, objects are served by this Worker at /api/images/{key}
 *                   using API_URL (or the request origin). That works for both
 *                   `wrangler dev` (local Miniflare disk under .wrangler/state/v3/r2)
 *                   and production Workers (real R2).
 *
 * Local vs prod:
 *   - wrangler dev  → R2_IMAGES writes to local sim (not the CF dashboard)
 *   - wrangler deploy → R2_IMAGES is the real bucket
 */

import type Env from '@/types/env';

/** Public path prefix used when serving objects through this Worker. */
export const R2_PUBLIC_SERVE_PREFIX = '/api/images';

// ─── Types ────────────────────────────────────────────────────────────────────

export type R2UploadInput = {
  /** Object key including folder, e.g. "category/fashion_category_1712.webp" */
  key: string;
  body: ArrayBuffer | Uint8Array | ReadableStream;
  contentType: string;
  /** Optional cache-control header */
  cacheControl?: string;
  /** Optional custom metadata (ASCII only) */
  customMetadata?: Record<string, string>;
};

export type R2UploadResult = {
  key: string;
  /** Always set when API_URL / R2_PUBLIC_URL / request origin is available */
  publicUrl: string | null;
  etag?: string;
  via: 'binding';
};

export type R2ConfigError = {
  code: 'R2_NOT_CONFIGURED';
  message: string;
};

export type R2UrlOptions = {
  /**
   * Fallback origin when R2_PUBLIC_URL and API_URL are unset.
   * Pass `new URL(c.req.url).origin` from handlers.
   */
  origin?: string;
};

// ─── Config ───────────────────────────────────────────────────────────────────

function trimOrEmpty(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** True when the Worker has an R2 bucket binding. */
export function hasR2Binding(env: Env): boolean {
  return typeof env.R2_IMAGES !== 'undefined' && env.R2_IMAGES !== null;
}

export function isR2Configured(env: Env): boolean {
  return hasR2Binding(env);
}

/**
 * Public base for objects:
 *   1. R2_PUBLIC_URL (CDN / custom domain) — keys append as `/{key}`
 *   2. API_URL + /api/images — Worker-served
 *   3. request origin + /api/images
 */
export function getR2PublicBaseUrl(
  env: Env,
  options?: R2UrlOptions
): string | null {
  const cdn = trimOrEmpty(env.R2_PUBLIC_URL);
  if (cdn) return stripTrailingSlash(cdn);

  const api = trimOrEmpty(env.API_URL) || trimOrEmpty(options?.origin);
  if (!api) return null;
  return `${stripTrailingSlash(api)}${R2_PUBLIC_SERVE_PREFIX}`;
}

export function buildPublicObjectUrl(
  env: Env,
  key: string,
  options?: R2UrlOptions
): string | null {
  const base = getR2PublicBaseUrl(env, options);
  if (!base) return null;
  const cleanKey = key.replace(/^\/+/, '');
  return `${base}/${cleanKey}`;
}

/**
 * Sanitize an object key. Rejects empty, traversal, and absolute paths.
 */
export function sanitizeObjectKey(key: string): string | null {
  const clean = key.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!clean || clean.includes('..') || clean.startsWith('/')) return null;
  return clean;
}

// ─── Upload / delete ──────────────────────────────────────────────────────────

/**
 * Upload an object via the R2_IMAGES Worker binding.
 */
export async function uploadToR2(
  env: Env,
  input: R2UploadInput,
  options?: R2UrlOptions
): Promise<
  | { ok: true; result: R2UploadResult }
  | { ok: false; error: R2ConfigError | { code: string; message: string } }
> {
  const key = sanitizeObjectKey(input.key);
  if (!key) {
    return {
      ok: false,
      error: {
        code: 'INVALID_OBJECT_KEY',
        message: 'Object key is invalid.',
      },
    };
  }

  if (!hasR2Binding(env)) {
    return {
      ok: false,
      error: {
        code: 'R2_NOT_CONFIGURED',
        message:
          'Object storage is not configured. Bind R2_IMAGES in wrangler.jsonc.',
      },
    };
  }

  try {
    const putResult = await env.R2_IMAGES!.put(key, input.body, {
      httpMetadata: {
        contentType: input.contentType,
        cacheControl:
          input.cacheControl ?? 'public, max-age=31536000, immutable',
      },
      customMetadata: input.customMetadata,
    });

    return {
      ok: true,
      result: {
        key,
        publicUrl: buildPublicObjectUrl(env, key, options),
        etag: putResult?.etag,
        via: 'binding',
      },
    };
  } catch (error) {
    console.error('R2 binding upload failed:', error);
    return {
      ok: false,
      error: {
        code: 'R2_UPLOAD_FAILED',
        message: 'Failed to upload image to object storage.',
      },
    };
  }
}

/**
 * Delete an object from R2 (best-effort). Used when replacing images later.
 */
export async function deleteFromR2(
  env: Env,
  key: string
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const cleanKey = sanitizeObjectKey(key);
  if (!cleanKey) {
    return {
      ok: false,
      code: 'INVALID_OBJECT_KEY',
      message: 'Object key is invalid.',
    };
  }

  if (!hasR2Binding(env)) {
    return {
      ok: false,
      code: 'R2_NOT_CONFIGURED',
      message: 'Object storage is not configured. Bind R2_IMAGES in wrangler.jsonc.',
    };
  }

  try {
    await env.R2_IMAGES!.delete(cleanKey);
    return { ok: true };
  } catch (error) {
    console.error('R2 binding delete failed:', error);
    return {
      ok: false,
      code: 'R2_DELETE_FAILED',
      message: 'Failed to delete object from storage.',
    };
  }
}

/**
 * Fetch an object for the public serve route.
 * Returns null when missing / misconfigured.
 */
export async function getFromR2(
  env: Env,
  key: string
): Promise<R2ObjectBody | null> {
  const cleanKey = sanitizeObjectKey(key);
  if (!cleanKey || !hasR2Binding(env)) return null;
  try {
    return await env.R2_IMAGES!.get(cleanKey);
  } catch (error) {
    console.error('R2 binding get failed:', error);
    return null;
  }
}
