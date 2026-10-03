/**
 * Host AliExpress product images on R2 for SEO-friendly first-party URLs.
 *
 * Stored path (DB):  /product/image/{slug}-{id}.avif
 * Optimised sibling: /product/image/{slug}-{id}.avif_op.avif  (isOp: true)
 *
 * Never persist the CDN origin — prefix R2_PUBLIC_URL (or the Worker serve
 * base) only when sending URLs to a client.
 *
 * Uploads go through the R2_IMAGES binding directly. Do not call the admin
 * image-upload HTTP API from here.
 */

import { nanoid } from 'nanoid';
import {
  composeProductImageAlt,
  type ProductImage,
  type ProductImageRecord,
} from '@repo/db';
import type Env from '@/types/env';
import {
  buildPublicObjectUrl,
  deleteFromR2,
  getR2PublicBaseUrl,
  hasR2Binding,
  sanitizeObjectKey,
  uploadToR2,
  type R2UrlOptions,
} from '@/utils/cf-tools/r2';
import config from '@/mine.config';
import { isWebPBuffer } from '@/utils/images/imageUpload';

// ─── Public constants ─────────────────────────────────────────────────────────

export const PRODUCT_IMAGE_KEY_PREFIX = 'product/image';
export const PRODUCT_IMAGE_PATH_PREFIX = '/product/image/';
export const PRODUCT_IMAGE_EXT = 'avif';
export const AE_FULL_TRANSFORM = '_960x960q100.jpg_.avif';
export const AE_OP_TRANSFORM = '_220x220.jpg_.avif';
export const MAX_OPTIMISED_IMAGES = 5;
export const R2_UPLOAD_ATTEMPTS = 3;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const ALIEXPRESS_IMAGE_REQUEST_INTERVAL_MS = 250;
const IMAGE_FETCH_MAX_RETRIES = 3;
export const MAX_IMAGES_PER_HOSTING_INVOCATION = 45;
export const MAX_OPTIMISED_IMAGES_PER_HOSTING_INVOCATION = 5;
export const MAX_ALIEXPRESS_REQUESTS_PER_HOSTING_INVOCATION = 45;
export const PRODUCT_IMAGE_IMPORT_SESSION_TTL_SECONDS = 86_400;
const PRODUCT_HOST_SSE_HEARTBEAT_MS = 15_000;
const MAX_SLUG_IN_KEY = 80;
const CONCURRENCY = 3;

const AE_HOST_RE =
  /^(?:[a-z0-9-]+\.)*(?:alicdn\.com|aliexpress-media\.com|aliexpress\.com|alibaba\.com)$/i;

const ORIGINAL_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif)(_[^/?#]*)?$/i;

const IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/heic',
  'image/heif',
]);

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type HostedImageError = {
  code: string;
  message: string;
};

export type HostProgressEvent = {
  current: number;
  total: number;
  message: string;
};

export type AliExpressImageRateLimiter = (
  signal?: AbortSignal
) => Promise<void>;

export type HostProductImagesInput = {
  env: Env;
  slug: string;
  productImages: ProductImage[];
  skuImages: ProductImage[][];
  propertyImages: Array<Array<string | null>>;
  sizeChartImage: string | null;
  optimisedImageUrls?: string[];
  origin?: string;
  signal?: AbortSignal;
  rateLimiter?: AliExpressImageRateLimiter;
  onProgress?: (event: HostProgressEvent) => void | Promise<void>;
};

export type ProductCardImageForClient = {
  url: string;
  alt: string;
  position?: number;
  /** isOptimised — smaller card-sized copy hosted alongside the full image. */
  isOp?: boolean;
  /** Full-quality image URL for callers that need to opt out of card images. */
  fullUrl?: string;
};

export type HostProductImagesSuccess = {
  ok: true;
  productImages: ProductImage[];
  skuImages: ProductImage[][];
  propertyImages: Array<Array<string | null>>;
  sizeChartImage: string | null;
  uploadedKeys: string[];
  hostedCount: number;
  optimisedCount: number;
};

export type HostProductImagesFailure = {
  ok: false;
  error: HostedImageError;
  uploadedKeys: string[];
};

export class ProductImageHostError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'ProductImageHostError';
    this.code = code;
    this.retryable = retryable;
  }
}

// ─── URL classification ───────────────────────────────────────────────────────

function trimOrEmpty(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.endsWith('.internal') || host.endsWith('.lan')) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map((p) => Number(p));
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
      return true;
    const [a, b] = parts as [number, number];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  return host.includes(':');
}

export function normalizeImageUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
}

function tryParseUrl(url: string): URL | null {
  try {
    const normalized = normalizeImageUrl(url);
    if (!normalized) return null;
    if (normalized.startsWith('/')) {
      return new URL(normalized, config.storeFrontURI);
    }
    return new URL(normalized);
  } catch {
    return null;
  }
}

export function isAliExpressImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const parsed = tryParseUrl(url);
  if (!parsed) return false;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (isPrivateOrLocalHostname(parsed.hostname)) return false;
  return AE_HOST_RE.test(parsed.hostname);
}

export function isHostedReviewImageUrl(
  url: string | null | undefined,
  env: Env,
  options?: R2UrlOptions
): boolean {
  if (!url || typeof url !== 'string') return false;
  const baseUrl = getR2PublicBaseUrl(env, options);
  if (!baseUrl) return false;

  try {
    const base = new URL(baseUrl);
    const image = new URL(normalizeImageUrl(url), base);
    const reviewPrefix = `${base.pathname.replace(/\/+$/, '')}/user/reviews/`;
    return (
      image.origin === base.origin &&
      image.pathname.startsWith(reviewPrefix) &&
      image.pathname.length > reviewPrefix.length
    );
  } catch {
    return false;
  }
}

/**
 * True when the URL (relative or absolute) is one of our hosted product images.
 * Matches `/product/image/…` and the Worker-serve prefix `/api/images/product/image/…`.
 */
export function isHostedProductImagePath(
  url: string | null | undefined
): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  let pathname = trimmed;
  try {
    if (!trimmed.startsWith('/')) {
      const parsed = new URL(normalizeImageUrl(trimmed));
      pathname = parsed.pathname;
    }
  } catch {
    pathname = trimmed.split('?')[0] ?? trimmed;
  }

  const withoutServe = pathname.replace(/^\/api\/images(?=\/)/, '');
  return (
    withoutServe === '/product/image' ||
    withoutServe.startsWith(PRODUCT_IMAGE_PATH_PREFIX)
  );
}

/**
 * Convert a public or relative hosted URL back to the path we persist in the DB.
 * Returns null when the URL is not one of ours.
 */
export function toStoredProductImagePath(
  url: string | null | undefined
): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let pathname = trimmed.split('?')[0]?.split('#')[0] ?? trimmed;
  try {
    if (!trimmed.startsWith('/')) {
      const parsed = new URL(normalizeImageUrl(trimmed));
      pathname = parsed.pathname;
    }
  } catch {
    // keep pathname
  }

  const withoutServe = pathname.replace(/^\/api\/images(?=\/)/, '');
  if (!withoutServe.startsWith(PRODUCT_IMAGE_PATH_PREFIX)) return null;
  if (withoutServe.includes('..')) return null;
  return withoutServe;
}

export function hostedPathToObjectKey(path: string): string | null {
  const stored = toStoredProductImagePath(path) ?? path;
  const key = stored.replace(/^\/+/, '');
  return sanitizeObjectKey(key);
}

export function optimisedStoredPath(fullPath: string): string {
  return `${fullPath}_op.${PRODUCT_IMAGE_EXT}`;
}

/**
 * Prefix a stored `/product/image/…` path with the public R2 / Worker base.
 * Leaves AliExpress (and any other absolute) URLs untouched.
 */
export function resolveProductImageUrlForClient(
  url: string | null | undefined,
  env: Env,
  options?: R2UrlOptions
): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  const stored = toStoredProductImagePath(trimmed);
  if (!stored) return trimmed;

  const key = stored.replace(/^\/+/, '');
  const base = getR2PublicBaseUrl(env, options);
  if (!base) return stored;
  return `${stripTrailingSlash(base)}/${key}`;
}

export function resolveProductImagesForClient(
  images: ProductImage[] | null | undefined,
  env: Env,
  options?: R2UrlOptions
): ProductImage[] {
  if (!Array.isArray(images)) return [];
  return images.map((img) => ({
    ...img,
    url: resolveProductImageUrlForClient(img.url, env, options),
  }));
}

export function persistProductImageUrl(url: string): string {
  return toStoredProductImagePath(url) ?? url.trim();
}

export function persistProductImages(images: ProductImage[]): ProductImage[] {
  return images.map((img) => ({
    ...img,
    url: persistProductImageUrl(img.url),
    isOp: img.isOp === true ? true : undefined,
  }));
}

export function galleryImagesForEditor(
  images: ProductImage[] | null | undefined
): ProductImage[] {
  if (!Array.isArray(images)) return [];
  return images.filter((img) => img.isOp !== true);
}

function imagePosition(img: ProductImage, fallback: number): number {
  return typeof img.position === 'number' && Number.isFinite(img.position)
    ? img.position
    : fallback;
}

function sortedProductImages(
  images: ProductImage[] | null | undefined,
  isOp: boolean
): ProductImage[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter((img) => Boolean(img?.isOp) === isOp)
    .sort((a, b) => imagePosition(a, 0) - imagePosition(b, 0));
}

function normaliseStoredImagePath(url: string): string {
  return toStoredProductImagePath(url) ?? url.trim();
}

function pairedOptimisedImage(
  full: ProductImage,
  optimised: ProductImage[]
): ProductImage | null {
  const fullPath = normaliseStoredImagePath(full.url);
  const expected = optimisedStoredPath(fullPath);
  return (
    optimised.find((img) => normaliseStoredImagePath(img.url) === expected) ??
    null
  );
}

/**
 * Build the five-image storefront card gallery, preferring the smaller
 * isOptimised copies while retaining fullUrl metadata for fallbacks/debugging.
 */
export function productCardImagesForClient(
  images: ProductImage[] | null | undefined,
  env: Env,
  options?: R2UrlOptions,
  productName = ''
): ProductCardImageForClient[] {
  const fullImages = sortedProductImages(images, false);
  const optimised = sortedProductImages(images, true);
  const out: ProductCardImageForClient[] = [];

  for (
    let i = 0;
    i < fullImages.length && out.length < MAX_OPTIMISED_IMAGES;
    i++
  ) {
    const full = fullImages[i]!;
    if (!full || typeof full.url !== 'string') continue;

    const fullUrl = resolveProductImageUrlForClient(full.url, env, options);
    if (!fullUrl) continue;

    const op = pairedOptimisedImage(full, optimised);
    const chosen = op ?? full;
    const url = resolveProductImageUrlForClient(chosen.url, env, options);
    if (!url) continue;

    const chosenRecord = chosen as ProductImageRecord;
    const fullRecord = full as ProductImageRecord;
    const alt =
      composeProductImageAlt(productName, {
        ...fullRecord,
        forVariant: chosenRecord.forVariant || fullRecord.forVariant,
        alt: chosenRecord.alt || fullRecord.alt,
      }) || productName;
    const position = imagePosition(full, out.length);
    const item: ProductCardImageForClient = { url, alt, position };
    if (op) {
      item.isOp = true;
      item.fullUrl = fullUrl;
    }
    out.push(item);
  }

  return out;
}

export function productNeedsImageHosting(
  images: ProductImage[] | null | undefined,
  extraUrls: Array<string | null | undefined> = []
): boolean {
  for (const img of images ?? []) {
    if (img.isOp === true) continue;
    if (isAliExpressImageUrl(img.url)) return true;
  }
  for (const url of extraUrls) {
    if (url && isAliExpressImageUrl(url)) return true;
  }
  return false;
}

// ─── AliExpress transform ─────────────────────────────────────────────────────

export function stripAeImageTransform(url: string): string {
  const normalized = normalizeImageUrl(url);
  if (!normalized) return '';
  const withoutHash = normalized.split('#')[0] ?? normalized;
  const withoutQuery = withoutHash.split('?')[0] ?? withoutHash;
  return withoutQuery.replace(ORIGINAL_EXT_RE, '.$1');
}

export function applyAeImageTransform(url: string, transform: string): string {
  const base = stripAeImageTransform(url);
  if (!base) return url;
  return `${base}${transform}`;
}

export function aeImageIdentity(url: string): string {
  return stripAeImageTransform(url).toLowerCase();
}

// ─── Fetch + upload ───────────────────────────────────────────────────────────

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ProductImageHostError(
      'UPLOAD_ABORTED',
      'Image upload was cancelled.'
    );
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  assertNotAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(
        new ProductImageHostError(
          'UPLOAD_ABORTED',
          'Image upload was cancelled.'
        )
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/**
 * Pace requests within one import. This is deliberately scoped to the batch:
 * Worker isolates are not a shared/distributed rate-limit store.
 */
export function createAliExpressImageRateLimiter(
  intervalMs = ALIEXPRESS_IMAGE_REQUEST_INTERVAL_MS,
  maxRequests = MAX_ALIEXPRESS_REQUESTS_PER_HOSTING_INVOCATION
): AliExpressImageRateLimiter {
  let queue = Promise.resolve();
  let nextRequestAt = 0;
  let requestsStarted = 0;

  return async (signal) => {
    let release = () => {};
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = queue;
    queue = previous.then(() => slot);
    await previous;

    try {
      assertNotAborted(signal);
      if (requestsStarted >= maxRequests) {
        throw new ProductImageHostError(
          'ALIEXPRESS_REQUEST_BUDGET_EXCEEDED',
          `AliExpress request budget of ${maxRequests} requests was reached. Split the remaining images into another batch.`
        );
      }
      const waitMs = nextRequestAt - Date.now();
      if (waitMs > 0) await abortableDelay(waitMs, signal);
      assertNotAborted(signal);
      requestsStarted += 1;
      nextRequestAt = Date.now() + intervalMs;
    } finally {
      release();
    }
  };
}

async function fetchAliExpressImageAttempt(
  sourceUrl: string,
  signal?: AbortSignal,
  accept = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  rateLimiter?: AliExpressImageRateLimiter
): Promise<{ body: ArrayBuffer; contentType: string }> {
  if (!isAliExpressImageUrl(sourceUrl)) {
    throw new ProductImageHostError(
      'INVALID_SOURCE_URL',
      'Only AliExpress CDN image URLs can be hosted.'
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const headers = new Headers();
    headers.set(
      'User-Agent',
      `Mozilla/5.0 (compatible; ${config.brandName}ImageHost/1.0; +${config.brandDomain})`
    );
    headers.set('Accept', accept);
    headers.set('Accept-Language', 'en-US,en;q=0.9');
    headers.set('Referer', 'https://www.aliexpress.com/');

    await rateLimiter?.(signal);
    assertNotAborted(signal);
    let response = await fetch(sourceUrl, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (!location) {
        throw new ProductImageHostError(
          'IMAGE_FETCH_FAILED',
          'AliExpress redirected an image without a Location header.'
        );
      }
      let redirectUrl: URL;
      try {
        redirectUrl = new URL(location, sourceUrl);
      } catch {
        throw new ProductImageHostError(
          'IMAGE_FETCH_FAILED',
          'AliExpress returned an invalid image redirect.'
        );
      }
      if (!isAliExpressImageUrl(redirectUrl.toString())) {
        throw new ProductImageHostError(
          'IMAGE_FETCH_FAILED',
          'AliExpress redirected an image to a host we do not allow.'
        );
      }
      await rateLimiter?.(signal);
      assertNotAborted(signal);
      response = await fetch(redirectUrl.toString(), {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: controller.signal,
      });
    }

    if (!response.ok) {
      throw new ProductImageHostError(
        'IMAGE_FETCH_FAILED',
        `AliExpress returned HTTP ${response.status} for a product image.`,
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
      );
    }

    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase();
    if (contentType && !IMAGE_CONTENT_TYPES.has(contentType)) {
      throw new ProductImageHostError(
        'IMAGE_FETCH_FAILED',
        'AliExpress returned a non-image response for a product image.'
      );
    }

    const lengthHeader = response.headers.get('content-length');
    if (lengthHeader) {
      const len = Number.parseInt(lengthHeader, 10);
      if (Number.isFinite(len) && len > MAX_IMAGE_BYTES) {
        throw new ProductImageHostError(
          'IMAGE_TOO_LARGE',
          'A product image is larger than 8 MB and cannot be hosted.'
        );
      }
    }

    const body = await response.arrayBuffer();
    if (body.byteLength === 0) {
      throw new ProductImageHostError(
        'IMAGE_FETCH_FAILED',
        'AliExpress returned an empty image.'
      );
    }
    if (body.byteLength > MAX_IMAGE_BYTES) {
      throw new ProductImageHostError(
        'IMAGE_TOO_LARGE',
        'A product image is larger than 8 MB and cannot be hosted.'
      );
    }

    return {
      body,
      contentType:
        contentType && IMAGE_CONTENT_TYPES.has(contentType)
          ? contentType
          : 'image/avif',
    };
  } catch (error) {
    if (error instanceof ProductImageHostError) throw error;
    if (signal?.aborted) {
      throw new ProductImageHostError(
        'UPLOAD_ABORTED',
        'Image upload was cancelled.'
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProductImageHostError(
        'IMAGE_FETCH_TIMEOUT',
        'Timed out downloading a product image from AliExpress.',
        true
      );
    }
    throw new ProductImageHostError(
      'IMAGE_FETCH_FAILED',
      error instanceof Error
        ? `AliExpress image request failed: ${error.message}`
        : 'AliExpress image request failed.',
      true
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function fetchAliExpressImage(
  sourceUrl: string,
  signal?: AbortSignal,
  accept = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  rateLimiter?: AliExpressImageRateLimiter
): Promise<{ body: ArrayBuffer; contentType: string }> {
  let lastError: ProductImageHostError | null = null;

  for (let attempt = 1; attempt <= IMAGE_FETCH_MAX_RETRIES + 1; attempt++) {
    try {
      return await fetchAliExpressImageAttempt(
        sourceUrl,
        signal,
        accept,
        rateLimiter
      );
    } catch (error) {
      const mapped =
        error instanceof ProductImageHostError
          ? error
          : new ProductImageHostError(
              'IMAGE_FETCH_FAILED',
              'AliExpress image request failed.',
              true
            );
      if (mapped.code === 'UPLOAD_ABORTED' || signal?.aborted) throw mapped;
      lastError = mapped;

      if (!mapped.retryable || attempt > IMAGE_FETCH_MAX_RETRIES) {
        const attemptSummary =
          attempt > 1
            ? ` after ${attempt} attempts (${attempt - 1} retries)`
            : '';
        throw new ProductImageHostError(
          mapped.code,
          `Failed to download image from AliExpress${attemptSummary}. Image URL: ${sourceUrl}. ${mapped.message}`
        );
      }

      await abortableDelay(500 * 2 ** (attempt - 1), signal);
    }
  }

  throw new ProductImageHostError(
    lastError?.code ?? 'IMAGE_FETCH_FAILED',
    `Failed to download image from AliExpress. Image URL: ${sourceUrl}.`
  );
}

async function putWithRetry(
  env: Env,
  key: string,
  body: ArrayBuffer,
  contentType: string,
  origin?: string
): Promise<void> {
  let lastMessage = 'Failed to upload image to object storage.';
  for (let attempt = 1; attempt <= R2_UPLOAD_ATTEMPTS; attempt++) {
    const result = await uploadToR2(
      env,
      {
        key,
        body,
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
        customMetadata: { source: 'ae-product-host' },
      },
      { origin }
    );
    if (result.ok) return;
    lastMessage = result.error.message;
    if (result.error.code === 'R2_NOT_CONFIGURED') {
      throw new ProductImageHostError(result.error.code, result.error.message);
    }
  }
  throw new ProductImageHostError(
    'R2_UPLOAD_FAILED',
    `${lastMessage} Tried ${R2_UPLOAD_ATTEMPTS} times.`
  );
}

/**
 * Fetch review photos on the server and store WebP copies under
 * `user/reviews/`, keeping upload traffic off the admin's connection.
 */
export async function hostAliExpressReviewImages(input: {
  env: Env;
  imageUrls: string[][];
  origin?: string;
  signal?: AbortSignal;
  rateLimiter?: AliExpressImageRateLimiter;
  onProgress?: (event: HostProgressEvent) => void | Promise<void>;
}): Promise<
  | {
      ok: true;
      imageUrls: string[][];
      uploadedKeys: string[];
      hostedCount: number;
    }
  | { ok: false; error: HostedImageError; uploadedKeys: string[] }
> {
  const total = input.imageUrls.reduce(
    (sum, images) =>
      sum + images.filter((url) => isAliExpressImageUrl(url)).length,
    0
  );
  const uploadedKeys: string[] = [];
  const hostedImages = input.imageUrls.map((images) =>
    images.map((url) => (isAliExpressImageUrl(url) ? '' : url))
  );
  const rateLimiter = input.rateLimiter ?? createAliExpressImageRateLimiter();
  if (total === 0) {
    return { ok: true, imageUrls: hostedImages, uploadedKeys, hostedCount: 0 };
  }

  let cursor = 0;
  let completed = 0;
  let failure: HostedImageError | null = null;
  const jobs = input.imageUrls.flatMap((urls, reviewIndex) =>
    urls.flatMap((url, imageIndex) =>
      isAliExpressImageUrl(url) ? [{ url, reviewIndex, imageIndex }] : []
    )
  );

  const worker = async () => {
    while (!failure) {
      const jobIndex = cursor++;
      const job = jobs[jobIndex];
      if (!job) return;
      try {
        assertNotAborted(input.signal);
        const { body, contentType } = await fetchAliExpressImage(
          applyAeImageTransform(job.url, '_640x640q75.jpg_.webp'),
          input.signal,
          'image/webp,image/*,*/*;q=0.8',
          rateLimiter
        );
        if (contentType !== 'image/webp' || !isWebPBuffer(body)) {
          throw new ProductImageHostError(
            'REVIEW_IMAGE_CONVERSION_FAILED',
            `AliExpress did not return a valid WebP review image. Image URL: ${job.url}. Please retry or remove this review photo.`
          );
        }

        const key = `user/reviews/${nanoid()}.webp`;
        try {
          await putWithRetry(input.env, key, body, 'image/webp', input.origin);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown storage error.';
          throw new ProductImageHostError(
            error instanceof ProductImageHostError
              ? error.code
              : 'REVIEW_IMAGE_UPLOAD_FAILED',
            `Failed to upload review image. Image URL: ${job.url}. ${message}`
          );
        }
        uploadedKeys.push(key);
        const url = buildPublicObjectUrl(input.env, key, {
          origin: input.origin,
        });
        if (!url) {
          throw new ProductImageHostError(
            'R2_PUBLIC_URL_UNAVAILABLE',
            'Could not create a public URL for a hosted review image.'
          );
        }
        hostedImages[job.reviewIndex]![job.imageIndex] = url;
      } catch (error) {
        failure =
          error instanceof ProductImageHostError
            ? {
                code: error.code,
                message: error.message.includes(job.url)
                  ? error.message
                  : `${error.message} Image URL: ${job.url}`,
              }
            : {
                code: 'REVIEW_IMAGE_UPLOAD_FAILED',
                message: `Failed to host review image ${job.url}.`,
              };
        return;
      }

      completed++;
      await input.onProgress?.({
        current: completed,
        total,
        message: `Uploading review images (${completed}/${total})…`,
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker())
  );

  if (failure) {
    return { ok: false, error: failure, uploadedKeys };
  }
  return {
    ok: true,
    imageUrls: hostedImages,
    uploadedKeys,
    hostedCount: total,
  };
}

export async function deleteUploadedProductImageKeys(
  env: Env,
  keys: string[]
): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))];
  await Promise.all(
    unique.map(async (key) => {
      try {
        await deleteFromR2(env, key);
      } catch (error) {
        console.error('Failed to roll back hosted product image:', key, error);
      }
    })
  );
}

function slugSegment(slug: string): string {
  const clean = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_IN_KEY);
  return clean || 'product';
}

function buildHostedPaths(slug: string): {
  key: string;
  path: string;
  opKey: string;
  opPath: string;
} {
  const filename = `${slugSegment(slug)}-${nanoid(8)}.${PRODUCT_IMAGE_EXT}`;
  const key = `${PRODUCT_IMAGE_KEY_PREFIX}/${filename}`;
  const path = `${PRODUCT_IMAGE_PATH_PREFIX}${filename}`;
  return {
    key,
    path,
    opKey: `${key}_op.${PRODUCT_IMAGE_EXT}`,
    opPath: optimisedStoredPath(path),
  };
}

type UploadJob = {
  identity: string;
  sourceUrl: string;
  transform: string;
  key: string;
  path: string;
  kind: 'full' | 'optimised';
  label: string;
};

async function runPool<T>(
  items: T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  let failure: unknown = null;

  const run = async () => {
    while (next < items.length && !failure) {
      assertNotAborted(signal);
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      try {
        await worker(item, index);
      } catch (error) {
        failure = error;
      }
    }
  };

  const size = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: size }, () => run()));
  if (failure) throw failure;
}

function collectRemoteUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (isHostedProductImagePath(trimmed)) return null;
  if (!isAliExpressImageUrl(trimmed)) return null;
  return normalizeImageUrl(trimmed);
}

/**
 * Download AliExpress images on the Worker, upload them to R2, and rewrite
 * product / SKU / property / size-chart URLs to stored paths.
 *
 * On any hard failure the caller MUST delete `uploadedKeys`.
 */
export async function hostProductImages(
  input: HostProductImagesInput
): Promise<HostProductImagesSuccess | HostProductImagesFailure> {
  const uploadedKeys: string[] = [];
  const rateLimiter = input.rateLimiter ?? createAliExpressImageRateLimiter();

  try {
    if (!hasR2Binding(input.env)) {
      throw new ProductImageHostError(
        'R2_NOT_CONFIGURED',
        'Object storage is not configured. Bind R2_IMAGES in wrangler.jsonc.'
      );
    }

    const gallery = [...input.productImages].sort((a, b) => {
      const ap = typeof a.position === 'number' ? a.position : 0;
      const bp = typeof b.position === 'number' ? b.position : 0;
      return ap - bp;
    });

    const identityToFull = new Map<
      string,
      { path: string; key: string; opPath: string; opKey: string }
    >();

    const jobs: UploadJob[] = [];
    const seenFull = new Set<string>();

    const ensureFullJob = (rawUrl: string, label: string) => {
      const identity = aeImageIdentity(rawUrl);
      if (!identity) return;
      const existing = identityToFull.get(identity);
      if (existing) return existing;
      if (seenFull.has(identity)) return identityToFull.get(identity);

      const paths = buildHostedPaths(input.slug);
      identityToFull.set(identity, paths);
      seenFull.add(identity);
      jobs.push({
        identity,
        sourceUrl: applyAeImageTransform(rawUrl, AE_FULL_TRANSFORM),
        transform: AE_FULL_TRANSFORM,
        key: paths.key,
        path: paths.path,
        kind: 'full',
        label,
      });
      return paths;
    };

    for (const img of gallery) {
      const remote = collectRemoteUrl(img.url);
      if (remote) ensureFullJob(remote, 'product image');
    }
    for (const sku of input.skuImages) {
      for (const img of sku) {
        const remote = collectRemoteUrl(img.url);
        if (remote) ensureFullJob(remote, 'variant image');
      }
    }
    for (const props of input.propertyImages) {
      for (const url of props) {
        const remote = collectRemoteUrl(url);
        if (remote) ensureFullJob(remote, 'variant swatch');
      }
    }
    {
      const remote = collectRemoteUrl(input.sizeChartImage);
      if (remote) ensureFullJob(remote, 'size chart');
    }

    const opIdentities = new Set<string>();
    const requestedOptimisedIdentities = input.optimisedImageUrls
      ? new Set(input.optimisedImageUrls.map(aeImageIdentity))
      : null;
    let opCount = 0;
    for (const img of gallery) {
      if (img.isOp === true) continue;
      if (opCount >= MAX_OPTIMISED_IMAGES) break;
      const remote = collectRemoteUrl(img.url);
      if (!remote) continue;
      const identity = aeImageIdentity(remote);
      if (
        requestedOptimisedIdentities &&
        !requestedOptimisedIdentities.has(identity)
      ) {
        continue;
      }
      const paths = identityToFull.get(identity);
      if (!paths || opIdentities.has(identity)) continue;
      opIdentities.add(identity);
      opCount += 1;
      jobs.push({
        identity,
        sourceUrl: applyAeImageTransform(remote, AE_OP_TRANSFORM),
        transform: AE_OP_TRANSFORM,
        key: paths.opKey,
        path: paths.opPath,
        kind: 'optimised',
        label: 'card image',
      });
    }

    const total = jobs.length;
    if (total === 0) {
      return {
        ok: true,
        productImages: persistProductImages(input.productImages),
        skuImages: input.skuImages.map((imgs) => persistProductImages(imgs)),
        propertyImages: input.propertyImages.map((props) =>
          props.map((url) => (url ? persistProductImageUrl(url) : url))
        ),
        sizeChartImage: input.sizeChartImage
          ? persistProductImageUrl(input.sizeChartImage)
          : null,
        uploadedKeys,
        hostedCount: 0,
        optimisedCount: 0,
      };
    }

    await input.onProgress?.({
      current: 0,
      total,
      message: `Preparing ${total} image${total === 1 ? '' : 's'} for upload…`,
    });

    let completed = 0;
    await runPool(jobs, CONCURRENCY, input.signal, async (job) => {
      assertNotAborted(input.signal);
      let fetched: { body: ArrayBuffer; contentType: string };
      try {
        fetched = await fetchAliExpressImage(
          job.sourceUrl,
          input.signal,
          undefined,
          rateLimiter
        );
      } catch (error) {
        if (error instanceof ProductImageHostError) throw error;
        throw new ProductImageHostError(
          'IMAGE_FETCH_FAILED',
          `Failed to download ${job.label}. Image URL: ${job.sourceUrl}.`,
          false
        );
      }
      assertNotAborted(input.signal);
      try {
        await putWithRetry(
          input.env,
          job.key,
          fetched.body,
          fetched.contentType,
          input.origin
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown storage error.';
        throw new ProductImageHostError(
          error instanceof ProductImageHostError
            ? error.code
            : 'R2_UPLOAD_FAILED',
          `Failed to upload ${job.label} to object storage. Image URL: ${job.sourceUrl}. ${message}`
        );
      }
      uploadedKeys.push(job.key);
      completed += 1;
      const kindLabel =
        job.kind === 'optimised' ? 'optimised card image' : job.label;
      await input.onProgress?.({
        current: completed,
        total,
        message: `Uploaded ${kindLabel} (${completed} of ${total})`,
      });
    });

    const rewriteUrl = (url: string | null | undefined): string | null => {
      if (!url) return url ?? null;
      const trimmed = url.trim();
      if (!trimmed) return null;
      if (isHostedProductImagePath(trimmed)) {
        return persistProductImageUrl(trimmed);
      }
      if (!isAliExpressImageUrl(trimmed)) return trimmed;
      const identity = aeImageIdentity(trimmed);
      const hosted = identityToFull.get(identity);
      return hosted?.path ?? persistProductImageUrl(trimmed);
    };

    const rewriteImage = (img: ProductImage, index: number): ProductImage => {
      const nextUrl = rewriteUrl(img.url) ?? img.url;
      return {
        ...img,
        url: nextUrl,
        position: typeof img.position === 'number' ? img.position : index,
        isOp: img.isOp === true ? true : undefined,
      };
    };

    const fullGallery = gallery
      .filter((img) => img.isOp !== true)
      .map((img, index) => rewriteImage(img, index));

    const opGallery: ProductImage[] = [];
    for (const img of fullGallery) {
      if (opGallery.length >= MAX_OPTIMISED_IMAGES) break;
      const identity = aeImageIdentity(img.url);
      // After rewrite, identity of a hosted path won't match AE identity.
      // Pair by stored path instead.
      const opPath = optimisedStoredPath(img.url);
      const wasHostedNow = jobs.some(
        (job) => job.kind === 'optimised' && job.path === opPath
      );
      if (!wasHostedNow) continue;
      opGallery.push({
        url: opPath,
        forVariant: img.forVariant,
        variantKeys: img.variantKeys,
        position: img.position,
        isOp: true,
      });
      void identity;
    }

    const productImages = [...fullGallery, ...opGallery];

    const skuImages = input.skuImages.map((imgs) =>
      imgs.map((img, index) => rewriteImage(img, index))
    );
    const propertyImages = input.propertyImages.map((props) =>
      props.map((url) => rewriteUrl(url))
    );
    const sizeChartImage = rewriteUrl(input.sizeChartImage);

    return {
      ok: true,
      productImages,
      skuImages,
      propertyImages,
      sizeChartImage,
      uploadedKeys,
      hostedCount: jobs.filter((j) => j.kind === 'full').length,
      optimisedCount: jobs.filter((j) => j.kind === 'optimised').length,
    };
  } catch (error) {
    const mapped =
      error instanceof ProductImageHostError
        ? { code: error.code, message: error.message }
        : {
            code: 'IMAGE_HOST_FAILED',
            message:
              'Failed to host product images. Uploaded files were rolled back.',
          };
    return { ok: false, error: mapped, uploadedKeys };
  }
}

export async function hostAliExpressOptimisedProductImages(input: {
  env: Env;
  images: Array<{ sourceUrl: string; fullImagePath: string }>;
  origin?: string;
  signal?: AbortSignal;
  rateLimiter?: AliExpressImageRateLimiter;
  onProgress?: (event: HostProgressEvent) => void | Promise<void>;
}): Promise<
  | {
      ok: true;
      images: Array<{ sourceUrl: string; optimisedImagePath: string }>;
      uploadedKeys: string[];
    }
  | { ok: false; error: HostedImageError; uploadedKeys: string[] }
> {
  const uploadedKeys: string[] = [];
  try {
    if (input.images.length > MAX_OPTIMISED_IMAGES) {
      throw new ProductImageHostError(
        'TOO_MANY_OPTIMISED_IMAGES',
        `At most ${MAX_OPTIMISED_IMAGES} product card images can be optimised.`
      );
    }
    if (!hasR2Binding(input.env)) {
      throw new ProductImageHostError(
        'R2_NOT_CONFIGURED',
        'Object storage is not configured. Bind R2_IMAGES in wrangler.jsonc.'
      );
    }

    const images = input.images.map(({ sourceUrl, fullImagePath }) => {
      const storedPath = toStoredProductImagePath(fullImagePath);
      if (
        !isAliExpressImageUrl(sourceUrl) ||
        !storedPath ||
        !storedPath.startsWith(PRODUCT_IMAGE_PATH_PREFIX)
      ) {
        throw new ProductImageHostError(
          'INVALID_OPTIMISED_IMAGE',
          'The product image source or hosted full-image path is invalid.'
        );
      }
      const fullKey = storedPath.replace(/^\/+/, '');
      return {
        sourceUrl,
        fetchUrl: applyAeImageTransform(sourceUrl, AE_OP_TRANSFORM),
        key: `${fullKey}_op.${PRODUCT_IMAGE_EXT}`,
        path: optimisedStoredPath(storedPath),
      };
    });

    const rateLimiter = input.rateLimiter ?? createAliExpressImageRateLimiter();
    await input.onProgress?.({
      current: 0,
      total: images.length,
      message: `Preparing ${images.length} optimised card image${images.length === 1 ? '' : 's'}…`,
    });

    let completed = 0;
    await runPool(images, CONCURRENCY, input.signal, async (image) => {
      const fetched = await fetchAliExpressImage(
        image.fetchUrl,
        input.signal,
        undefined,
        rateLimiter
      );
      assertNotAborted(input.signal);
      try {
        await putWithRetry(
          input.env,
          image.key,
          fetched.body,
          fetched.contentType,
          input.origin
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown storage error.';
        throw new ProductImageHostError(
          error instanceof ProductImageHostError
            ? error.code
            : 'R2_UPLOAD_FAILED',
          `Failed to upload optimised card image. Image URL: ${image.sourceUrl}. ${message}`
        );
      }
      uploadedKeys.push(image.key);
      completed += 1;
      await input.onProgress?.({
        current: completed,
        total: images.length,
        message: `Uploaded optimised card image (${completed} of ${images.length})`,
      });
    });

    return {
      ok: true,
      images: images.map(({ sourceUrl, path }) => ({
        sourceUrl,
        optimisedImagePath: path,
      })),
      uploadedKeys,
    };
  } catch (error) {
    const mapped =
      error instanceof ProductImageHostError
        ? { code: error.code, message: error.message }
        : {
            code: 'IMAGE_HOST_FAILED',
            message: 'Failed to host optimised product images.',
          };
    return { ok: false, error: mapped, uploadedKeys };
  }
}

export function requestOriginFromUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function encodeSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
}

export type HostSseWriter = (event: string, data: unknown) => void;

/**
 * Native ReadableStream SSE (not Hono streamSSE). Hono's helper sets
 * Transfer-Encoding: chunked, which wrangler / Cloudflare often buffer
 * until the stream ends — hiding progress from the admin UI.
 */
export function createProductHostSseResponse(
  request: Request,
  run: (write: HostSseWriter, signal: AbortSignal) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const clientSignal = request.signal;
  const ac = new AbortController();
  const abort = () => {
    if (!ac.signal.aborted) ac.abort();
  };

  if (clientSignal.aborted) abort();
  else clientSignal.addEventListener('abort', abort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write: HostSseWriter = (event, data) => {
        if (ac.signal.aborted) return;
        try {
          controller.enqueue(encodeSse(event, data));
        } catch {
          abort();
        }
      };

      try {
        controller.enqueue(encoder.encode(': connected\n\n'));
      } catch {
        abort();
        return;
      }

      const heartbeat = setInterval(() => {
        if (ac.signal.aborted) return;
        try {
          controller.enqueue(encodeSse('ping', {}));
        } catch {
          abort();
        }
      }, PRODUCT_HOST_SSE_HEARTBEAT_MS);

      try {
        await run(write, ac.signal);
      } catch (error) {
        if (!ac.signal.aborted) {
          console.error('Product image host stream error:', error);
          const mapped =
            error instanceof ProductImageHostError
              ? { code: error.code, message: error.message }
              : {
                  code: 'IMAGE_HOST_FAILED',
                  message: 'Failed to host product images.',
                };
          write('error', { success: false, ...mapped, error: mapped.message });
        }
      } finally {
        clearInterval(heartbeat);
        clientSignal.removeEventListener('abort', abort);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
