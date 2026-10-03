import { Hono } from 'hono';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { nanoid } from 'nanoid';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  categories,
  productAttributes,
  productCategories,
  products,
  productSkus,
  reviews as productReviews,
  skuProperties,
  type Database,
  type ProductImage,
  type ProductVideo,
  calculateProductDefaultPrice,
  calculateProductDefaultEstProfit,
} from '@repo/db';
import { errorJson, type AppEnv, type AppContext } from '@/utils/http/errorJson';
import {
  requireAdminMiddleware,
  requireAnyPermission,
  getActor,
  getDb,
} from '@/middleware/permission';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  logAuditFromContext,
} from '@/utils/admin/auditLog';
import { incrementAdminProductsAdded } from '@/utils/admin/adminStats';
import { invalidateHomepageCache } from '@/utils/store-ui/homepageContent';
import {
  MAX_IMAGES_PER_HOSTING_INVOCATION,
  MAX_OPTIMISED_IMAGES_PER_HOSTING_INVOCATION,
  MAX_OPTIMISED_IMAGES,
  PRODUCT_IMAGE_IMPORT_SESSION_TTL_SECONDS,
  createAliExpressImageRateLimiter,
  createProductHostSseResponse,
  deleteUploadedProductImageKeys,
  aeImageIdentity,
  hostAliExpressOptimisedProductImages,
  hostProductImages,
  isAliExpressImageUrl,
  isHostedReviewImageUrl,
  persistProductImageUrl,
  persistProductImages,
  optimisedStoredPath,
  toStoredProductImagePath,
  requestOriginFromUrl,
  hostAliExpressReviewImages,
} from '@/utils/images/productImageHost';

// ─── Limits ───────────────────────────────────────────────────────────────────

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 300;
const MAX_SLUG_LENGTH = 180;
const MAX_DESCRIPTION_LENGTH = 100_000;
const MAX_MOBILE_DETAIL_LENGTH = 200_000;
const MAX_META_TITLE_LENGTH = 120;
const MAX_META_DESCRIPTION_LENGTH = 320;
const MAX_NOTES_LENGTH = 5000;
const MAX_URL_LENGTH = 2048;
const MAX_ALT_LENGTH = 300;
const MAX_FOR_VARIANT_LENGTH = 80;
const MAX_TAG_LENGTH = 64;
const MAX_TAGS = 40;
const MAX_IMAGES = 60;
const MAX_VIDEOS = 20;
const MAX_SKUS = 200;
const MAX_PROPERTIES_PER_SKU = 20;
const MAX_ATTRIBUTES = 100;
const MAX_REVIEWS = 347;
const MAX_REVIEW_IMAGES = 5;
const MAX_REVIEW_COMMENT_LENGTH = 5000;
const REVIEW_PAGE_SIZE = 20;
const MAX_CATEGORIES = 20;
const MAX_VARIANT_KEYS = 30;
/** Fixed buffer for payment-processor fees / tax leakage ($1.50 in cents). */
const PAYMENT_PROCESSOR_FEE_CENTS = 150;
const MAX_VARIANT_KEY_LENGTH = 120;
const MAX_SKU_CODE_LENGTH = 80;
const MAX_ATTR_NAME_LENGTH = 120;
const MAX_ATTR_VALUE_LENGTH = 500;
const MAX_PROPERTY_NAME_LENGTH = 120;
const MAX_PROPERTY_VALUE_LENGTH = 200;
const MAX_AE_ID_LENGTH = 64;
const MAX_BODY_BYTES = 2_500_000; // ~2.5MB
const INSERT_CHUNK_SIZE = 5;
const D1_BATCH_SIZE = 100;
const IMAGE_IMPORT_SESSION_PREFIX = 'admin:product-image-import:';

const SAFE_URL_RE = /^(https?:\/\/|\/\/)/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_RE = /^[A-Za-z0-9_-]+$/;
const IMAGE_IMPORT_ID_RE = /^[A-Za-z0-9-]{36}$/;

type ProductImageImportSession = {
  actorId: string;
  uploadedKeys: string[];
  completed?: boolean;
};

function imageImportSessionKey(id: string): string {
  return `${IMAGE_IMPORT_SESSION_PREFIX}${id}`;
}

async function readImageImportSession(
  kv: KVNamespace,
  id: string
): Promise<ProductImageImportSession | null> {
  const raw = await kv.get(imageImportSessionKey(id));
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      typeof value.actorId !== 'string' ||
      !Array.isArray(value.uploadedKeys) ||
      !value.uploadedKeys.every((key) => typeof key === 'string')
    ) {
      throw new Error('Invalid product image import session data.');
    }
    return {
      actorId: value.actorId,
      uploadedKeys: value.uploadedKeys,
      completed: value.completed === true,
    };
  } catch (error) {
    console.error('Invalid product image import session:', id, error);
    throw error;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

const TOAST_NAME_MAX_WORDS = 5;
const TOAST_NAME_MAX_CHARS = 48;

/** Short label for toast copy. Full product name stays on `data.name`. */
function truncateNameForMessage(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) return name;

  const words = normalized.split(' ');
  const overWordLimit = words.length > TOAST_NAME_MAX_WORDS;
  let short = overWordLimit
    ? words.slice(0, TOAST_NAME_MAX_WORDS).join(' ')
    : normalized;

  if (short.length > TOAST_NAME_MAX_CHARS) {
    short = short.slice(0, TOAST_NAME_MAX_CHARS).trimEnd();
    return `${short}...`;
  }

  return overWordLimit ? `${short}...` : short;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_SLUG_LENGTH);
}

function isValidId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_ID_LENGTH && ID_RE.test(id);
}

function isSafeUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  if (!SAFE_URL_RE.test(url) && !url.startsWith('/')) return false;
  // Block javascript:/data: schemes even if they sneak past
  const lower = url.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('data:text'))
    return false;
  return true;
}

/**
 * Strip dangerous HTML from mobile detail / descriptions.
 * Allows common product-description tags only.
 */
function sanitizeHtml(input: string): string {
  let html = input;
  // Remove script/style/iframe/object/embed/form and event handlers
  html = html.replace(
    /<\s*(script|style|iframe|object|embed|form|link|meta|base)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ''
  );
  html = html.replace(
    /<\s*(script|style|iframe|object|embed|form|link|meta|base)[^>]*\/?\s*>/gi,
    ''
  );
  html = html.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '');
  html = html.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  html = html.replace(/javascript\s*:/gi, '');
  html = html.replace(/data\s*:\s*text\/html/gi, '');
  return html;
}

/**
 * Minimal markdown → HTML for mobile descriptions when client sends markdown.
 * Prefer client-sent HTML; this is a safe fallback.
 */
function markdownToHtml(md: string): string {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  let html = escaped;
  // Code blocks
  html = html.replace(
    /```([\s\S]*?)```/g,
    (_m, code: string) => `<pre><code>${code.trim()}</code></pre>`
  );
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Images ![alt](url)
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, alt: string, url: string) => {
      const safeUrl = isSafeUrl(url.trim()) ? url.trim() : '';
      if (!safeUrl) return '';
      return `<img src="${safeUrl}" alt="${alt}" />`;
    }
  );
  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, text: string, url: string) => {
      const safeUrl = isSafeUrl(url.trim()) ? url.trim() : '#';
      return `<a href="${safeUrl}" rel="noopener noreferrer" target="_blank">${text}</a>`;
    }
  );
  // Unordered lists
  html = html.replace(/^(?:- |\* )(.+)(?:\n(?:- |\* ).+)*/gm, (block) => {
    const items = block
      .split('\n')
      .map((line) => line.replace(/^(?:- |\* )/, '').trim())
      .filter(Boolean)
      .map((item) => `<li>${item}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });
  // Paragraphs
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^<(h[1-6]|ul|ol|pre|p|img|blockquote)/i.test(trimmed)) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, '<br />')}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  return sanitizeHtml(html);
}

function sanitizeOptionalString(
  value: unknown,
  max: number
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

function sanitizeRequiredString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function sanitizeInteger(
  value: unknown,
  opts: { min?: number; max?: number; required?: boolean } = {}
): number | null | undefined {
  if (value === undefined) return opts.required ? null : undefined;
  if (value === null) return opts.required ? null : null;

  let n: number;
  if (typeof value === 'number' && Number.isFinite(value)) {
    n = Math.floor(value);
  } else if (typeof value === 'string' && value.trim() !== '') {
    n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return null;
  } else {
    return null;
  }

  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return n;
}

function sanitizeFloat(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function chunkArray<T>(items: T[], size = INSERT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function sanitizeUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isSafeUrl(trimmed)) return undefined;
  return truncate(trimmed, MAX_URL_LENGTH);
}

function sanitizeProductImage(
  value: unknown,
  index: number
): ProductImage | null {
  if (!isRecord(value)) return null;
  const url = sanitizeUrl(value.url);
  if (!url) return null;

  let forVariant: string | undefined;
  if (typeof value.forVariant === 'string') {
    const trimmed = truncate(value.forVariant.trim(), MAX_FOR_VARIANT_LENGTH);
    if (trimmed) forVariant = trimmed;
  }

  let variantKeys: string[] | undefined;
  if (Array.isArray(value.variantKeys)) {
    const keys = value.variantKeys
      .filter((k): k is string => typeof k === 'string')
      .map((k) => truncate(k.trim(), MAX_VARIANT_KEY_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_VARIANT_KEYS);
    if (keys.length > 0) variantKeys = keys;
  }

  const position =
    sanitizeInteger(value.position, { min: 0, max: 10_000 }) ?? index;

  const persistedUrl = persistProductImageUrl(url);
  const isOp = value.isOp === true ? true : undefined;

  return { url: persistedUrl, forVariant, variantKeys, position, isOp };
}

function sanitizeProductVideo(value: unknown): ProductVideo | null {
  if (!isRecord(value)) return null;
  const url = sanitizeUrl(value.url);
  if (!url) return null;

  const poster = sanitizeUrl(value.poster);
  if (poster === undefined && value.poster !== undefined) return null;

  let alt: string | undefined;
  if (typeof value.alt === 'string') {
    alt = truncate(value.alt.trim(), MAX_ALT_LENGTH) || undefined;
  }

  return {
    url,
    poster: poster === undefined ? null : poster,
    alt,
  };
}

function sanitizeTags(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;

  const tags: string[] = [];
  const seen = new Set<string>();

  for (const item of value.slice(0, MAX_TAGS)) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

async function ensureUniqueSlug(
  db: Database,
  baseSlug: string,
  excludeId?: string
): Promise<string> {
  let candidate = baseSlug.slice(0, MAX_SLUG_LENGTH) || 'product';
  let attempt = 0;

  while (attempt < 50) {
    const [existing] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        excludeId
          ? and(
              eq(products.slug, candidate),
              sql`${products.id} != ${excludeId}`
            )
          : eq(products.slug, candidate)
      )
      .limit(1);

    if (!existing) return candidate;

    attempt += 1;
    const suffix = `-${attempt + 1}`;
    candidate = `${baseSlug.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
  }

  return `${baseSlug.slice(0, MAX_SLUG_LENGTH - 10)}-${nanoid(8)}`;
}

async function readJsonObject(
  c: AppContext
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const contentLength = c.req.header('content-length');
  if (contentLength) {
    const len = Number.parseInt(contentLength, 10);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return {
        ok: false,
        response: errorJson(
          c,
          400,
          'PAYLOAD_TOO_LARGE',
          'Request body is too large.'
        ),
      };
    }
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return {
      ok: false,
      response: errorJson(
        c,
        400,
        'INVALID_BODY',
        'Request body must be valid JSON.'
      ),
    };
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      response: errorJson(
        c,
        400,
        'INVALID_BODY',
        'Request body must be a JSON object.'
      ),
    };
  }

  return { ok: true, body: body as Record<string, unknown> };
}

// ─── SKU / attribute parsers ──────────────────────────────────────────────────

type ParsedProperty = {
  aePropertyId: string | null;
  propertyName: string;
  aeValueId: string | null;
  value: string;
  valueDefinitionName: string | null;
  image: string | null;
};

type ParsedSku = {
  aeSkuId: string | null;
  aeSkuAttr: string | null;
  price: number;
  compareAtPrice: number | null;
  aePrice: number | null;
  aeSalePrice: number | null;
  /** Server-computed estimated profit in cents (never trusted from client). */
  estProfit: number | null;
  stock: number;
  sku: string | null;
  priceIncludesTax: boolean;
  images: ProductImage[];
  properties: ParsedProperty[];
};

/**
 * estProfit = our selling price − AE actual cost − $1.50 processor buffer.
 * Prefers AE sale price, falls back to list AE price. Null when cost is unknown.
 */
function computeEstProfit(
  price: number,
  aeSalePrice: number | null,
  aePrice: number | null
): number | null {
  if (!Number.isFinite(price) || price < 0) return null;
  const aeCost =
    aeSalePrice !== null && Number.isFinite(aeSalePrice)
      ? aeSalePrice
      : aePrice !== null && Number.isFinite(aePrice)
        ? aePrice
        : null;
  if (aeCost === null || aeCost < 0) return null;
  return Math.round(price - aeCost - PAYMENT_PROCESSOR_FEE_CENTS);
}

type ParsedAttribute = {
  aeAttrNameId: string | null;
  attrName: string;
  aeAttrValueId: string | null;
  attrValue: string;
  attrValueUnit: string | null;
  position: number;
};

type ParsedReview = {
  sourceReviewId: string;
  reviewerName: string;
  rating: number;
  comment: string;
  images: string[];
  reviewDate: Date;
};

function parseSku(
  value: unknown,
  index: number
): ParsedSku | { error: string } {
  if (!isRecord(value)) {
    return { error: `SKU at index ${index} must be an object.` };
  }

  const price = sanitizeInteger(value.price, {
    min: 0,
    max: 1_000_000_000,
    required: true,
  });
  if (price === null || price === undefined) {
    return {
      error: `SKU at index ${index} requires a valid price in cents (non-negative integer).`,
    };
  }

  const compareAtPrice = sanitizeInteger(value.compareAtPrice, {
    min: 0,
    max: 1_000_000_000,
  });
  if (compareAtPrice === undefined && value.compareAtPrice !== undefined) {
    return { error: `SKU at index ${index} has an invalid compareAtPrice.` };
  }

  const aePrice = sanitizeInteger(value.aePrice, {
    min: 0,
    max: 1_000_000_000,
  });
  if (aePrice === undefined && value.aePrice !== undefined) {
    return { error: `SKU at index ${index} has an invalid aePrice.` };
  }

  const aeSalePrice = sanitizeInteger(value.aeSalePrice, {
    min: 0,
    max: 1_000_000_000,
  });
  if (aeSalePrice === undefined && value.aeSalePrice !== undefined) {
    return { error: `SKU at index ${index} has an invalid aeSalePrice.` };
  }

  const stock = sanitizeInteger(value.stock, { min: 0, max: 100_000_000 }) ?? 0;
  if (stock === null) {
    return { error: `SKU at index ${index} has an invalid stock value.` };
  }

  const aeSkuId = sanitizeOptionalString(value.aeSkuId, MAX_AE_ID_LENGTH);
  if (aeSkuId === undefined && value.aeSkuId !== undefined) {
    return { error: `SKU at index ${index} has an invalid aeSkuId.` };
  }

  const aeSkuAttr = sanitizeOptionalString(value.aeSkuAttr, 500);
  if (aeSkuAttr === undefined && value.aeSkuAttr !== undefined) {
    return { error: `SKU at index ${index} has an invalid aeSkuAttr.` };
  }

  const skuCode = sanitizeOptionalString(value.sku, MAX_SKU_CODE_LENGTH);
  if (skuCode === undefined && value.sku !== undefined) {
    return { error: `SKU at index ${index} has an invalid sku code.` };
  }

  const imagesRaw = Array.isArray(value.images) ? value.images : [];
  if (imagesRaw.length > MAX_IMAGES) {
    return {
      error: `SKU at index ${index} has too many images (max ${MAX_IMAGES}).`,
    };
  }
  const images: ProductImage[] = [];
  for (let i = 0; i < imagesRaw.length; i++) {
    const img = sanitizeProductImage(imagesRaw[i], i);
    if (!img) {
      return { error: `SKU at index ${index}, image ${i} is invalid.` };
    }
    images.push(img);
  }
  if (images.some((image) => image.isOp === true)) {
    return {
      error: 'Optimised images are only allowed in the product gallery.',
    };
  }

  const propsRaw = Array.isArray(value.properties) ? value.properties : [];
  if (propsRaw.length > MAX_PROPERTIES_PER_SKU) {
    return {
      error: `SKU at index ${index} has too many properties (max ${MAX_PROPERTIES_PER_SKU}).`,
    };
  }

  const properties: ParsedProperty[] = [];
  for (let i = 0; i < propsRaw.length; i++) {
    const prop = propsRaw[i];
    if (!isRecord(prop)) {
      return {
        error: `SKU at index ${index}, property ${i} must be an object.`,
      };
    }

    const propertyName = sanitizeRequiredString(
      prop.propertyName,
      MAX_PROPERTY_NAME_LENGTH
    );
    const propValue = sanitizeRequiredString(
      prop.value,
      MAX_PROPERTY_VALUE_LENGTH
    );
    if (!propertyName || !propValue) {
      return {
        error: `SKU at index ${index}, property ${i} requires propertyName and value.`,
      };
    }

    const image = sanitizeUrl(prop.image);
    if (image === undefined && prop.image !== undefined) {
      return {
        error: `SKU at index ${index}, property ${i} has an invalid image URL.`,
      };
    }

    properties.push({
      aePropertyId:
        sanitizeOptionalString(prop.aePropertyId, MAX_AE_ID_LENGTH) ?? null,
      propertyName,
      aeValueId:
        sanitizeOptionalString(prop.aeValueId, MAX_AE_ID_LENGTH) ?? null,
      value: propValue,
      valueDefinitionName:
        sanitizeOptionalString(
          prop.valueDefinitionName,
          MAX_PROPERTY_VALUE_LENGTH
        ) ?? null,
      image:
        image === undefined || image === null
          ? null
          : persistProductImageUrl(image),
    });
  }

  const resolvedAePrice = aePrice === undefined ? null : aePrice;
  const resolvedAeSalePrice = aeSalePrice === undefined ? null : aeSalePrice;

  return {
    aeSkuId: aeSkuId === undefined ? null : aeSkuId,
    aeSkuAttr: aeSkuAttr === undefined ? null : aeSkuAttr,
    price,
    compareAtPrice: compareAtPrice === undefined ? null : compareAtPrice,
    aePrice: resolvedAePrice,
    aeSalePrice: resolvedAeSalePrice,
    // Always computed server-side — ignore any client-supplied estProfit.
    estProfit: computeEstProfit(price, resolvedAeSalePrice, resolvedAePrice),
    stock,
    sku: skuCode === undefined ? null : skuCode,
    priceIncludesTax: sanitizeBoolean(value.priceIncludesTax, false),
    images,
    properties,
  };
}

function parseAttribute(
  value: unknown,
  index: number
): ParsedAttribute | { error: string } | null {
  if (!isRecord(value)) {
    return { error: `Attribute at index ${index} must be an object.` };
  }

  const attrName = sanitizeRequiredString(value.attrName, MAX_ATTR_NAME_LENGTH);
  const attrValue = sanitizeRequiredString(
    value.attrValue,
    MAX_ATTR_VALUE_LENGTH
  );
  if (!attrName || !attrValue) {
    return null;
  }

  return {
    aeAttrNameId:
      sanitizeOptionalString(value.aeAttrNameId, MAX_AE_ID_LENGTH) ?? null,
    attrName,
    aeAttrValueId:
      sanitizeOptionalString(value.aeAttrValueId, MAX_AE_ID_LENGTH) ?? null,
    attrValue,
    attrValueUnit: sanitizeOptionalString(value.attrValueUnit, 40) ?? null,
    position: sanitizeInteger(value.position, { min: 0, max: 10_000 }) ?? index,
  };
}

function findRemoteReviewList(value: unknown): unknown[] | null {
  let envelope: unknown = value;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof envelope === 'string') {
      try {
        envelope = JSON.parse(envelope);
      } catch {
        return null;
      }
    }
    if (!isRecord(envelope)) return null;
    if (
      envelope.evaViewList !== undefined ||
      envelope.reviewList !== undefined ||
      envelope.reviews !== undefined
    ) {
      const rawRows =
        envelope.evaViewList ?? envelope.reviewList ?? envelope.reviews;
      if (Array.isArray(rawRows)) return rawRows;
      if (typeof rawRows === 'string') {
        try {
          const parsed: unknown = JSON.parse(rawRows);
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
      return null;
    }
    envelope = envelope.data;
  }
  return null;
}

function parseRemoteReviewRows(value: unknown): Record<string, unknown>[] {
  return (findRemoteReviewList(value) ?? []).filter(isRecord);
}

function hasRemoteReviewList(value: unknown): boolean {
  return findRemoteReviewList(value) !== null;
}

function parseRemoteReviewCount(value: unknown): number | null {
  if (!isRecord(value)) return null;
  let envelope: unknown = value;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof envelope === 'string') {
      try {
        envelope = JSON.parse(envelope);
      } catch {
        return null;
      }
    }
    if (!isRecord(envelope)) return null;
    for (const key of ['totalNum', 'totalCount', 'evaCount', 'count']) {
      const count = Number(envelope[key]);
      if (Number.isInteger(count) && count >= 0) return count;
    }
    const statistics = envelope.productEvaluationStatistic;
    if (isRecord(statistics)) {
      const count = Number(statistics.totalNum);
      if (Number.isInteger(count) && count >= 0) return count;
    }
    envelope = envelope.data;
  }
  return null;
}

function parseRemoteReviewDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  const dateString = String(value).trim();
  const timestamp =
    Number.isFinite(numeric) && numeric > 0
      ? new Date(numeric < 100_000_000_000 ? numeric * 1000 : numeric)
      : new Date(dateString);
  if (!Number.isFinite(timestamp.getTime())) {
    const datetime = new Date(dateString.replace(' ', 'T'));
    return Number.isFinite(datetime.getTime()) ? datetime : null;
  }
  return Number.isFinite(timestamp.getTime()) ? timestamp : null;
}

function normalizeReviewReviewerName(value: unknown): string | null {
  const name = sanitizeRequiredString(value, 160);
  if (!name) return null;
  return name.toLowerCase() === 'aliexpress shopper' ? 'Shopper' : name;
}

function normalizeRemoteReview(
  row: Record<string, unknown>,
  productId: string,
  index: number
): ParsedReview | null {
  const rawRating = Number(row.buyerEval ?? row.rating ?? row.eval);
  const rating =
    rawRating > 5 && rawRating <= 100
      ? Math.round(rawRating / 20)
      : Math.round(rawRating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;

  const reviewerName =
    normalizeReviewReviewerName(row.buyerName ?? row.reviewerName) ?? 'Shopper';
  const comment = sanitizeRequiredString(
    row.buyerTranslationFeedback ??
      row.buyerFeedbackTranslation ??
      row.buyerFeedback ??
      row.comment ??
      row.content,
    MAX_REVIEW_COMMENT_LENGTH
  );
  const reviewDate = parseRemoteReviewDate(
    row.evalDate ?? row.reviewDate ?? row.createdAt
  );
  if (!reviewDate) return null;

  const rawImages = Array.isArray(row.images)
    ? row.images
    : Array.isArray(row.thumbnails)
      ? row.thumbnails
      : [];
  const images: string[] = [];
  for (const image of rawImages) {
    const rawUrl =
      typeof image === 'string'
        ? image
        : isRecord(image)
          ? ((image.imageUrl ?? image.url ?? image.image) as unknown)
          : null;
    if (typeof rawUrl !== 'string') continue;
    const url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl.trim();
    if (isAliExpressImageUrl(url) && !images.includes(url)) {
      images.push(url);
      if (images.length === MAX_REVIEW_IMAGES) break;
    }
  }

  const sourceReviewId = sanitizeOptionalString(
    row.evaluationIdStr ?? row.evaluationId ?? row.evalId ?? row.id,
    160
  );
  return {
    sourceReviewId:
      sourceReviewId || `${productId}:${reviewDate.getTime()}:${index}`,
    reviewerName,
    rating,
    comment: comment ?? '',
    images,
    reviewDate,
  };
}

async function fetchAliExpressReviewPage(
  productId: string,
  page: number
): Promise<unknown> {
  const url = new URL('https://feedback.aliexpress.com/pc/searchEvaluation.do');
  url.search = new URLSearchParams({
    productId,
    lang: 'en_US',
    country: 'US',
    page: String(page),
    pageSize: String(REVIEW_PAGE_SIZE),
    filter: 'all',
    sort: 'complex_default',
  }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const headers = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `https://www.aliexpress.com/item/${productId}.html`,
      'User-Agent': 'Mozilla/5.0 (compatible; MantomartReviewImporter/1.0)',
    };
    let requestUrl = url;
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 2; redirects++) {
      response = await fetch(requestUrl, {
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects === 2) {
        throw new Error(
          'AliExpress redirected the review request too many times.'
        );
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(
          'AliExpress redirected the review request without a location.'
        );
      }
      const redirectUrl = new URL(location, requestUrl);
      if (
        redirectUrl.protocol !== 'https:' ||
        !(
          redirectUrl.hostname === 'aliexpress.com' ||
          redirectUrl.hostname.endsWith('.aliexpress.com')
        )
      ) {
        throw new Error(
          'AliExpress redirected the review request to an unsupported host.'
        );
      }
      requestUrl = redirectUrl;
    }
    if (!response) {
      throw new Error('AliExpress review service did not return a response.');
    }
    if (!response.ok) {
      throw new Error(
        response.status === 429
          ? 'AliExpress is temporarily rate limiting review requests.'
          : `AliExpress review service returned ${response.status}.`
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('AliExpress review request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function randomReviewLimit(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return 300 + (bytes[0]! % (MAX_REVIEWS - 300 + 1));
}

// ─── Router ───────────────────────────────────────────────────────────────────

const addProductMyList = new Hono<AppEnv>();

addProductMyList.use('*', requireAdminMiddleware);

addProductMyList.post(
  '/host-images',
  requireAnyPermission(PERMISSIONS.PRODUCT_CREATE),
  async (c) => {
    const actor = getActor(c);
    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;

    const { body } = parsed;
    const uploadId = sanitizeRequiredString(body.uploadId, 36);
    if (!uploadId || !IMAGE_IMPORT_ID_RE.test(uploadId)) {
      return errorJson(c, 400, 'INVALID_IMAGE_UPLOAD_ID', 'Invalid upload id.');
    }

    const kind = body.kind;
    if (kind !== 'product' && kind !== 'review' && kind !== 'optimised') {
      return errorJson(
        c,
        400,
        'INVALID_IMAGE_BATCH_KIND',
        'Image batch kind must be product or review.'
      );
    }

    if (!Array.isArray(body.urls) || body.urls.length < 1) {
      return errorJson(
        c,
        400,
        'INVALID_IMAGE_BATCH',
        'Image URLs are required.'
      );
    }
    const maxImages =
      kind === 'optimised'
        ? MAX_OPTIMISED_IMAGES_PER_HOSTING_INVOCATION
        : MAX_IMAGES_PER_HOSTING_INVOCATION;
    if (body.urls.length > maxImages) {
      return errorJson(
        c,
        400,
        'IMAGE_BATCH_TOO_LARGE',
        `At most ${maxImages} images can be hosted per request.`
      );
    }

    const urls: string[] = [];
    for (const rawUrl of body.urls) {
      const url = sanitizeUrl(rawUrl);
      if (!url || !isAliExpressImageUrl(url)) {
        return errorJson(
          c,
          400,
          'INVALID_IMAGE_URL',
          'Every image in a batch must be a valid AliExpress image URL.'
        );
      }
      urls.push(url);
    }

    const optimisedUrls =
      kind === 'product' && Array.isArray(body.optimisedUrls)
        ? body.optimisedUrls.filter(
            (url): url is string =>
              typeof url === 'string' && urls.includes(url)
          )
        : [];
    if (kind !== 'product' && body.optimisedUrls !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_OPTIMISED_IMAGES',
        'Only product image batches can request optimised copies.'
      );
    }
    let fullImagePaths: string[] = [];
    if (kind === 'optimised') {
      if (
        !Array.isArray(body.fullImagePaths) ||
        body.fullImagePaths.length !== urls.length ||
        !body.fullImagePaths.every(
          (path): path is string => typeof path === 'string'
        )
      ) {
        return errorJson(
          c,
          400,
          'INVALID_OPTIMISED_IMAGE_PATHS',
          'A hosted full-image path is required for every optimised image.'
        );
      }
      fullImagePaths = body.fullImagePaths;
    } else if (body.fullImagePaths !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_OPTIMISED_IMAGE_PATHS',
        'Full-image paths are only accepted for optimised image batches.'
      );
    }

    let session: ProductImageImportSession;
    try {
      session = (await readImageImportSession(c.env.KV, uploadId)) ?? {
        actorId: actor.id,
        uploadedKeys: [],
      };
    } catch {
      return errorJson(
        c,
        500,
        'IMAGE_IMPORT_SESSION_FAILED',
        'Could not read the image upload session.'
      );
    }
    if (session.actorId !== actor.id || session.completed) {
      return errorJson(
        c,
        409,
        'IMAGE_IMPORT_SESSION_INVALID',
        'This image upload session is no longer available.'
      );
    }

    try {
      await c.env.KV.put(
        imageImportSessionKey(uploadId),
        JSON.stringify(session),
        { expirationTtl: PRODUCT_IMAGE_IMPORT_SESSION_TTL_SECONDS }
      );
    } catch (error) {
      console.error(
        'Could not initialize product image import session:',
        error
      );
      return errorJson(
        c,
        500,
        'IMAGE_IMPORT_SESSION_FAILED',
        'Could not initialize the image upload session.'
      );
    }

    const env = c.env;
    const origin = requestOriginFromUrl(c.req.url);
    const rateLimiter = createAliExpressImageRateLimiter();

    return createProductHostSseResponse(c.req.raw, async (write, signal) => {
      const uploadedKeys: string[] = [];
      let mappings: Array<{
        sourceUrl: string;
        hostedUrl: string;
        optimisedUrl?: string;
      }>;

      try {
        if (kind === 'optimised') {
          const hosted = await hostAliExpressOptimisedProductImages({
            env,
            images: urls.map((sourceUrl, index) => ({
              sourceUrl,
              fullImagePath: fullImagePaths[index]!,
            })),
            origin,
            signal,
            rateLimiter,
            onProgress: (event) => write('progress', event),
          });
          if (!hosted.ok) {
            await deleteUploadedProductImageKeys(env, hosted.uploadedKeys);
            write('error', {
              success: false,
              code: hosted.error.code,
              message: hosted.error.message,
              error: hosted.error.message,
            });
            return;
          }
          uploadedKeys.push(...hosted.uploadedKeys);
          mappings = hosted.images.map((image) => ({
            sourceUrl: image.sourceUrl,
            hostedUrl: image.optimisedImagePath,
          }));
        } else if (kind === 'product') {
          const slug = slugify(
            sanitizeOptionalString(body.slug, MAX_SLUG_LENGTH) ??
              'imported-product'
          );
          let completedSourceImages = 0;
          const hosted = await hostProductImages({
            env,
            slug: slug || 'imported-product',
            productImages: urls.map((url, position) => ({ url, position })),
            skuImages: [],
            propertyImages: [],
            sizeChartImage: null,
            optimisedImageUrls: optimisedUrls,
            origin,
            signal,
            rateLimiter,
            onProgress: (event) => {
              if (
                event.current > 0 &&
                !event.message.startsWith('Uploaded optimised card image')
              ) {
                completedSourceImages += 1;
              }
              write('progress', {
                current: completedSourceImages,
                total: urls.length,
                message:
                  event.current === 0
                    ? `Preparing ${urls.length} product image${urls.length === 1 ? '' : 's'}…`
                    : `Uploaded ${completedSourceImages} of ${urls.length} product images`,
              });
            },
          });
          if (!hosted.ok) {
            await deleteUploadedProductImageKeys(env, hosted.uploadedKeys);
            write('error', {
              success: false,
              code: hosted.error.code,
              message: hosted.error.message,
              error: hosted.error.message,
            });
            return;
          }
          uploadedKeys.push(...hosted.uploadedKeys);
          const fullImages = hosted.productImages.filter(
            (image) => image.isOp !== true
          );
          const optimisedImages = hosted.productImages.filter(
            (image) => image.isOp === true
          );
          mappings = urls.map((sourceUrl, position) => {
            const full = fullImages.find(
              (image) => image.position === position
            );
            const optimised = optimisedImages.find(
              (image) => image.position === position
            );
            if (!full) {
              throw new Error(
                `Hosted image mapping missing at position ${position}.`
              );
            }
            return {
              sourceUrl,
              hostedUrl: full.url,
              ...(optimised ? { optimisedUrl: optimised.url } : {}),
            };
          });
        } else {
          const hosted = await hostAliExpressReviewImages({
            env,
            imageUrls: [urls],
            origin,
            signal,
            rateLimiter,
            onProgress: (event) => write('progress', event),
          });
          if (!hosted.ok) {
            await deleteUploadedProductImageKeys(env, hosted.uploadedKeys);
            write('error', {
              success: false,
              code: hosted.error.code,
              message: hosted.error.message,
              error: hosted.error.message,
            });
            return;
          }
          uploadedKeys.push(...hosted.uploadedKeys);
          mappings = urls.map((sourceUrl, index) => {
            const hostedUrl = hosted.imageUrls[0]?.[index];
            if (!hostedUrl) {
              throw new Error(
                `Hosted review image mapping missing at index ${index}.`
              );
            }
            return { sourceUrl, hostedUrl };
          });
        }

        try {
          const updatedSession: ProductImageImportSession = {
            ...session,
            uploadedKeys: [...session.uploadedKeys, ...uploadedKeys],
          };
          await env.KV.put(
            imageImportSessionKey(uploadId),
            JSON.stringify(updatedSession),
            { expirationTtl: PRODUCT_IMAGE_IMPORT_SESSION_TTL_SECONDS }
          );
        } catch (error) {
          console.error(
            'Could not persist product image import session:',
            error
          );
          await deleteUploadedProductImageKeys(env, uploadedKeys);
          write('error', {
            success: false,
            code: 'IMAGE_IMPORT_SESSION_FAILED',
            message: 'Could not save uploaded images to the import session.',
            error: 'Could not save uploaded images to the import session.',
          });
          return;
        }

        write('complete', {
          success: true,
          message: 'Image batch uploaded.',
          data: { images: mappings },
        });
      } catch (error) {
        console.error('Product image batch failed unexpectedly:', error);
        await deleteUploadedProductImageKeys(env, uploadedKeys);
        const message =
          error instanceof Error
            ? error.message
            : 'Unexpected image batch failure.';
        write('error', {
          success: false,
          code: 'IMAGE_BATCH_FAILED',
          message,
          error: message,
        });
      }
    });
  }
);

addProductMyList.post(
  '/host-images/cleanup',
  requireAnyPermission(PERMISSIONS.PRODUCT_CREATE),
  async (c) => {
    const actor = getActor(c);
    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const uploadId = sanitizeRequiredString(parsed.body.uploadId, 36);
    if (!uploadId || !IMAGE_IMPORT_ID_RE.test(uploadId)) {
      return errorJson(c, 400, 'INVALID_IMAGE_UPLOAD_ID', 'Invalid upload id.');
    }

    try {
      const session = await readImageImportSession(c.env.KV, uploadId);
      if (!session) return c.json({ success: true, deletedCount: 0 });
      if (session.actorId !== actor.id) {
        return errorJson(
          c,
          403,
          'IMAGE_IMPORT_SESSION_FORBIDDEN',
          'This image upload session belongs to another admin.'
        );
      }
      if (session.completed) {
        return c.json({ success: true, deletedCount: 0, completed: true });
      }
      await deleteUploadedProductImageKeys(c.env, session.uploadedKeys);
      await c.env.KV.delete(imageImportSessionKey(uploadId));
      return c.json({
        success: true,
        deletedCount: session.uploadedKeys.length,
      });
    } catch (error) {
      console.error('Could not clean up product image import session:', error);
      return errorJson(
        c,
        500,
        'IMAGE_IMPORT_CLEANUP_FAILED',
        'Could not clean up the uploaded images.'
      );
    }
  }
);

/**
 * GET /reviews/:aeProductId
 * Retrieve a bounded, randomized sample from AliExpress' public review page.
 */
addProductMyList.get(
  '/reviews/:aeProductId',
  requireAnyPermission(PERMISSIONS.PRODUCT_CREATE),
  async (c) => {
    const productId = (c.req.param('aeProductId') ?? '').trim();
    if (
      !productId ||
      productId.length > MAX_AE_ID_LENGTH ||
      !isValidId(productId)
    ) {
      return errorJson(
        c,
        400,
        'INVALID_AE_PRODUCT_ID',
        'Invalid AliExpress product id.'
      );
    }

    try {
      const firstPage = await fetchAliExpressReviewPage(productId, 1);
      if (!hasRemoteReviewList(firstPage)) {
        console.error('AliExpress returned an unexpected review response.');
        return errorJson(
          c,
          502,
          'INVALID_REVIEW_RESPONSE',
          'AliExpress returned reviews in an unsupported format.'
        );
      }

      const firstRows = parseRemoteReviewRows(firstPage);
      const reportedTotal = parseRemoteReviewCount(firstPage);
      const randomizedLimit = randomReviewLimit();
      const limit =
        reportedTotal !== null && reportedTotal > 0
          ? Math.min(randomizedLimit, reportedTotal)
          : firstRows.length === 0
            ? 0
            : randomizedLimit;
      const pageCount = Math.ceil(limit / REVIEW_PAGE_SIZE);
      const rawRows = [...firstRows];

      for (let startPage = 2; startPage <= pageCount; startPage += 3) {
        const pages = Array.from(
          { length: Math.min(3, pageCount - startPage + 1) },
          (_unused, offset) => startPage + offset
        );
        const results = await Promise.all(
          pages.map((page) => fetchAliExpressReviewPage(productId, page))
        );
        for (const result of results) {
          if (!hasRemoteReviewList(result)) {
            throw new Error('AliExpress returned an invalid review page.');
          }
          rawRows.push(...parseRemoteReviewRows(result));
        }
      }

      const uniqueReviews = new Map<string, ParsedReview>();
      rawRows.forEach((row, index) => {
        const review = normalizeRemoteReview(row, productId, index);
        if (review && !uniqueReviews.has(review.sourceReviewId)) {
          uniqueReviews.set(review.sourceReviewId, review);
        }
      });
      const reviews = [...uniqueReviews.values()].slice(0, limit);

      return c.json({
        success: true,
        data: {
          reviews: reviews.map((review) => ({
            ...review,
            reviewDate: review.reviewDate.toISOString(),
          })),
          selectionLimit: Math.min(randomizedLimit, reviews.length),
          sourceReviewCount: reportedTotal ?? reviews.length,
        },
      });
    } catch (error) {
      console.error('Failed to retrieve AliExpress reviews:', error);
      const isRateLimited =
        error instanceof Error && error.message.includes('rate limiting');
      return errorJson(
        c,
        isRateLimited ? 503 : 502,
        isRateLimited
          ? 'REVIEW_SOURCE_RATE_LIMITED'
          : 'REVIEW_SOURCE_UNAVAILABLE',
        error instanceof Error
          ? error.message
          : 'Could not retrieve AliExpress reviews. Please retry.'
      );
    }
  }
);

/**
 * GET /ae-exists/:aeProductId
 * Check whether an AliExpress product has already been imported.
 */
addProductMyList.get(
  '/ae-exists/:aeProductId',
  requireAnyPermission(PERMISSIONS.PRODUCT_READ, PERMISSIONS.PRODUCT_CREATE),
  async (c) => {
    const db = getDb(c);
    const aeProductId = (c.req.param('aeProductId') ?? '').trim();

    if (!aeProductId || aeProductId.length > MAX_AE_ID_LENGTH) {
      return errorJson(
        c,
        400,
        'INVALID_AE_PRODUCT_ID',
        'Invalid AliExpress product id.'
      );
    }

    try {
      const [existing] = await db
        .select({
          id: products.id,
          slug: products.slug,
          name: products.name,
          published: products.published,
        })
        .from(products)
        .where(eq(products.aeProductId, aeProductId))
        .limit(1);

      return c.json({
        success: true,
        data: {
          exists: Boolean(existing),
          product: existing ?? null,
        },
      });
    } catch (error) {
      console.error('Error checking AE product existence:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to check product.');
    }
  }
);

/**
 * GET /me
 * Return the current admin actor details for the publish step UI.
 */
addProductMyList.get(
  '/me',
  requireAnyPermission(PERMISSIONS.PRODUCT_CREATE, PERMISSIONS.PRODUCT_READ),
  async (c) => {
    const actor = getActor(c);
    return c.json({
      success: true,
      data: {
        id: actor.id,
        name: actor.name,
        email: actor.email,
        role: actor.role,
      },
    });
  }
);

/**
 * POST /
 * Create (and optionally publish) a product from the My List import wizard.
 *
 * Security:
 * - Admin session required
 * - PRODUCT_CREATE permission required
 * - Strict body size + field validation
 * - HTML sanitization for description fields
 * - Unique slug + unique aeProductId
 * - Category ids must exist
 * - Audit log on success
 */
addProductMyList.post(
  '/',
  requireAnyPermission(PERMISSIONS.PRODUCT_CREATE),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);

    const parsed = await readJsonObject(c);
    if (!parsed.ok) return parsed.response;
    const { body } = parsed;
    const rawUploadId = sanitizeOptionalString(body.imageUploadId, 36);
    if (rawUploadId === undefined && body.imageUploadId !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_IMAGE_UPLOAD_ID',
        'Invalid image upload session id.'
      );
    }
    if (rawUploadId && !IMAGE_IMPORT_ID_RE.test(rawUploadId)) {
      return errorJson(
        c,
        400,
        'INVALID_IMAGE_UPLOAD_ID',
        'Invalid image upload session id.'
      );
    }
    const imageUploadId = rawUploadId || null;
    let imageImportSession: ProductImageImportSession | null = null;
    if (imageUploadId) {
      try {
        imageImportSession = await readImageImportSession(
          c.env.KV,
          imageUploadId
        );
      } catch {
        return errorJson(
          c,
          500,
          'IMAGE_IMPORT_SESSION_FAILED',
          'Could not read the image upload session.'
        );
      }
      if (!imageImportSession || imageImportSession.actorId !== actor.id) {
        return errorJson(
          c,
          409,
          'IMAGE_IMPORT_SESSION_INVALID',
          'The image upload session expired or is not available.'
        );
      }
      if (imageImportSession.completed) {
        return errorJson(
          c,
          409,
          'IMAGE_IMPORT_SESSION_INVALID',
          'The image upload session has already been completed.'
        );
      }
    }

    // ── Core fields ──────────────────────────────────────────────────────────

    const name = sanitizeRequiredString(body.name, MAX_NAME_LENGTH);
    if (!name) {
      return errorJson(
        c,
        400,
        'INVALID_NAME',
        `Name is required (1–${MAX_NAME_LENGTH} characters).`
      );
    }

    let slugInput =
      sanitizeOptionalString(body.slug, MAX_SLUG_LENGTH) ?? slugify(name);
    if (slugInput === undefined || slugInput === null) {
      return errorJson(c, 400, 'INVALID_SLUG', 'Invalid slug.');
    }
    slugInput = slugify(slugInput);
    if (!slugInput || !SLUG_RE.test(slugInput)) {
      return errorJson(
        c,
        400,
        'INVALID_SLUG',
        'Slug must contain only lowercase letters, numbers, and hyphens.'
      );
    }

    const descriptionRaw = sanitizeOptionalString(
      body.description,
      MAX_DESCRIPTION_LENGTH
    );
    if (descriptionRaw === undefined && body.description !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_DESCRIPTION',
        `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
      );
    }
    const description =
      descriptionRaw === undefined || descriptionRaw === null
        ? null
        : sanitizeHtml(descriptionRaw);

    // Mobile detail: prefer HTML; accept markdown via mobileDetailMarkdown
    let mobileDetail: string | null = null;
    if (body.mobileDetail !== undefined && body.mobileDetail !== null) {
      if (typeof body.mobileDetail !== 'string') {
        return errorJson(
          c,
          400,
          'INVALID_MOBILE_DETAIL',
          'mobileDetail must be a string.'
        );
      }
      if (body.mobileDetail.length > MAX_MOBILE_DETAIL_LENGTH) {
        return errorJson(
          c,
          400,
          'INVALID_MOBILE_DETAIL',
          `mobileDetail must be at most ${MAX_MOBILE_DETAIL_LENGTH} characters.`
        );
      }
      mobileDetail = sanitizeHtml(body.mobileDetail.trim()) || null;
    } else if (
      body.mobileDetailMarkdown !== undefined &&
      body.mobileDetailMarkdown !== null
    ) {
      if (typeof body.mobileDetailMarkdown !== 'string') {
        return errorJson(
          c,
          400,
          'INVALID_MOBILE_DETAIL',
          'mobileDetailMarkdown must be a string.'
        );
      }
      if (body.mobileDetailMarkdown.length > MAX_MOBILE_DETAIL_LENGTH) {
        return errorJson(
          c,
          400,
          'INVALID_MOBILE_DETAIL',
          `mobileDetailMarkdown must be at most ${MAX_MOBILE_DETAIL_LENGTH} characters.`
        );
      }
      const md = body.mobileDetailMarkdown.trim();
      mobileDetail = md ? markdownToHtml(md) : null;
    }

    const metaTitle = sanitizeOptionalString(
      body.metaTitle,
      MAX_META_TITLE_LENGTH
    );
    if (metaTitle === undefined && body.metaTitle !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_META_TITLE',
        `metaTitle must be at most ${MAX_META_TITLE_LENGTH} characters.`
      );
    }

    const metaDescription = sanitizeOptionalString(
      body.metaDescription,
      MAX_META_DESCRIPTION_LENGTH
    );
    if (metaDescription === undefined && body.metaDescription !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_META_DESCRIPTION',
        `metaDescription must be at most ${MAX_META_DESCRIPTION_LENGTH} characters.`
      );
    }

    const productNotes = sanitizeOptionalString(
      body.productNotes,
      MAX_NOTES_LENGTH
    );
    if (productNotes === undefined && body.productNotes !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_PRODUCT_NOTES',
        `productNotes must be at most ${MAX_NOTES_LENGTH} characters.`
      );
    }

    const tags = sanitizeTags(body.tags);
    if (tags === null) {
      return errorJson(
        c,
        400,
        'INVALID_TAGS',
        'tags must be an array of strings.'
      );
    }

    const published = sanitizeBoolean(body.published, true);
    const featured = sanitizeBoolean(body.featured, false);
    const isAEProduct = sanitizeBoolean(body.isAEProduct, true);

    const aeProductId = sanitizeOptionalString(
      body.aeProductId,
      MAX_AE_ID_LENGTH
    );
    if (aeProductId === undefined && body.aeProductId !== undefined) {
      return errorJson(c, 400, 'INVALID_AE_PRODUCT_ID', 'Invalid aeProductId.');
    }
    if (isAEProduct && !aeProductId) {
      return errorJson(
        c,
        400,
        'MISSING_AE_PRODUCT_ID',
        'aeProductId is required for AliExpress products.'
      );
    }

    const aeCategoryId = sanitizeOptionalString(
      body.aeCategoryId,
      MAX_AE_ID_LENGTH
    );
    if (aeCategoryId === undefined && body.aeCategoryId !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_AE_CATEGORY_ID',
        'Invalid aeCategoryId.'
      );
    }

    const aeRating = sanitizeFloat(body.aeRating);
    if (aeRating === undefined && body.aeRating !== undefined) {
      return errorJson(c, 400, 'INVALID_AE_RATING', 'Invalid aeRating.');
    }

    const aeReviewCount = sanitizeInteger(body.aeReviewCount, {
      min: 0,
      max: 100_000_000,
    });
    if (aeReviewCount === undefined && body.aeReviewCount !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_AE_REVIEW_COUNT',
        'Invalid aeReviewCount.'
      );
    }

    const aeSalesCount = sanitizeOptionalString(body.aeSalesCount, 64);
    if (aeSalesCount === undefined && body.aeSalesCount !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_AE_SALES_COUNT',
        'Invalid aeSalesCount.'
      );
    }

    const aeStatus = sanitizeOptionalString(body.aeStatus, 64);
    if (aeStatus === undefined && body.aeStatus !== undefined) {
      return errorJson(c, 400, 'INVALID_AE_STATUS', 'Invalid aeStatus.');
    }

    // ── Size chart ───────────────────────────────────────────────────────────

    const hasSizeChart = sanitizeBoolean(body.hasSizeChart, false);
    const sizeChartImage = sanitizeUrl(body.sizeChartImage);
    if (sizeChartImage === undefined && body.sizeChartImage !== undefined) {
      return errorJson(
        c,
        400,
        'INVALID_SIZE_CHART_IMAGE',
        'Invalid sizeChartImage URL.'
      );
    }
    const sizeChartDescription = sanitizeOptionalString(
      body.sizeChartDescription,
      5000
    );
    if (
      sizeChartDescription === undefined &&
      body.sizeChartDescription !== undefined
    ) {
      return errorJson(
        c,
        400,
        'INVALID_SIZE_CHART_DESCRIPTION',
        'Invalid sizeChartDescription.'
      );
    }

    // ── Media ────────────────────────────────────────────────────────────────

    const imagesRaw = Array.isArray(body.images) ? body.images : [];
    const fullImagesRawCount = imagesRaw.filter(
      (image) => !isRecord(image) || image.isOp !== true
    ).length;
    const optimisedImagesRawCount = imagesRaw.length - fullImagesRawCount;
    if (
      fullImagesRawCount > MAX_IMAGES ||
      optimisedImagesRawCount > MAX_OPTIMISED_IMAGES
    ) {
      return errorJson(
        c,
        400,
        'TOO_MANY_IMAGES',
        `At most ${MAX_IMAGES} product images and ${MAX_OPTIMISED_IMAGES} optimised images are allowed.`
      );
    }
    const images: ProductImage[] = [];
    for (let i = 0; i < imagesRaw.length; i++) {
      const img = sanitizeProductImage(imagesRaw[i], i);
      if (!img) {
        return errorJson(
          c,
          400,
          'INVALID_IMAGE',
          `Product image at index ${i} is invalid.`
        );
      }
      images.push(img);
    }
    const firstFiveFullGalleryPaths = new Set(
      images
        .filter((image) => image.isOp !== true)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .slice(0, 5)
        .map((image) => toStoredProductImagePath(image.url))
        .filter((path): path is string => path !== null)
        .map(optimisedStoredPath)
    );
    if (
      images.some(
        (image) =>
          image.isOp === true &&
          !firstFiveFullGalleryPaths.has(
            toStoredProductImagePath(image.url) ?? ''
          )
      )
    ) {
      return errorJson(
        c,
        400,
        'INVALID_OPTIMISED_IMAGE',
        'Optimised images are only allowed for the first five product gallery images.'
      );
    }

    const videosRaw = Array.isArray(body.videos) ? body.videos : [];
    if (videosRaw.length > MAX_VIDEOS) {
      return errorJson(
        c,
        400,
        'TOO_MANY_VIDEOS',
        `At most ${MAX_VIDEOS} videos are allowed.`
      );
    }
    const videos: ProductVideo[] = [];
    for (let i = 0; i < videosRaw.length; i++) {
      const video = sanitizeProductVideo(videosRaw[i]);
      if (!video) {
        return errorJson(
          c,
          400,
          'INVALID_VIDEO',
          `Video at index ${i} is invalid.`
        );
      }
      videos.push(video);
    }

    const mainVideo = sanitizeUrl(body.mainVideo);
    if (mainVideo === undefined && body.mainVideo !== undefined) {
      return errorJson(c, 400, 'INVALID_MAIN_VIDEO', 'Invalid mainVideo URL.');
    }

    // ── Categories ───────────────────────────────────────────────────────────

    const categoryIdsRaw = Array.isArray(body.categoryIds)
      ? body.categoryIds
      : [];
    if (categoryIdsRaw.length > MAX_CATEGORIES) {
      return errorJson(
        c,
        400,
        'TOO_MANY_CATEGORIES',
        `At most ${MAX_CATEGORIES} categories are allowed.`
      );
    }

    const categoryIds: string[] = [];
    const seenCategory = new Set<string>();
    for (const raw of categoryIdsRaw) {
      if (typeof raw !== 'string' || !isValidId(raw.trim())) {
        return errorJson(
          c,
          400,
          'INVALID_CATEGORY_ID',
          'One or more category ids are invalid.'
        );
      }
      const id = raw.trim();
      if (seenCategory.has(id)) continue;
      seenCategory.add(id);
      categoryIds.push(id);
    }

    if (categoryIds.length === 0) {
      return errorJson(
        c,
        400,
        'MISSING_CATEGORIES',
        'At least one category is required.'
      );
    }

    // ── SKUs ─────────────────────────────────────────────────────────────────

    const skusRaw = Array.isArray(body.skus) ? body.skus : [];
    if (skusRaw.length === 0) {
      return errorJson(
        c,
        400,
        'MISSING_SKUS',
        'At least one product variant (SKU) is required.'
      );
    }
    if (skusRaw.length > MAX_SKUS) {
      return errorJson(
        c,
        400,
        'TOO_MANY_SKUS',
        `At most ${MAX_SKUS} variants are allowed.`
      );
    }

    const skus: ParsedSku[] = [];
    for (let i = 0; i < skusRaw.length; i++) {
      const sku = parseSku(skusRaw[i], i);
      if ('error' in sku) {
        return errorJson(c, 400, 'INVALID_SKU', sku.error);
      }
      skus.push(sku);
    }
    if (skus.some((sku) => sku.images.some((image) => image.isOp === true))) {
      return errorJson(
        c,
        400,
        'INVALID_OPTIMISED_IMAGE',
        'Optimised images are only allowed in the product gallery.'
      );
    }

    // ── Attributes ───────────────────────────────────────────────────────────

    const attrsRaw = Array.isArray(body.attributes) ? body.attributes : [];
    if (attrsRaw.length > MAX_ATTRIBUTES) {
      return errorJson(
        c,
        400,
        'TOO_MANY_ATTRIBUTES',
        `At most ${MAX_ATTRIBUTES} attributes are allowed.`
      );
    }
    const attributes: ParsedAttribute[] = [];
    for (let i = 0; i < attrsRaw.length; i++) {
      const attr = parseAttribute(attrsRaw[i], i);
      if (attr === null) continue;
      if ('error' in attr) {
        return errorJson(c, 400, 'INVALID_ATTRIBUTE', attr.error);
      }
      attributes.push(attr);
    }

    const reviewsRaw = body.reviews === undefined ? [] : body.reviews;
    if (!Array.isArray(reviewsRaw)) {
      return errorJson(c, 400, 'INVALID_REVIEWS', 'reviews must be an array.');
    }
    if (reviewsRaw.length > MAX_REVIEWS) {
      return errorJson(
        c,
        400,
        'TOO_MANY_REVIEWS',
        `At most ${MAX_REVIEWS} reviews can be added to a product.`
      );
    }
    const importedReviews: ParsedReview[] = [];
    const sourceReviewIds = new Set<string>();
    for (let i = 0; i < reviewsRaw.length; i++) {
      const value = reviewsRaw[i];
      if (!isRecord(value)) {
        return errorJson(
          c,
          400,
          'INVALID_REVIEW',
          `Review ${i + 1} is invalid.`
        );
      }

      const sourceReviewId = sanitizeRequiredString(value.sourceReviewId, 160);
      const reviewerName = normalizeReviewReviewerName(value.reviewerName);
      const rating = sanitizeInteger(value.rating, { min: 1, max: 5 });
      const comment = sanitizeOptionalString(
        value.comment,
        MAX_REVIEW_COMMENT_LENGTH
      );
      const reviewDate =
        typeof value.reviewDate === 'string' &&
        value.reviewDate.length <= 64 &&
        Number.isFinite(Date.parse(value.reviewDate))
          ? new Date(value.reviewDate)
          : null;
      if (
        !sourceReviewId ||
        !reviewerName ||
        rating === null ||
        rating === undefined ||
        (comment === undefined && value.comment !== undefined) ||
        !reviewDate
      ) {
        return errorJson(
          c,
          400,
          'INVALID_REVIEW',
          `Review ${i + 1} has invalid reviewer, rating, text, or date data.`
        );
      }
      if (sourceReviewIds.has(sourceReviewId)) {
        return errorJson(
          c,
          400,
          'DUPLICATE_REVIEW',
          `Review source id "${sourceReviewId}" appears more than once.`
        );
      }
      sourceReviewIds.add(sourceReviewId);

      const rawImages = value.images === undefined ? [] : value.images;
      if (!Array.isArray(rawImages) || rawImages.length > MAX_REVIEW_IMAGES) {
        return errorJson(
          c,
          400,
          'INVALID_REVIEW_IMAGES',
          `Review ${i + 1} may contain at most ${MAX_REVIEW_IMAGES} images.`
        );
      }
      const images: string[] = [];
      for (const rawImage of rawImages) {
        const image = sanitizeUrl(rawImage);
        if (
          typeof image !== 'string' ||
          (!isAliExpressImageUrl(
            image.startsWith('//') ? `https:${image}` : image
          ) &&
            !isHostedReviewImageUrl(image, c.env, {
              origin: requestOriginFromUrl(c.req.url),
            }))
        ) {
          return errorJson(
            c,
            400,
            'INVALID_REVIEW_IMAGE',
            `Review ${i + 1} contains an invalid image URL.`
          );
        }
        images.push(image.startsWith('//') ? `https:${image}` : image);
      }

      importedReviews.push({
        sourceReviewId,
        reviewerName,
        rating,
        comment: comment ?? '',
        images,
        reviewDate,
      });
    }

    const directRemoteImageIdentities = new Set<string>();
    const addDirectRemoteImage = (url: string | null | undefined) => {
      if (url && isAliExpressImageUrl(url)) {
        directRemoteImageIdentities.add(aeImageIdentity(url));
      }
    };
    images.forEach((image) => addDirectRemoteImage(image.url));
    skus.forEach((sku) => {
      sku.images.forEach((image) => addDirectRemoteImage(image.url));
      sku.properties.forEach((property) =>
        addDirectRemoteImage(property.image)
      );
    });
    addDirectRemoteImage(sizeChartImage);
    importedReviews.forEach((review) =>
      review.images.forEach(addDirectRemoteImage)
    );
    if (imageUploadId && directRemoteImageIdentities.size > 0) {
      return errorJson(
        c,
        400,
        'IMAGE_BATCH_INCOMPLETE',
        'Some AliExpress images were not included in the image upload batches. Please retry publishing.'
      );
    }
    if (!imageUploadId && directRemoteImageIdentities.size > 0) {
      return errorJson(
        c,
        400,
        'IMAGE_BATCH_REQUIRED',
        `AliExpress images must be uploaded in batches of at most ${MAX_IMAGES_PER_HOSTING_INVOCATION} before publishing.`
      );
    }

    // ── Pre-flight (JSON errors — before the upload stream starts) ───────────

    try {
      if (aeProductId) {
        const [existingAe] = await db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.aeProductId, aeProductId))
          .limit(1);

        if (existingAe) {
          return errorJson(
            c,
            409,
            'AE_PRODUCT_EXISTS',
            `This AliExpress product is already imported as "${existingAe.name}".`
          );
        }
      }

      const existingCategories = await db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(inArray(categories.id, categoryIds));

      if (existingCategories.length !== categoryIds.length) {
        const found = new Set(existingCategories.map((cat) => cat.id));
        const missing = categoryIds.filter((id) => !found.has(id));
        return errorJson(
          c,
          400,
          'CATEGORY_NOT_FOUND',
          `Category not found: ${missing[0]}`
        );
      }
    } catch (error) {
      console.error('Error pre-checking product create:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to create product.');
    }

    const slug = await ensureUniqueSlug(db, slugInput);
    const origin = requestOriginFromUrl(c.req.url);
    const env = c.env;
    const rateLimiter = createAliExpressImageRateLimiter();
    const stagedImageKeys = imageImportSession?.uploadedKeys ?? [];
    const rollbackStagedImages = async (additionalKeys: string[] = []) => {
      await deleteUploadedProductImageKeys(env, [
        ...stagedImageKeys,
        ...additionalKeys,
      ]);
      if (imageUploadId) {
        try {
          await env.KV.delete(imageImportSessionKey(imageUploadId));
        } catch (error) {
          console.error('Failed to clear product image import session:', error);
        }
      }
    };

    return createProductHostSseResponse(c.req.raw, async (write, signal) => {
      const hosted = await hostProductImages({
        env,
        slug,
        origin,
        signal,
        productImages: images,
        skuImages: skus.map((sku) => sku.images),
        propertyImages: skus.map((sku) =>
          sku.properties.map((prop) => prop.image)
        ),
        sizeChartImage: sizeChartImage ?? null,
        rateLimiter,
        onProgress: (event) => {
          write('progress', event);
        },
      });

      if (!hosted.ok) {
        await rollbackStagedImages(hosted.uploadedKeys);
        write('error', {
          success: false,
          code: hosted.error.code,
          message: hosted.error.message,
          error: hosted.error.message,
        });
        return;
      }

      const hostedReviews = await hostAliExpressReviewImages({
        env,
        imageUrls: importedReviews.map((review) => review.images),
        origin,
        signal,
        rateLimiter,
        onProgress: (event) => write('progress', event),
      });
      if (!hostedReviews.ok) {
        await rollbackStagedImages([
          ...hosted.uploadedKeys,
          ...hostedReviews.uploadedKeys,
        ]);
        write('error', {
          success: false,
          code: hostedReviews.error.code,
          message: hostedReviews.error.message,
          error: hostedReviews.error.message,
        });
        return;
      }

      const now = new Date();
      const productId = nanoid();
      const primaryCategoryId = categoryIds[0] ?? null;
      const hostedImages = persistProductImages(hosted.productImages);
      const hostedSizeChart = hosted.sizeChartImage;
      const averageReview =
        importedReviews.length > 0
          ? Math.round(
              (importedReviews.reduce((sum, review) => sum + review.rating, 0) /
                importedReviews.length) *
                100
            ) / 100
          : null;
      const uploadedKeys = [
        ...stagedImageKeys,
        ...hosted.uploadedKeys,
        ...hostedReviews.uploadedKeys,
      ];

      try {
        // D1 does not support SQL BEGIN/SAVEPOINT statements. Drizzle's batch
        // API uses D1-native atomic batches; large imports are split into
        // bounded batches to stay within D1's statement limit.
        const queries: BatchItem<'sqlite'>[] = [];
        queries.push(
          db.insert(products).values({
            id: productId,
            slug,
            name,
            description,
            mobileDetail,
            hasSizeChart: hasSizeChart || Boolean(hostedSizeChart),
            sizeChartImage: hostedSizeChart ?? null,
            sizeChartDescription: sizeChartDescription ?? null,
            defaultPrice: calculateProductDefaultPrice(skus),
            defaultEstProfit: calculateProductDefaultEstProfit(skus),

            isAEProduct,
            aeProductId: aeProductId ?? null,
            aeCategoryId: aeCategoryId ?? null,
            aeRating: aeRating ?? null,
            aeReviewCount: aeReviewCount ?? null,
            reviewCount: importedReviews.length,
            averageReview,
            aeSalesCount: aeSalesCount ?? null,
            aeStatus: aeStatus ?? null,
            aeLastSynced: isAEProduct ? now : null,

            images: hostedImages,
            videos,
            mainVideo: mainVideo ?? videos[0]?.url ?? null,

            categoryId: primaryCategoryId,
            published,
            featured,
            position: 0,

            metaTitle: metaTitle ?? name.slice(0, MAX_META_TITLE_LENGTH),
            metaDescription: metaDescription ?? null,
            tags,

            revenueInProfit: 0,

            productAddedBy: actor.id,
            productNotes: productNotes ?? null,

            createdAt: now,
            updatedAt: now,
          })
        );

        if (categoryIds.length > 0) {
          const categoryRows = categoryIds.map((categoryId) => ({
            id: nanoid(),
            productId,
            categoryId,
            createdAt: now,
          }));
          for (const chunk of chunkArray(categoryRows)) {
            queries.push(db.insert(productCategories).values(chunk));
          }
        }

        for (let skuIndex = 0; skuIndex < skus.length; skuIndex++) {
          const parsedSku = skus[skuIndex]!;
          const skuId = nanoid();
          const hostedSkuImages = persistProductImages(
            hosted.skuImages[skuIndex] ?? parsedSku.images
          );
          const hostedProps = hosted.propertyImages[skuIndex];

          queries.push(
            db.insert(productSkus).values({
              id: skuId,
              productId,
              aeSkuId: parsedSku.aeSkuId,
              aeSkuAttr: parsedSku.aeSkuAttr,
              price: parsedSku.price,
              compareAtPrice: parsedSku.compareAtPrice,
              aePrice: parsedSku.aePrice,
              aeSalePrice: parsedSku.aeSalePrice,
              estProfit: parsedSku.estProfit,
              stock: parsedSku.stock,
              sku: parsedSku.sku,
              priceIncludesTax: parsedSku.priceIncludesTax,
              images: hostedSkuImages,
              createdAt: now,
            })
          );

          if (parsedSku.properties.length > 0) {
            const propertyRows = parsedSku.properties.map(
              (prop, propIndex) => ({
                id: nanoid(),
                skuId,
                aePropertyId: prop.aePropertyId,
                propertyName: prop.propertyName,
                aeValueId: prop.aeValueId,
                value: prop.value,
                valueDefinitionName: prop.valueDefinitionName,
                image: hostedProps?.[propIndex] ?? prop.image,
              })
            );
            for (const chunk of chunkArray(propertyRows)) {
              queries.push(db.insert(skuProperties).values(chunk));
            }
          }
        }

        if (attributes.length > 0) {
          const attributeRows = attributes.map((attr) => ({
            id: nanoid(),
            productId,
            aeAttrNameId: attr.aeAttrNameId,
            attrName: attr.attrName,
            aeAttrValueId: attr.aeAttrValueId,
            attrValue: attr.attrValue,
            attrValueUnit: attr.attrValueUnit,
            position: attr.position,
          }));
          for (const chunk of chunkArray(attributeRows)) {
            queries.push(db.insert(productAttributes).values(chunk));
          }
        }

        if (importedReviews.length > 0) {
          const reviewRows = importedReviews.map((review, index) => ({
            id: nanoid(),
            productId,
            reviewerId: null,
            reviewerName: review.reviewerName,
            rating: review.rating,
            comment: review.comment || null,
            imageUrls: hostedReviews.imageUrls[index] ?? [],
            isAe: true,
            sourceReviewId: review.sourceReviewId,
            reviewDate: review.reviewDate,
            createdAt: now,
          }));
          for (const chunk of chunkArray(reviewRows)) {
            queries.push(db.insert(productReviews).values(chunk));
          }
        }

        for (let offset = 0; offset < queries.length; offset += D1_BATCH_SIZE) {
          const batch = queries.slice(offset, offset + D1_BATCH_SIZE);
          await db.batch(
            batch as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]
          );
        }

        await incrementAdminProductsAdded(db, actor.id, now);
      } catch (error) {
        console.error('Error creating product from my-list:', error);
        await rollbackStagedImages(uploadedKeys);

        const message =
          error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('unique') || message.includes('constraint')) {
          write('error', {
            success: false,
            code: 'CONFLICT',
            message:
              'A product with this slug or AliExpress id already exists.',
            error: 'A product with this slug or AliExpress id already exists.',
          });
          return;
        }

        write('error', {
          success: false,
          code: 'INTERNAL_ERROR',
          message: 'Failed to create product.',
          error: 'Failed to create product.',
        });
        return;
      }

      if (imageUploadId && imageImportSession) {
        try {
          await env.KV.put(
            imageImportSessionKey(imageUploadId),
            JSON.stringify({ ...imageImportSession, completed: true }),
            { expirationTtl: PRODUCT_IMAGE_IMPORT_SESSION_TTL_SECONDS }
          );
        } catch (error) {
          console.error(
            'Could not mark product image import session complete:',
            error
          );
        }
      }

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.PRODUCT_CREATE,
          category: AUDIT_CATEGORIES.PRODUCT,
          description: `Created product "${name}" from AliExpress import`,
          targetType: AUDIT_TARGET_TYPES.PRODUCT,
          targetId: productId,
          targetLabel: name,
          severity: 'info',
          changes: {
            name: { to: name },
            slug: { to: slug },
            published: { to: published },
            featured: { to: featured },
            categoryIds: { to: categoryIds },
            skuCount: { to: skus.length },
            imageCount: { to: hostedImages.length },
            isAEProduct: { to: isAEProduct },
            aeProductId: { to: aeProductId },
          },
          metadata: {
            source: 'admin_mylist_import',
            attributeCount: attributes.length,
            tagCount: tags.length,
            hostedImageCount: hosted.hostedCount,
            optimisedImageCount: hosted.optimisedCount,
            addedBy: {
              id: actor.id,
              name: actor.name,
              email: actor.email,
              role: actor.role,
            },
          },
        }).then(() => undefined)
      );

      write('complete', {
        success: true,
        message: published
          ? `Product "${truncateNameForMessage(name)}" published successfully.`
          : `Product "${truncateNameForMessage(name)}" saved as draft.`,
        data: {
          id: productId,
          slug,
          name,
          published,
          categoryIds,
          skuCount: skus.length,
          imageCount: hostedImages.length,
          productAddedBy: {
            id: actor.id,
            name: actor.name,
            email: actor.email,
          },
        },
      });
      c.executionCtx.waitUntil(
        Promise.all([invalidateHomepageCache(c.env.KV)]).then(() => undefined)
      );
    });
  }
);

export default addProductMyList;
