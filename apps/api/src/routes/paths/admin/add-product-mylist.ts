import { Hono } from 'hono';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  categories,
  productAttributes,
  productCategories,
  products,
  productSkus,
  skuProperties,
  type Database,
  type ProductImage,
  type ProductVideo,
} from '@repo/db';
import { errorJson, type AppEnv, type AppContext } from '@/utils/errorJson';
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
} from '@/utils/auditLog';

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
const MAX_TAG_LENGTH = 64;
const MAX_TAGS = 40;
const MAX_IMAGES = 60;
const MAX_VIDEOS = 20;
const MAX_SKUS = 200;
const MAX_PROPERTIES_PER_SKU = 20;
const MAX_ATTRIBUTES = 100;
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

const SAFE_URL_RE = /^(https?:\/\/|\/\/)/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_RE = /^[A-Za-z0-9_-]+$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
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

  let alt = '';
  if (typeof value.alt === 'string') {
    alt = truncate(value.alt.trim(), MAX_ALT_LENGTH);
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

  return { url, alt, variantKeys, position };
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
      image: image === undefined ? null : image,
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
): ParsedAttribute | { error: string } {
  if (!isRecord(value)) {
    return { error: `Attribute at index ${index} must be an object.` };
  }

  const attrName = sanitizeRequiredString(value.attrName, MAX_ATTR_NAME_LENGTH);
  const attrValue = sanitizeRequiredString(
    value.attrValue,
    MAX_ATTR_VALUE_LENGTH
  );
  if (!attrName || !attrValue) {
    return {
      error: `Attribute at index ${index} requires attrName and attrValue.`,
    };
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

// ─── Router ───────────────────────────────────────────────────────────────────

const addProductMyList = new Hono<AppEnv>();

addProductMyList.use('*', requireAdminMiddleware);

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
    if (imagesRaw.length > MAX_IMAGES) {
      return errorJson(
        c,
        400,
        'TOO_MANY_IMAGES',
        `At most ${MAX_IMAGES} product images are allowed.`
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
      if ('error' in attr) {
        return errorJson(c, 400, 'INVALID_ATTRIBUTE', attr.error);
      }
      attributes.push(attr);
    }

    // ── Persist ──────────────────────────────────────────────────────────────

    try {
      // Duplicate AE product?
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

      // Validate categories exist
      const existingCategories = await db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(inArray(categories.id, categoryIds));

      if (existingCategories.length !== categoryIds.length) {
        const found = new Set(existingCategories.map((c) => c.id));
        const missing = categoryIds.filter((id) => !found.has(id));
        return errorJson(
          c,
          400,
          'CATEGORY_NOT_FOUND',
          `Category not found: ${missing[0]}`
        );
      }

      const slug = await ensureUniqueSlug(db, slugInput);
      const now = new Date();
      const productId = nanoid();
      const primaryCategoryId = categoryIds[0] ?? null;

      // Insert product
      await db.insert(products).values({
        id: productId,
        slug,
        name,
        description,
        mobileDetail,
        hasSizeChart: hasSizeChart || Boolean(sizeChartImage),
        sizeChartImage: sizeChartImage ?? null,
        sizeChartDescription: sizeChartDescription ?? null,

        isAEProduct,
        aeProductId: aeProductId ?? null,
        aeCategoryId: aeCategoryId ?? null,
        aeRating: aeRating ?? null,
        aeReviewCount: aeReviewCount ?? null,
        aeSalesCount: aeSalesCount ?? null,
        aeStatus: aeStatus ?? null,
        aeLastSynced: isAEProduct ? now : null,

        images,
        videos,
        mainVideo: mainVideo ?? videos[0]?.url ?? null,

        categoryId: primaryCategoryId,
        published,
        featured,
        position: 0,

        metaTitle: metaTitle ?? name.slice(0, MAX_META_TITLE_LENGTH),
        metaDescription: metaDescription ?? null,
        tags,

        // revenueInProfit starts at 0; order flow increments it later.
        revenueInProfit: 0,

        productAddedBy: actor.id,
        productNotes: productNotes ?? null,

        createdAt: now,
        updatedAt: now,
      });

      // Product ↔ categories
      if (categoryIds.length > 0) {
        const categoryRows = categoryIds.map((categoryId) => ({
          id: nanoid(),
          productId,
          categoryId,
          createdAt: now,
        }));
        for (const chunk of chunkArray(categoryRows)) {
          await db.insert(productCategories).values(chunk);
        }
      }

      // SKUs + properties
      for (const parsedSku of skus) {
        const skuId = nanoid();
        await db.insert(productSkus).values({
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
          images: parsedSku.images,
          createdAt: now,
        });

        if (parsedSku.properties.length > 0) {
          const propertyRows = parsedSku.properties.map((prop) => ({
            id: nanoid(),
            skuId,
            aePropertyId: prop.aePropertyId,
            propertyName: prop.propertyName,
            aeValueId: prop.aeValueId,
            value: prop.value,
            valueDefinitionName: prop.valueDefinitionName,
            image: prop.image,
          }));
          for (const chunk of chunkArray(propertyRows)) {
            await db.insert(skuProperties).values(chunk);
          }
        }
      }

      // Attributes
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
          await db.insert(productAttributes).values(chunk);
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
            imageCount: { to: images.length },
            isAEProduct: { to: isAEProduct },
            aeProductId: { to: aeProductId },
          },
          metadata: {
            source: 'admin_mylist_import',
            attributeCount: attributes.length,
            tagCount: tags.length,
            addedBy: {
              id: actor.id,
              name: actor.name,
              email: actor.email,
              role: actor.role,
            },
          },
        }).then(() => undefined)
      );

      return c.json(
        {
          success: true,
          message: published
            ? `Product "${name}" published successfully.`
            : `Product "${name}" saved as draft.`,
          data: {
            id: productId,
            slug,
            name,
            published,
            categoryIds,
            skuCount: skus.length,
            imageCount: images.length,
            productAddedBy: {
              id: actor.id,
              name: actor.name,
              email: actor.email,
            },
          },
        },
        201
      );
    } catch (error) {
      console.error('Error creating product from my-list:', error);

      // Unique constraint race
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('unique') || message.includes('constraint')) {
        return errorJson(
          c,
          409,
          'CONFLICT',
          'A product with this slug or AliExpress id already exists.'
        );
      }

      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to create product.');
    }
  }
);

export default addProductMyList;
