import { Hono } from 'hono';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  like,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  categories,
  productAttributes,
  productCategories,
  products,
  productSkus,
  skuProperties,
  users,
  type Database,
  type ProductImage,
  type ProductVideo,
  calculateProductDefaultPrice,
  calculateProductDefaultEstProfit,
} from '@repo/db';
import { errorJson, type AppContext, type AppEnv } from '@/utils/errorJson';
import { adminHasPermission } from '@/utils/permissions';
import {
  getActor,
  getDb,
  requireAdminMiddleware,
  requireAnyPermission,
} from '@/middleware/permission';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  buildChanges,
  logAuditFromContext,
} from '@/utils/auditLog';
import { decrementAdminProductContribution } from '@/utils/adminStats';
import { invalidatePublicProductCache } from '@/utils/storeProduct';
import { invalidateHomepageCache } from '@/utils/homepageContent';
import {
  createProductHostSseResponse,
  deleteUploadedProductImageKeys,
  hostProductImages,
  persistProductImageUrl,
  persistProductImages,
  productNeedsImageHosting,
  requestOriginFromUrl,
  resolveProductImageUrlForClient,
  resolveProductImagesForClient,
} from '@/utils/productImageHost';

const MAX_ID_LENGTH = 128;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
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
const MAX_CATEGORIES = 20;
const MAX_VARIANT_KEYS = 30;
const MAX_VARIANT_KEY_LENGTH = 120;
const MAX_SKU_CODE_LENGTH = 80;
const MAX_ATTR_NAME_LENGTH = 120;
const MAX_ATTR_VALUE_LENGTH = 500;
const MAX_PROPERTY_NAME_LENGTH = 120;
const MAX_PROPERTY_VALUE_LENGTH = 200;
const MAX_AE_ID_LENGTH = 64;
const MAX_BODY_BYTES = 2_500_000;
const INSERT_CHUNK_SIZE = 10;
const QUERY_CHUNK_SIZE = 80;
const ADMIN_ROLES = ['admin', 'owner'] as const;
/** Fixed buffer for payment-processor fees / tax leakage ($1.50 in cents). */
const PAYMENT_PROCESSOR_FEE_CENTS = 150;

const ID_RE = /^[A-Za-z0-9_-]+$/;
const SAFE_URL_RE = /^(https?:\/\/|\/\/)/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SORTABLE_COLUMNS = [
  'name',
  'createdAt',
  'updatedAt',
  'position',
  'orderCount',
  'totalRevenue',
  'addedBy',
] as const;

type ProductSort = (typeof SORTABLE_COLUMNS)[number];
type ProductStatus = 'published' | 'draft';
type ProductSource = 'ae' | 'manual';
type SkuPropertyRow = typeof skuProperties.$inferSelect;

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

type ProductPayload = {
  name: string;
  slug: string;
  description: string | null;
  mobileDetail: string | null;
  hasSizeChart: boolean;
  sizeChartImage: string | null;
  sizeChartDescription: string | null;
  isAEProduct: boolean;
  aeProductId: string | null;
  aeCategoryId: string | null;
  aeRating: number | null;
  aeReviewCount: number | null;
  aeSalesCount: string | null;
  aeStatus: string | null;
  images: ProductImage[];
  videos: ProductVideo[];
  mainVideo: string | null;
  categoryIds: string[];
  published: boolean;
  featured: boolean;
  position: number;
  metaTitle: string | null;
  metaDescription: string | null;
  tags: string[];
  productNotes: string | null;
  skus: ParsedSku[];
  attributes: ParsedAttribute[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_ID_LENGTH && ID_RE.test(id);
}

function chunkArray<T>(items: T[], size = INSERT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
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

function isSafeUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  if (!SAFE_URL_RE.test(url) && !url.startsWith('/')) return false;
  const lower = url.toLowerCase();
  return !lower.includes('javascript:') && !lower.includes('data:text');
}

function sanitizeHtml(input: string): string {
  let html = input;
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

function sanitizeOptionalString(
  value: unknown,
  max: number
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

function sanitizeRequiredString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > max) return null;
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
  const n =
    typeof value === 'number'
      ? Math.floor(value)
      : typeof value === 'string' && value.trim() !== ''
        ? Number.parseInt(value, 10)
        : NaN;
  if (!Number.isFinite(n)) return null;
  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return n;
}

function sanitizeFloat(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
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
      .filter((key): key is string => typeof key === 'string')
      .map((key) => truncate(key.trim(), MAX_VARIANT_KEY_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_VARIANT_KEYS);
    if (keys.length) variantKeys = keys;
  }
  return {
    url: persistProductImageUrl(url),
    forVariant,
    variantKeys,
    position: sanitizeInteger(value.position, { min: 0, max: 10_000 }) ?? index,
    isOp: value.isOp === true ? true : undefined,
  };
}

function sanitizeProductVideo(value: unknown): ProductVideo | null {
  if (!isRecord(value)) return null;
  const url = sanitizeUrl(value.url);
  if (!url) return null;
  const poster = sanitizeUrl(value.poster);
  if (poster === undefined && value.poster !== undefined) return null;
  const alt =
    typeof value.alt === 'string'
      ? truncate(value.alt.trim(), MAX_ALT_LENGTH) || undefined
      : undefined;
  return { url, poster: poster === undefined ? null : poster, alt };
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

function sanitizeSearch(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const search = value.trim();
  return search.length > 0 && search.length <= 120 ? search : null;
}

function sanitizeSortBy(value: unknown): ProductSort {
  if (typeof value !== 'string') return 'updatedAt';
  return (SORTABLE_COLUMNS as readonly string[]).includes(value)
    ? (value as ProductSort)
    : 'updatedAt';
}

function sanitizeStatus(value: unknown): ProductStatus | null {
  if (value === 'published' || value === 'draft') return value;
  return null;
}

function sanitizeSource(value: unknown): ProductSource | null {
  if (value === 'ae' || value === 'manual') return value;
  return null;
}

function serializeProduct(product: typeof products.$inferSelect) {
  return {
    ...product,
    images: product.images ?? [],
    videos: product.videos ?? [],
    tags: product.tags ?? [],
  };
}

function requestOrigin(c: AppContext): string {
  return requestOriginFromUrl(c.req.url);
}

function resolveStoredImageUrl(
  url: string | null | undefined,
  c: AppContext
): string | null {
  if (url === null || url === undefined) return url ?? null;
  const resolved = resolveProductImageUrlForClient(url, c.env, {
    origin: requestOrigin(c),
  });
  return resolved || url;
}

function firstGalleryImage(images: ProductImage[]): ProductImage | undefined {
  return images.find((img) => img.isOp !== true) ?? images[0];
}

async function resolveActorCapabilities(
  db: Database,
  actorId: string,
  role: string
) {
  if (role === 'owner') {
    return { canRead: true, canCreate: true, canUpdate: true, canDelete: true };
  }
  const [canRead, canCreate, canUpdate, canDelete] = await Promise.all([
    adminHasPermission(db, actorId, PERMISSIONS.PRODUCT_READ),
    adminHasPermission(db, actorId, PERMISSIONS.PRODUCT_CREATE),
    adminHasPermission(db, actorId, PERMISSIONS.PRODUCT_UPDATE),
    adminHasPermission(db, actorId, PERMISSIONS.PRODUCT_DELETE),
  ]);
  return { canRead, canCreate, canUpdate, canDelete };
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
          ? and(eq(products.slug, candidate), ne(products.id, excludeId))
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

  if (!isRecord(body)) {
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

  return { ok: true, body };
}

async function readOptionalJsonObject(
  c: AppContext
): Promise<Record<string, unknown>> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return {};
  try {
    const body = await c.req.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function parseSku(
  value: unknown,
  index: number
): ParsedSku | { error: string } {
  if (!isRecord(value))
    return { error: `SKU at index ${index} must be an object.` };
  const price = sanitizeInteger(value.price, {
    min: 0,
    max: 1_000_000_000,
    required: true,
  });
  if (price === null || price === undefined) {
    return { error: `SKU at index ${index} requires a valid price in cents.` };
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
  if (stock === null)
    return { error: `SKU at index ${index} has invalid stock.` };

  const aeSkuId = sanitizeOptionalString(value.aeSkuId, MAX_AE_ID_LENGTH);
  const aeSkuAttr = sanitizeOptionalString(value.aeSkuAttr, 500);
  const skuCode = sanitizeOptionalString(value.sku, MAX_SKU_CODE_LENGTH);
  if (
    (aeSkuId === undefined && value.aeSkuId !== undefined) ||
    (aeSkuAttr === undefined && value.aeSkuAttr !== undefined) ||
    (skuCode === undefined && value.sku !== undefined)
  ) {
    return {
      error: `SKU at index ${index} contains invalid source or SKU fields.`,
    };
  }

  const imagesRaw = Array.isArray(value.images) ? value.images : [];
  if (imagesRaw.length > MAX_IMAGES) {
    return { error: `SKU at index ${index} has too many images.` };
  }
  const images: ProductImage[] = [];
  for (let i = 0; i < imagesRaw.length; i++) {
    const img = sanitizeProductImage(imagesRaw[i], i);
    if (!img) return { error: `SKU at index ${index}, image ${i} is invalid.` };
    images.push(img);
  }

  const propsRaw = Array.isArray(value.properties) ? value.properties : [];
  if (propsRaw.length > MAX_PROPERTIES_PER_SKU) {
    return { error: `SKU at index ${index} has too many properties.` };
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
        error: `SKU at index ${index}, property ${i} has invalid image.`,
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
): ParsedAttribute | { error: string } {
  if (!isRecord(value))
    return { error: `Attribute at index ${index} must be an object.` };
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

function parseProductPayload(
  c: AppContext,
  body: Record<string, unknown>
): ProductPayload | Response {
  const name = sanitizeRequiredString(body.name, MAX_NAME_LENGTH);
  if (!name) {
    return errorJson(
      c,
      400,
      'INVALID_NAME',
      `Name is required (1-${MAX_NAME_LENGTH} characters).`
    );
  }

  const rawSlug =
    sanitizeOptionalString(body.slug, MAX_SLUG_LENGTH) ?? slugify(name);
  if (rawSlug === undefined || rawSlug === null) {
    return errorJson(c, 400, 'INVALID_SLUG', 'Invalid slug.');
  }
  const slug = slugify(rawSlug);
  if (!slug || !SLUG_RE.test(slug)) {
    return errorJson(
      c,
      400,
      'INVALID_SLUG',
      'Slug must use lowercase letters, numbers, and hyphens.'
    );
  }

  const descriptionRaw = sanitizeOptionalString(
    body.description,
    MAX_DESCRIPTION_LENGTH
  );
  if (descriptionRaw === undefined && body.description !== undefined) {
    return errorJson(c, 400, 'INVALID_DESCRIPTION', 'Description is too long.');
  }
  const mobileDetailRaw = sanitizeOptionalString(
    body.mobileDetail,
    MAX_MOBILE_DETAIL_LENGTH
  );
  if (mobileDetailRaw === undefined && body.mobileDetail !== undefined) {
    return errorJson(
      c,
      400,
      'INVALID_MOBILE_DETAIL',
      'Mobile detail is too long.'
    );
  }

  const metaTitle = sanitizeOptionalString(
    body.metaTitle,
    MAX_META_TITLE_LENGTH
  );
  const metaDescription = sanitizeOptionalString(
    body.metaDescription,
    MAX_META_DESCRIPTION_LENGTH
  );
  const productNotes = sanitizeOptionalString(
    body.productNotes,
    MAX_NOTES_LENGTH
  );
  if (
    (metaTitle === undefined && body.metaTitle !== undefined) ||
    (metaDescription === undefined && body.metaDescription !== undefined) ||
    (productNotes === undefined && body.productNotes !== undefined)
  ) {
    return errorJson(
      c,
      400,
      'INVALID_TEXT_FIELD',
      'One or more text fields are invalid.'
    );
  }

  const tags = sanitizeTags(body.tags);
  if (tags === null)
    return errorJson(c, 400, 'INVALID_TAGS', 'Tags must be an array.');

  const isAEProduct = sanitizeBoolean(body.isAEProduct, false);
  const aeProductId = sanitizeOptionalString(
    body.aeProductId,
    MAX_AE_ID_LENGTH
  );
  const aeCategoryId = sanitizeOptionalString(
    body.aeCategoryId,
    MAX_AE_ID_LENGTH
  );
  const aeRating = sanitizeFloat(body.aeRating);
  const aeReviewCount = sanitizeInteger(body.aeReviewCount, {
    min: 0,
    max: 100_000_000,
  });
  const aeSalesCount = sanitizeOptionalString(body.aeSalesCount, 64);
  const aeStatus = sanitizeOptionalString(body.aeStatus, 64);
  if (
    (aeProductId === undefined && body.aeProductId !== undefined) ||
    (aeCategoryId === undefined && body.aeCategoryId !== undefined) ||
    (aeRating === undefined && body.aeRating !== undefined) ||
    (aeReviewCount === undefined && body.aeReviewCount !== undefined) ||
    (aeSalesCount === undefined && body.aeSalesCount !== undefined) ||
    (aeStatus === undefined && body.aeStatus !== undefined)
  ) {
    return errorJson(
      c,
      400,
      'INVALID_AE_FIELD',
      'One or more AliExpress fields are invalid.'
    );
  }

  const sizeChartImage = sanitizeUrl(body.sizeChartImage);
  const sizeChartDescription = sanitizeOptionalString(
    body.sizeChartDescription,
    5000
  );
  const mainVideo = sanitizeUrl(body.mainVideo);
  if (
    (sizeChartImage === undefined && body.sizeChartImage !== undefined) ||
    (sizeChartDescription === undefined &&
      body.sizeChartDescription !== undefined) ||
    (mainVideo === undefined && body.mainVideo !== undefined)
  ) {
    return errorJson(
      c,
      400,
      'INVALID_MEDIA_URL',
      'One or more media fields are invalid.'
    );
  }

  const imagesRaw = Array.isArray(body.images) ? body.images : [];
  if (imagesRaw.length > MAX_IMAGES) {
    return errorJson(
      c,
      400,
      'TOO_MANY_IMAGES',
      `At most ${MAX_IMAGES} images are allowed.`
    );
  }
  const images: ProductImage[] = [];
  for (let i = 0; i < imagesRaw.length; i++) {
    const img = sanitizeProductImage(imagesRaw[i], i);
    if (!img)
      return errorJson(
        c,
        400,
        'INVALID_IMAGE',
        `Image at index ${i} is invalid.`
      );
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
    if (!video)
      return errorJson(
        c,
        400,
        'INVALID_VIDEO',
        `Video at index ${i} is invalid.`
      );
    videos.push(video);
  }

  const categoryIdsRaw = Array.isArray(body.categoryIds)
    ? body.categoryIds
    : [];
  if (categoryIdsRaw.length === 0) {
    return errorJson(
      c,
      400,
      'MISSING_CATEGORIES',
      'At least one category is required.'
    );
  }
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
    if (!seenCategory.has(id)) {
      seenCategory.add(id);
      categoryIds.push(id);
    }
  }

  const skusRaw = Array.isArray(body.skus) ? body.skus : [];
  if (skusRaw.length === 0) {
    return errorJson(c, 400, 'MISSING_SKUS', 'At least one SKU is required.');
  }
  if (skusRaw.length > MAX_SKUS) {
    return errorJson(
      c,
      400,
      'TOO_MANY_SKUS',
      `At most ${MAX_SKUS} SKUs are allowed.`
    );
  }
  const skus: ParsedSku[] = [];
  for (let i = 0; i < skusRaw.length; i++) {
    const sku = parseSku(skusRaw[i], i);
    if ('error' in sku) return errorJson(c, 400, 'INVALID_SKU', sku.error);
    skus.push(sku);
  }

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
    if ('error' in attr)
      return errorJson(c, 400, 'INVALID_ATTRIBUTE', attr.error);
    attributes.push(attr);
  }

  return {
    name,
    slug,
    description: descriptionRaw ? sanitizeHtml(descriptionRaw) : null,
    mobileDetail: mobileDetailRaw ? sanitizeHtml(mobileDetailRaw) : null,
    hasSizeChart:
      sanitizeBoolean(body.hasSizeChart, false) || Boolean(sizeChartImage),
    sizeChartImage:
      sizeChartImage === undefined || sizeChartImage === null
        ? null
        : persistProductImageUrl(sizeChartImage),
    sizeChartDescription:
      sizeChartDescription === undefined ? null : sizeChartDescription,
    isAEProduct,
    aeProductId: aeProductId === undefined ? null : aeProductId,
    aeCategoryId: aeCategoryId === undefined ? null : aeCategoryId,
    aeRating: aeRating === undefined ? null : aeRating,
    aeReviewCount: aeReviewCount === undefined ? null : aeReviewCount,
    aeSalesCount: aeSalesCount === undefined ? null : aeSalesCount,
    aeStatus: aeStatus === undefined ? null : aeStatus,
    images,
    videos,
    mainVideo: mainVideo === undefined ? (videos[0]?.url ?? null) : mainVideo,
    categoryIds,
    published: sanitizeBoolean(body.published, false),
    featured: sanitizeBoolean(body.featured, false),
    position: sanitizeInteger(body.position, { min: 0, max: 1_000_000 }) ?? 0,
    metaTitle:
      metaTitle === undefined
        ? name.slice(0, MAX_META_TITLE_LENGTH)
        : metaTitle,
    metaDescription: metaDescription === undefined ? null : metaDescription,
    tags,
    productNotes: productNotes === undefined ? null : productNotes,
    skus,
    attributes,
  };
}

function buildWhere(args: {
  search: string | null;
  status: ProductStatus | null;
  source: ProductSource | null;
  categoryId: string | null;
  featured: boolean | null;
  addedBy: string | null;
}): SQL | undefined {
  const conditions: SQL[] = [];
  if (args.search) {
    const escaped = args.search
      .toLowerCase()
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;
    conditions.push(
      or(
        like(sql`lower(${products.name})`, pattern),
        like(sql`lower(${products.slug})`, pattern),
        like(sql`lower(${products.id})`, pattern),
        like(sql`lower(${products.aeProductId})`, pattern)
      )!
    );
  }
  if (args.status)
    conditions.push(eq(products.published, args.status === 'published'));
  if (args.source)
    conditions.push(eq(products.isAEProduct, args.source === 'ae'));
  if (args.featured !== null)
    conditions.push(eq(products.featured, args.featured));
  if (args.addedBy) conditions.push(eq(products.productAddedBy, args.addedBy));
  if (args.categoryId) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM product_categories pc
      WHERE pc.product_id = ${products.id}
      AND pc.category_id = ${args.categoryId}
    )`);
  }
  return conditions.length ? and(...conditions) : undefined;
}

function buildOrderBy(sortBy: ProductSort, sortOrder: 'asc' | 'desc') {
  if (sortBy === 'addedBy') {
    const expression = sql`(
      SELECT lower(u.name)
      FROM users u
      WHERE u.id = ${products.productAddedBy}
      LIMIT 1
    )`;
    return sortOrder === 'asc' ? asc(expression) : desc(expression);
  }

  const map = {
    name: products.name,
    createdAt: products.createdAt,
    updatedAt: products.updatedAt,
    position: products.position,
    orderCount: products.orderCount,
    totalRevenue: products.totalRevenue,
  } as const;
  const column = map[sortBy];
  return sortOrder === 'asc' ? asc(column) : desc(column);
}

async function loadNestedProductData(db: Database, productId: string) {
  const [categoryRows, skuRows, attributeRows] = await Promise.all([
    db
      .select({
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        parentId: categories.parentId,
      })
      .from(productCategories)
      .innerJoin(categories, eq(productCategories.categoryId, categories.id))
      .where(eq(productCategories.productId, productId))
      .orderBy(asc(categories.name)),
    db
      .select()
      .from(productSkus)
      .where(eq(productSkus.productId, productId))
      .orderBy(asc(productSkus.createdAt)),
    db
      .select()
      .from(productAttributes)
      .where(eq(productAttributes.productId, productId))
      .orderBy(
        asc(productAttributes.position),
        asc(productAttributes.attrName)
      ),
  ]);

  const skuIds = skuRows.map((sku) => sku.id);
  const propertyRows: SkuPropertyRow[] = [];
  for (const chunk of chunkArray(skuIds, QUERY_CHUNK_SIZE)) {
    const rows = await db
      .select()
      .from(skuProperties)
      .where(inArray(skuProperties.skuId, chunk));
    propertyRows.push(...rows);
  }
  const propsBySku = new Map<string, typeof propertyRows>();
  for (const prop of propertyRows) {
    const list = propsBySku.get(prop.skuId) ?? [];
    list.push(prop);
    propsBySku.set(prop.skuId, list);
  }

  return {
    categories: categoryRows,
    categoryIds: categoryRows.map((category) => category.id),
    skus: skuRows.map((sku) => ({
      ...sku,
      images: sku.images ?? [],
      properties: propsBySku.get(sku.id) ?? [],
    })),
    attributes: attributeRows,
  };
}

async function replaceNestedProductData(
  db: Database,
  productId: string,
  payload: ProductPayload,
  now: Date
) {
  const oldSkus = await db
    .select({ id: productSkus.id })
    .from(productSkus)
    .where(eq(productSkus.productId, productId));
  const oldSkuIds = oldSkus.map((sku) => sku.id);
  if (oldSkuIds.length) {
    for (const chunk of chunkArray(oldSkuIds, QUERY_CHUNK_SIZE)) {
      await db.delete(skuProperties).where(inArray(skuProperties.skuId, chunk));
    }
  }
  await db.delete(productSkus).where(eq(productSkus.productId, productId));
  await db
    .delete(productAttributes)
    .where(eq(productAttributes.productId, productId));
  await db
    .delete(productCategories)
    .where(eq(productCategories.productId, productId));

  const categoryRows = payload.categoryIds.map((categoryId) => ({
    id: nanoid(),
    productId,
    categoryId,
    createdAt: now,
  }));
  for (const chunk of chunkArray(categoryRows)) {
    await db.insert(productCategories).values(chunk);
  }

  for (const parsedSku of payload.skus) {
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

  const attributeRows = payload.attributes.map((attr) => ({
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

const manageProducts = new Hono<AppEnv>();

manageProducts.use('*', requireAdminMiddleware);

manageProducts.get(
  '/',
  requireAnyPermission(PERMISSIONS.PRODUCT_READ),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);
    const page = Math.max(
      1,
      Number.parseInt(c.req.query('page') ?? '1', 10) || 1
    );
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(
        1,
        Number.parseInt(
          c.req.query('pageSize') ?? String(DEFAULT_PAGE_SIZE),
          10
        ) || DEFAULT_PAGE_SIZE
      )
    );
    const search = sanitizeSearch(c.req.query('search'));
    const status = sanitizeStatus(c.req.query('status'));
    const source = sanitizeSource(c.req.query('source'));
    const categoryParam = c.req.query('categoryId')?.trim() ?? '';
    const categoryId =
      categoryParam && isValidId(categoryParam) ? categoryParam : null;
    const addedByParam = c.req.query('addedBy')?.trim() ?? '';
    const addedBy =
      addedByParam && isValidId(addedByParam) ? addedByParam : null;
    const featuredQuery = c.req.query('featured');
    const featured =
      featuredQuery === 'true'
        ? true
        : featuredQuery === 'false'
          ? false
          : null;
    const sortBy = sanitizeSortBy(c.req.query('sortBy'));
    const sortOrder = c.req.query('sortOrder') === 'asc' ? 'asc' : 'desc';

    try {
      const where = buildWhere({
        search,
        status,
        source,
        categoryId,
        featured,
        addedBy,
      });
      const [capabilities, totalRows, rows, addedByOptions] = await Promise.all(
        [
          resolveActorCapabilities(db, actor.id, actor.role),
          db.select({ value: count() }).from(products).where(where),
          // Lightweight list projection — only fields the manage grid needs.
          db
            .select({
              id: products.id,
              name: products.name,
              images: products.images,
              published: products.published,
              defaultPrice: products.defaultPrice,
              defaultEstProfit: products.defaultEstProfit,
            })
            .from(products)
            .where(where)
            .orderBy(buildOrderBy(sortBy, sortOrder))
            .limit(pageSize)
            .offset((page - 1) * pageSize),
          db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              image: users.image,
              role: users.role,
            })
            .from(users)
            .where(
              and(inArray(users.role, ADMIN_ROLES), eq(users.isDeleted, false))
            )
            .orderBy(
              sql`CASE WHEN ${users.role} = 'owner' THEN 0 ELSE 1 END`,
              asc(users.name)
            ),
        ]
      );

      const total = Number(totalRows[0]?.value ?? 0);
      return c.json({
        success: true,
        data: rows.map((row) => {
          const images = Array.isArray(row.images) ? row.images : [];
          // Only ship the first gallery image for the card thumbnail.
          const firstImage = firstGalleryImage(images);
          return {
            id: row.id,
            name: row.name,
            published: row.published,
            images: firstImage
              ? [
                  {
                    url:
                      resolveStoredImageUrl(firstImage.url, c) ??
                      firstImage.url,
                    forVariant: firstImage.forVariant,
                    isOp: firstImage.isOp === true ? true : undefined,
                  },
                ]
              : [],
            defaultPrice: row.defaultPrice ?? null,
            defaultEstProfit: row.defaultEstProfit ?? null,
          };
        }),
        meta: {
          currentUserId: actor.id,
          currentUserRole: actor.role,
          ...capabilities,
          total,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(total / pageSize) || 1),
          addedByOptions,
        },
      });
    } catch (error) {
      console.error('Error listing products:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load products.');
    }
  }
);

manageProducts.get(
  '/:id',
  requireAnyPermission(PERMISSIONS.PRODUCT_READ),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);
    const id = c.req.param('id');
    if (!isValidId(id))
      return errorJson(c, 400, 'INVALID_PRODUCT_ID', 'Invalid product id.');

    try {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);
      if (!product)
        return errorJson(c, 404, 'PRODUCT_NOT_FOUND', 'Product not found.');

      const nested = await loadNestedProductData(db, id);
      const capabilities = await resolveActorCapabilities(
        db,
        actor.id,
        actor.role
      );
      const [addedBy] = product.productAddedBy
        ? await db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              image: users.image,
            })
            .from(users)
            .where(eq(users.id, product.productAddedBy))
            .limit(1)
        : [];

      const origin = requestOrigin(c);
      const serialized = serializeProduct(product);
      return c.json({
        success: true,
        data: {
          ...serialized,
          images: resolveProductImagesForClient(serialized.images, c.env, {
            origin,
          }),
          sizeChartImage: resolveStoredImageUrl(serialized.sizeChartImage, c),
          ...nested,
          skus: nested.skus.map((sku) => ({
            ...sku,
            images: resolveProductImagesForClient(sku.images, c.env, {
              origin,
            }),
            properties: sku.properties.map((prop) => ({
              ...prop,
              image: resolveStoredImageUrl(prop.image, c),
            })),
          })),
          addedBy: addedBy ?? null,
        },
        meta: {
          currentUserId: actor.id,
          currentUserRole: actor.role,
          ...capabilities,
        },
      });
    } catch (error) {
      console.error('Error loading product:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load product.');
    }
  }
);

manageProducts.post(
  '/:id/host-images',
  requireAnyPermission(PERMISSIONS.PRODUCT_UPDATE),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);
    const id = c.req.param('id');
    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_PRODUCT_ID', 'Invalid product id.');
    }

    try {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);
      if (!product) {
        return errorJson(c, 404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      }

      const nested = await loadNestedProductData(db, id);
      const extraUrls: Array<string | null | undefined> = [
        product.sizeChartImage,
        ...nested.skus.flatMap((sku) =>
          sku.properties.map((prop) => prop.image)
        ),
      ];
      const skuNeedsHost = nested.skus.some((sku) =>
        productNeedsImageHosting(sku.images ?? [])
      );
      if (
        !productNeedsImageHosting(product.images ?? [], extraUrls) &&
        !skuNeedsHost
      ) {
        return errorJson(
          c,
          400,
          'IMAGES_ALREADY_HOSTED',
          'This product’s images are already on your storage.'
        );
      }

      const env = c.env;
      const origin = requestOrigin(c);

      return createProductHostSseResponse(c.req.raw, async (write, signal) => {
        const hosted = await hostProductImages({
          env,
          slug: product.slug,
          origin,
          signal,
          productImages: product.images ?? [],
          skuImages: nested.skus.map((sku) => sku.images ?? []),
          propertyImages: nested.skus.map((sku) =>
            sku.properties.map((prop) => prop.image)
          ),
          sizeChartImage: product.sizeChartImage ?? null,
          onProgress: (event) => {
            write('progress', event);
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

        const now = new Date();
        const hostedImages = persistProductImages(hosted.productImages);

        try {
          await db
            .update(products)
            .set({
              images: hostedImages,
              sizeChartImage: hosted.sizeChartImage,
              updatedAt: now,
            })
            .where(eq(products.id, id));

          for (let skuIndex = 0; skuIndex < nested.skus.length; skuIndex++) {
            const sku = nested.skus[skuIndex]!;
            await db
              .update(productSkus)
              .set({
                images: persistProductImages(
                  hosted.skuImages[skuIndex] ?? sku.images ?? []
                ),
              })
              .where(eq(productSkus.id, sku.id));

            const hostedProps = hosted.propertyImages[skuIndex];
            for (
              let propIndex = 0;
              propIndex < sku.properties.length;
              propIndex++
            ) {
              const prop = sku.properties[propIndex]!;
              const nextImage = hostedProps?.[propIndex] ?? prop.image;
              if (nextImage === prop.image) continue;
              await db
                .update(skuProperties)
                .set({ image: nextImage })
                .where(eq(skuProperties.id, prop.id));
            }
          }
        } catch (error) {
          console.error('Error saving hosted product images:', error);
          await deleteUploadedProductImageKeys(env, hosted.uploadedKeys);
          write('error', {
            success: false,
            code: 'INTERNAL_ERROR',
            message:
              'Images uploaded but saving the product failed. Please try again.',
            error:
              'Images uploaded but saving the product failed. Please try again.',
          });
          return;
        }

        c.executionCtx.waitUntil(
          logAuditFromContext(c, {
            action: AUDIT_ACTIONS.PRODUCT_UPDATE,
            category: AUDIT_CATEGORIES.PRODUCT,
            description: `Hosted product images for "${product.name}" on first-party storage`,
            targetType: AUDIT_TARGET_TYPES.PRODUCT,
            targetId: id,
            targetLabel: product.name,
            metadata: {
              hostedImageCount: hosted.hostedCount,
              optimisedImageCount: hosted.optimisedCount,
              editedBy: {
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
          message: `Images for "${product.name}" were uploaded to your storage.`,
          data: {
            id,
            slug: product.slug,
            name: product.name,
            imageCount: hostedImages.length,
          },
        });
        c.executionCtx.waitUntil(
          Promise.all([
            invalidatePublicProductCache(c.env.KV),
            invalidateHomepageCache(c.env.KV),
          ]).then(() => undefined)
        );
      });
    } catch (error) {
      console.error('Error hosting product images:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to host product images.'
      );
    }
  }
);

manageProducts.patch(
  '/:id',
  requireAnyPermission(PERMISSIONS.PRODUCT_UPDATE),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);
    const id = c.req.param('id');
    if (!isValidId(id))
      return errorJson(c, 400, 'INVALID_PRODUCT_ID', 'Invalid product id.');

    const parsedBody = await readJsonObject(c);
    if (!parsedBody.ok) return parsedBody.response;
    const payload = parseProductPayload(c, parsedBody.body);
    if (payload instanceof Response) return payload;

    try {
      const [existing] = await db
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);
      if (!existing)
        return errorJson(c, 404, 'PRODUCT_NOT_FOUND', 'Product not found.');

      if (payload.aeProductId) {
        const [duplicateAe] = await db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(
            and(
              eq(products.aeProductId, payload.aeProductId),
              ne(products.id, id)
            )
          )
          .limit(1);
        if (duplicateAe) {
          return errorJson(
            c,
            409,
            'AE_PRODUCT_EXISTS',
            `This AliExpress product is already imported as "${duplicateAe.name}".`
          );
        }
      }

      const existingCategories = await db
        .select({ id: categories.id })
        .from(categories)
        .where(inArray(categories.id, payload.categoryIds));
      if (existingCategories.length !== payload.categoryIds.length) {
        const found = new Set(
          existingCategories.map((category) => category.id)
        );
        const missing = payload.categoryIds.filter(
          (categoryId) => !found.has(categoryId)
        );
        return errorJson(
          c,
          400,
          'CATEGORY_NOT_FOUND',
          `Category not found: ${missing[0]}`
        );
      }

      const beforeNested = await loadNestedProductData(db, id);
      // Slug is always re-derived from the product title on edit (client may send it too).
      const slug = await ensureUniqueSlug(db, payload.slug || payload.name, id);
      const now = new Date();

      // AE identity + catalog position are immutable on edit — set at import time only.
      // Client cannot flip isAEProduct, re-link aeProductId, or change list position here.
      // D1 rejects SQL BEGIN/SAVEPOINT. Keep writes ordered because nested
      // SKU properties depend on the SKU rows being removed/created first.
      await db
        .update(products)
        .set({
          slug,
          name: payload.name,
          description: payload.description,
          mobileDetail: payload.mobileDetail,
          hasSizeChart: payload.hasSizeChart,
          sizeChartImage: payload.sizeChartImage,
          sizeChartDescription: payload.sizeChartDescription,
          defaultPrice: calculateProductDefaultPrice(payload.skus),
          defaultEstProfit: calculateProductDefaultEstProfit(payload.skus),
          isAEProduct: existing.isAEProduct,
          aeProductId: existing.aeProductId,
          aeCategoryId: existing.aeCategoryId,
          aeRating: existing.aeRating,
          aeReviewCount: existing.aeReviewCount,
          aeSalesCount: existing.aeSalesCount,
          aeStatus: existing.aeStatus,
          aeLastSynced: existing.aeLastSynced,
          images: payload.images,
          videos: payload.videos,
          mainVideo: payload.mainVideo,
          categoryId: payload.categoryIds[0] ?? null,
          published: payload.published,
          featured: payload.featured,
          position: existing.position,
          metaTitle: payload.metaTitle,
          metaDescription: payload.metaDescription,
          tags: payload.tags,
          productNotes: payload.productNotes,
          updatedAt: now,
        })
        .where(eq(products.id, id));

      // Nested SKUs/attrs/categories still come from the edit payload.
      await replaceNestedProductData(db, id, payload, now);

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.PRODUCT_UPDATE,
          category: AUDIT_CATEGORIES.PRODUCT,
          description: `Updated product "${payload.name}"`,
          targetType: AUDIT_TARGET_TYPES.PRODUCT,
          targetId: id,
          targetLabel: payload.name,
          changes: buildChanges(
            {
              name: existing.name,
              slug: existing.slug,
              published: existing.published,
              featured: existing.featured,
              categoryIds: beforeNested.categoryIds,
              skuCount: beforeNested.skus.length,
              attributeCount: beforeNested.attributes.length,
              imageCount: (existing.images ?? []).length,
            },
            {
              name: payload.name,
              slug,
              published: payload.published,
              featured: payload.featured,
              categoryIds: payload.categoryIds,
              skuCount: payload.skus.length,
              attributeCount: payload.attributes.length,
              imageCount: payload.images.length,
            }
          ),
          metadata: {
            editedBy: {
              id: actor.id,
              name: actor.name,
              email: actor.email,
              role: actor.role,
            },
          },
        }).then(() => undefined)
      );
      c.executionCtx.waitUntil(
        Promise.all([
          invalidatePublicProductCache(c.env.KV),
          invalidateHomepageCache(c.env.KV),
        ]).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `Product "${payload.name}" updated.`,
        data: { id, slug, name: payload.name, published: payload.published },
      });
    } catch (error) {
      console.error('Error updating product:', error);
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('unique') || message.includes('constraint')) {
        return errorJson(
          c,
          409,
          'CONFLICT',
          'A product with this slug or AliExpress id already exists.'
        );
      }
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to update product.');
    }
  }
);

manageProducts.delete(
  '/:id',
  requireAnyPermission(PERMISSIONS.PRODUCT_DELETE),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);
    const id = c.req.param('id');
    if (!isValidId(id))
      return errorJson(c, 400, 'INVALID_PRODUCT_ID', 'Invalid product id.');

    try {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);
      if (!product)
        return errorJson(c, 404, 'PRODUCT_NOT_FOUND', 'Product not found.');

      const body = await readOptionalJsonObject(c);
      if (body.confirm !== true) {
        return errorJson(
          c,
          409,
          'CONFIRM_REQUIRED',
          'Confirm deletion before deleting this product.'
        );
      }

      // D1 rejects SQL BEGIN/SAVEPOINT. Delete dependents before the product
      // so foreign-key cascades are not relied on for this ordered cleanup.
      const skuRows = await db
        .select({ id: productSkus.id })
        .from(productSkus)
        .where(eq(productSkus.productId, id));
      const skuIds = skuRows.map((sku) => sku.id);
      for (const chunk of chunkArray(skuIds, QUERY_CHUNK_SIZE)) {
        await db
          .delete(skuProperties)
          .where(inArray(skuProperties.skuId, chunk));
      }
      await db.delete(productSkus).where(eq(productSkus.productId, id));
      await db
        .delete(productAttributes)
        .where(eq(productAttributes.productId, id));
      await db
        .delete(productCategories)
        .where(eq(productCategories.productId, id));
      await db.delete(products).where(eq(products.id, id));

      // Reverse this product's contribution on the admin leaderboard.
      // Fail-soft: drift is recoverable via POST /api/admin-stats/sync.
      await decrementAdminProductContribution(db, product.productAddedBy, {
        orderCount: product.orderCount,
        totalRevenue: product.totalRevenue,
        revenueInProfit: product.revenueInProfit,
      });

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.PRODUCT_DELETE,
          category: AUDIT_CATEGORIES.PRODUCT,
          description: `Deleted product "${product.name}"`,
          targetType: AUDIT_TARGET_TYPES.PRODUCT,
          targetId: id,
          targetLabel: product.name,
          severity: 'warning',
          changes: {
            deleted: { from: false, to: true },
            published: { from: product.published },
          },
          metadata: {
            deletedBy: {
              id: actor.id,
              name: actor.name,
              email: actor.email,
              role: actor.role,
            },
          },
        }).then(() => undefined)
      );
      c.executionCtx.waitUntil(
        Promise.all([
          invalidatePublicProductCache(c.env.KV),
          invalidateHomepageCache(c.env.KV),
        ]).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `Product "${product.name}" deleted.`,
      });
    } catch (error) {
      console.error('Error deleting product:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to delete product.');
    }
  }
);

manageProducts.notFound((c) =>
  errorJson(c, 404, 'NOT_FOUND', 'Product management endpoint not found.')
);

export default manageProducts;
