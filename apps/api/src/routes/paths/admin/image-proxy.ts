/**
 * Authenticated AliExpress image proxy for the admin panel.
 *
 * GET /api/admin/image-proxy?url=<absolute-https-url>
 *
 * Why
 * ---
 * AliExpress CDN images are sometimes blocked, rate-limited, or hotlink-
 * protected when loaded directly in the browser. This Worker proxies them
 * only for signed-in admins, with host allowlisting, size caps, and edge
 * caching so repeated views are cheap on Cloudflare.
 *
 * Security
 * --------
 * - requireAdminMiddleware (session cookie → admin/owner only)
 * - HTTPS-only (http upgraded only for known AE hosts after validation)
 * - Strict hostname allowlist (alicdn / aliexpress / alibaba CDNs)
 * - Blocks localhost, private IPs, link-local, metadata endpoints
 * - Redirects re-validated against the same allowlist
 * - Response must be an image/* content-type; max body size enforced
 * - No open-proxy behavior for arbitrary URLs
 *
 * Caching
 * -------
 * - Cloudflare Cache API keyed by normalized source URL (image bytes are
 *   public CDN content; auth is checked on every request before cache read
 *   is returned so guests never receive proxied images)
 * - Browser: long-lived Cache-Control + ETag / 304 support
 * - Upstream If-None-Match / If-Modified-Since when revalidating
 *
 * Efficiency (Workers)
 * --------------------
 * Hot path: auth + Cache API hit → stream cached body (no origin fetch)
 * Cold path: auth + upstream fetch + cache put (waitUntil) + stream
 */

import { Hono } from 'hono';
import {
  errorJson,
  type AppEnv,
  type AppContext,
} from '@/utils/errorJson';
import { requireAdminMiddleware } from '@/middleware/permission';

const imageProxy = new Hono<AppEnv>();

imageProxy.use('*', requireAdminMiddleware);

// ─── Config ───────────────────────────────────────────────────────────────────

/** Max upstream image size (bytes). Protects Worker memory / egress. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MiB

/** Upstream fetch timeout. */
const FETCH_TIMEOUT_MS = 12_000;

/** Browser + shared cache lifetime for successful image responses. */
const CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** Stale-while-revalidate window for browsers that honor it. */
const CACHE_SWR_SECONDS = 60 * 60 * 24; // 1 day

/**
 * Allowed image hostnames (AliExpress / Alibaba CDN family only).
 * Keep in sync with the admin frontend allowlist in settings.ts.
 */
const ALLOWED_HOST_RE =
  /^(?:[a-z0-9-]+\.)*(?:alicdn\.com|aliexpress-media\.com|aliexpress\.com|alibaba\.com)$/i;

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
]);

const IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/svg+xml',
  'image/heic',
  'image/heif',
]);

// ─── URL validation / SSRF guards ─────────────────────────────────────────────

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');

  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.endsWith('.internal') || host.endsWith('.lan')) return true;

  // IPv4 literal
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map((p) => Number(p));
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  // IPv6 / IPv6-mapped
  if (host.includes(':')) {
    const h = host.replace(/^\[|\]$/g, '');
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA
    if (h.startsWith('fe80')) return true; // link-local
    if (h.startsWith('::ffff:')) {
      const mapped = h.slice('::ffff:'.length);
      return isPrivateOrLocalHostname(mapped);
    }
    return true; // deny bare IPv6 to be safe
  }

  return false;
}

function normalizeSourceUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  let candidate = trimmed;
  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  // Only http(s); upgrade http → https for CDN hosts (AE serves both).
  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }
  if (parsed.protocol !== 'https:') return null;

  // Strip credentials / hash — never proxy authenticated upstream URLs.
  if (parsed.username || parsed.password) return null;
  parsed.hash = '';

  const host = parsed.hostname.toLowerCase();
  if (!host || isPrivateOrLocalHostname(host)) return null;
  if (!ALLOWED_HOST_RE.test(host)) return null;

  // Block odd ports (CDN is always 443 after https upgrade).
  if (parsed.port && parsed.port !== '443') return null;

  return parsed;
}

function isAllowedImageContentType(value: string | null): boolean {
  if (!value) return false;
  const base = value.split(';')[0]?.trim().toLowerCase() ?? '';
  if (IMAGE_CONTENT_TYPES.has(base)) return true;
  // Some CDNs return generic types; accept image/* but not svg bombs later —
  // svg is already in the set. Reject everything else.
  return base.startsWith('image/');
}

// ─── Edge cache helpers ───────────────────────────────────────────────────────

/** Stable cache key Request for Cache API (auth-independent content key). */
function buildCacheKey(sourceUrl: string): Request {
  // Dedicated synthetic origin so we never collide with real site URLs.
  const keyUrl = new URL('https://image-proxy-cache.internal/v1');
  keyUrl.searchParams.set('u', sourceUrl);
  return new Request(keyUrl.toString(), { method: 'GET' });
}

function buildCacheControl(): string {
  return [
    'public',
    `max-age=${CACHE_MAX_AGE_SECONDS}`,
    `s-maxage=${CACHE_MAX_AGE_SECONDS}`,
    `stale-while-revalidate=${CACHE_SWR_SECONDS}`,
  ].join(', ');
}

function copyConditionalHeaders(
  incoming: Headers,
  outgoing: Headers
): void {
  const inm = incoming.get('If-None-Match');
  const ims = incoming.get('If-Modified-Since');
  if (inm) outgoing.set('If-None-Match', inm);
  if (ims) outgoing.set('If-Modified-Since', ims);
}

function applySecurityHeaders(headers: Headers): void {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cross-Origin-Resource-Policy', 'same-site');
  // Do not set Access-Control-Allow-Origin: * — cookies + credentialed use.
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

// ─── Upstream fetch ───────────────────────────────────────────────────────────

type UpstreamResult =
  | { ok: true; response: Response }
  | { ok: false; status: 400 | 502 | 504; code: string; message: string };

async function fetchUpstream(
  sourceUrl: string,
  requestHeaders: Headers
): Promise<UpstreamResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers = new Headers();
    // Neutral browser-like UA — some CDNs reject empty / bot UAs.
    headers.set(
      'User-Agent',
      'Mozilla/5.0 (compatible; MantoMartImageProxy/1.0; +https://mantomart.com)'
    );
    headers.set('Accept', 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8');
    headers.set('Accept-Language', 'en-US,en;q=0.9');
    // Don't send our admin cookies upstream.
    headers.set('Referer', 'https://www.aliexpress.com/');
    copyConditionalHeaders(requestHeaders, headers);

    const response = await fetch(sourceUrl, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
      cf: {
        // Prefer Cloudflare cache for the origin fetch when available.
        cacheTtl: CACHE_MAX_AGE_SECONDS,
        cacheEverything: true,
      },
    });

    // Follow a single same-allowlist redirect manually (no open redirect chain).
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (!location) {
        return {
          ok: false,
          status: 502,
          code: 'BAD_UPSTREAM_REDIRECT',
          message: 'Upstream returned a redirect without a Location header.',
        };
      }

      let redirectUrl: URL;
      try {
        redirectUrl = new URL(location, sourceUrl);
      } catch {
        return {
          ok: false,
          status: 502,
          code: 'BAD_UPSTREAM_REDIRECT',
          message: 'Upstream redirect target is invalid.',
        };
      }

      const normalized = normalizeSourceUrl(redirectUrl.toString());
      if (!normalized) {
        return {
          ok: false,
          status: 400,
          code: 'REDIRECT_NOT_ALLOWED',
          message: 'Upstream redirected to a host that is not allowed.',
        };
      }

      const redirected = await fetch(normalized.toString(), {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: controller.signal,
        cf: {
          cacheTtl: CACHE_MAX_AGE_SECONDS,
          cacheEverything: true,
        },
      });

      return { ok: true, response: redirected };
    }

    return { ok: true, response };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        status: 504,
        code: 'UPSTREAM_TIMEOUT',
        message: 'Timed out fetching the remote image.',
      };
    }
    console.error('image-proxy: upstream fetch failed', error);
    return {
      ok: false,
      status: 502,
      code: 'UPSTREAM_FETCH_FAILED',
      message: 'Failed to fetch the remote image.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read body with a hard size cap. Returns null if over limit.
 */
async function readBodyCapped(
  response: Response,
  maxBytes: number
): Promise<{ buffer: ArrayBuffer; tooLarge: boolean } | null> {
  const contentLength = response.headers.get('Content-Length');
  if (contentLength) {
    const len = Number(contentLength);
    if (Number.isFinite(len) && len > maxBytes) {
      return { buffer: new ArrayBuffer(0), tooLarge: true };
    }
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      return { buffer: new ArrayBuffer(0), tooLarge: true };
    }
    return { buffer, tooLarge: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return { buffer: new ArrayBuffer(0), tooLarge: true };
      }
      chunks.push(value);
    }
  } catch (error) {
    console.error('image-proxy: body read failed', error);
    return null;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { buffer: merged.buffer, tooLarge: false };
}

function buildImageResponse(
  body: ArrayBuffer | null,
  init: {
    status: number;
    contentType: string;
    etag?: string | null;
    lastModified?: string | null;
    upstreamCacheControl?: string | null;
  }
): Response {
  const headers = new Headers();
  headers.set('Content-Type', init.contentType);
  headers.set('Cache-Control', buildCacheControl());
  headers.set('X-Image-Proxy', 'mantomart');
  if (init.etag) headers.set('ETag', init.etag);
  if (init.lastModified) headers.set('Last-Modified', init.lastModified);
  if (body) headers.set('Content-Length', String(body.byteLength));
  applySecurityHeaders(headers);

  // Vary on nothing sensitive — content is keyed by URL only.
  headers.set('Vary', 'Accept');

  return new Response(body, {
    status: init.status,
    headers,
  });
}

// ─── GET / ────────────────────────────────────────────────────────────────────

imageProxy.get('/', async (c: AppContext) => {
  const rawUrl = c.req.query('url');
  if (!rawUrl) {
    return errorJson(
      c,
      400,
      'MISSING_URL',
      'Query parameter "url" is required.'
    );
  }

  const normalized = normalizeSourceUrl(rawUrl);
  if (!normalized) {
    return errorJson(
      c,
      400,
      'URL_NOT_ALLOWED',
      'Only HTTPS AliExpress / Alibaba CDN image URLs are allowed.'
    );
  }

  const sourceUrl = normalized.toString();
  const cacheKey = buildCacheKey(sourceUrl);

  // ── Cache API (edge) ──────────────────────────────────────────────────────
  // Auth already passed. Image bytes are public CDN content.
  let cache: Cache | null = null;
  try {
    cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Image-Proxy-Cache', 'HIT');
      applySecurityHeaders(headers);

      // Conditional request against cached representation
      const ifNoneMatch = c.req.header('If-None-Match');
      const etag = headers.get('ETag');
      if (ifNoneMatch && etag && ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers });
      }

      return new Response(cached.body, {
        status: cached.status,
        headers,
      });
    }
  } catch (error) {
    // Cache API can fail in some local runtimes — fall through to origin.
    console.error('image-proxy: cache match failed', error);
    cache = null;
  }

  // ── Upstream ──────────────────────────────────────────────────────────────
  const upstream = await fetchUpstream(sourceUrl, c.req.raw.headers);
  if (!upstream.ok) {
    return errorJson(c, upstream.status, upstream.code, upstream.message);
  }

  const remote = upstream.response;

  if (remote.status === 304) {
    const headers = new Headers();
    headers.set('Cache-Control', buildCacheControl());
    headers.set('X-Image-Proxy-Cache', 'REVALIDATED');
    const etag = remote.headers.get('ETag');
    const lastModified = remote.headers.get('Last-Modified');
    if (etag) headers.set('ETag', etag);
    if (lastModified) headers.set('Last-Modified', lastModified);
    applySecurityHeaders(headers);
    return new Response(null, { status: 304, headers });
  }

  if (remote.status === 404) {
    return errorJson(c, 404, 'IMAGE_NOT_FOUND', 'Remote image was not found.');
  }

  if (remote.status === 403 || remote.status === 401) {
    return errorJson(
      c,
      502,
      'UPSTREAM_FORBIDDEN',
      'Remote CDN refused to serve this image.'
    );
  }

  if (!remote.ok) {
    return errorJson(
      c,
      502,
      'UPSTREAM_ERROR',
      `Remote image request failed with status ${remote.status}.`
    );
  }

  const contentType = remote.headers.get('Content-Type');
  if (!isAllowedImageContentType(contentType)) {
    // Drain/cancel body to free the connection.
    try {
      await remote.body?.cancel();
    } catch {
      /* ignore */
    }
    return errorJson(
      c,
      502,
      'NOT_AN_IMAGE',
      'Remote response was not a valid image content type.'
    );
  }

  const safeType = (contentType ?? 'application/octet-stream')
    .split(';')[0]!
    .trim()
    .toLowerCase();

  const read = await readBodyCapped(remote, MAX_IMAGE_BYTES);
  if (!read) {
    return errorJson(
      c,
      502,
      'BODY_READ_FAILED',
      'Failed to read the remote image body.'
    );
  }
  if (read.tooLarge) {
    return errorJson(
      c,
      413,
      'IMAGE_TOO_LARGE',
      `Image exceeds the maximum allowed size of ${MAX_IMAGE_BYTES} bytes.`
    );
  }

  const etag =
    remote.headers.get('ETag') ??
    `"mmp-${(await sha256Hex(sourceUrl)).slice(0, 16)}-${read.buffer.byteLength}"`;
  const lastModified = remote.headers.get('Last-Modified');

  const ifNoneMatch = c.req.header('If-None-Match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    const headers = new Headers();
    headers.set('ETag', etag);
    headers.set('Cache-Control', buildCacheControl());
    headers.set('X-Image-Proxy-Cache', 'MISS');
    applySecurityHeaders(headers);
    return new Response(null, { status: 304, headers });
  }

  const response = buildImageResponse(read.buffer, {
    status: 200,
    contentType: safeType,
    etag,
    lastModified,
  });
  response.headers.set('X-Image-Proxy-Cache', 'MISS');

  // Store in edge cache without blocking the client response.
  if (cache) {
    const toCache = response.clone();
    c.executionCtx.waitUntil(
      cache.put(cacheKey, toCache).catch((error) => {
        console.error('image-proxy: cache put failed', error);
      })
    );
  }

  return response;
});

imageProxy.all('*', (c) =>
  errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.')
);

export default imageProxy;
