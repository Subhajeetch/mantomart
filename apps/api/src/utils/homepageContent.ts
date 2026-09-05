import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  categories,
  composeProductImageAlt,
  homepageBlocks,
  isHomepageBlockType,
  productCategories,
  products,
  type Category,
  type Database,
  type HomepageBlock,
  type HomepageBlockConfig,
  type HomepageBlockType,
  type ProductImage,
  type ProductImageRecord,
  type ProductDefaultPrice,
} from '@repo/db';
import kvManager from '@/utils/kvManager';
import {
  normalizePublicPromoSlides,
  sanitizePromoSliderConfig,
  serializePublicPromoSlides,
  type PublicPromoSlide,
} from '@/utils/homepagePromo';
import {
  productCardImagesForClient,
  resolveProductImageUrlForClient,
} from '@/utils/productImageHost';
import type { R2UrlOptions } from '@/utils/r2';
import type Env from '@/types/env';

export type {
  PublicPromoSlide,
  PublicPromoSlideOffer,
  PublicPromoSlideProduct,
} from '@/utils/homepagePromo';

/** Public storefront homepage cache key. Bump when the product-card payload changes. */
export const HOMEPAGE_KV_KEY = 'store:homepage:v4';
const HOMEPAGE_FEED_VERSION_KEY = 'store:homepage:feed:version:v1';

/** 5 days in seconds — homepage blocks change infrequently. */
export const HOMEPAGE_CACHE_TTL_SECONDS = 5 * 24 * 60 * 60;
/** Feed pages are cached briefly because product prices and availability can change. */
export const HOMEPAGE_FEED_CACHE_TTL_SECONDS = 5 * 60;

export const MAX_BLOCKS = 40;
export const MAX_SLIDES_PER_SLIDER = 12;
export const MAX_BUTTONS_PER_CTA = 6;
export const MAX_GRID_LIMIT = 24;
export const MAX_FEED_PAGE_SIZE = 24;
export const DEFAULT_GRID_LIMIT = 8;
export const DEFAULT_FEED_PAGE_SIZE = 12;
export const MIN_FEED_PAGE_SIZE = 4;

const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 120;
const MAX_SUBTITLE_LENGTH = 240;
const MAX_CTA_LABEL_LENGTH = 40;
const MAX_URL_LENGTH = 2048;
const MAX_PRODUCT_CARD_IMAGES = 5;

export const HOMEPAGE_BLOCK_TYPES = [
  'promo_slider',
  'product_grid',
  'category_cta',
  'product_feed',
] as const;

// ─── Public payload types ─────────────────────────────────────────────────────

/** Gallery image on a public product card. Variant keys are stripped. */
export type PublicProductCardImage = {
  url: string;
  alt: string;
  position?: number;
  /** isOptimised — smaller card-sized copy hosted alongside the full image. */
  isOp?: boolean;
  /** Full-quality image URL paired with an optimized card image. */
  fullUrl?: string;
};

/**
 * Storefront product-card payload. Only fields the card renders:
 * gallery, title, cheapest-SKU pricing, link, units-sold, rating, review count.
 * No variants, copy, SEO, analytics, admin, or AliExpress source ids.
 */
export type PublicProductCard = {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  imageAlt: string | null;
  images: PublicProductCardImage[];
  defaultPrice: ProductDefaultPrice | null;
  price: number | null;
  compareAtPrice: number | null;
  onSale: boolean;
  href: string;
  aeSalesCount: string | null;
  aeRating: number | null;
  aeReviewCount: number | null;
};

export type PublicPromoSliderBlock = {
  id: string;
  blockType: 'promo_slider';
  position: number;
  config: { type: 'promo_slider'; slides: PublicPromoSlide[] };
};

export type PublicProductGridBlock = {
  id: string;
  blockType: 'product_grid';
  position: number;
  config: {
    type: 'product_grid';
    source: 'category' | 'featured';
    categoryId?: string;
    categoryName?: string | null;
    categorySlug?: string | null;
    limit: number;
  };
  products: PublicProductCard[];
};

export type PublicCategoryCtaButton = {
  id: string;
  label: string;
  categoryId: string;
  href: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  categoryImage: string | null;
};

export type PublicCategoryCtaBlock = {
  id: string;
  blockType: 'category_cta';
  position: number;
  config: {
    type: 'category_cta';
    title?: string;
    subtitle?: string;
    buttons: PublicCategoryCtaButton[];
  };
};

export type PublicProductFeedBlock = {
  id: string;
  blockType: 'product_feed';
  position: number;
  config: { type: 'product_feed'; pageSize: number };
  items: PublicProductCard[];
  nextCursor: string | null;
};

export type PublicHomepageBlock =
  | PublicPromoSliderBlock
  | PublicProductGridBlock
  | PublicCategoryCtaBlock
  | PublicProductFeedBlock;

export type HomepagePayload = {
  blocks: PublicHomepageBlock[];
  updatedAt: string | null;
  cachedAt: string;
};

export type HomepageAdminBlock = {
  id: string;
  blockType: HomepageBlockType;
  config: HomepageBlockConfig | Record<string, unknown>;
  position: number;
  isVisible: boolean;
  needsRepair: boolean;
  createdAt: Date | string | number | null;
  updatedAt: Date | string | number | null;
};

export type HomepageAvailableCategory = {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  position: number;
  parentId: string | null;
};

export type ProductFeedPage = {
  items: PublicProductCard[];
  nextCursor: string | null;
};

export type SanitizeConfigResult =
  | { ok: true; config: HomepageBlockConfig }
  | { ok: false; error: string; code: string };

export type BlockOrderRow = {
  id: string;
  blockType: string;
  position: number;
};

// ─── Small helpers ────────────────────────────────────────────────────────────

export function isValidId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampInt(value: number, minValue: number, maxValue: number): number {
  if (!Number.isFinite(value)) return minValue;
  return Math.max(minValue, Math.min(maxValue, Math.floor(value)));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function asTrimmedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  return truncate(trimmed, max);
}

function productHref(slug: string): string {
  return `/product/${slug}`;
}

function categoryHref(slug: string): string {
  return `/category/${slug}`;
}

/**
 * Image URLs must be http(s) or the Worker-served R2 path `/api/images/...`.
 */
export function isAllowedImageUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  if (url.startsWith('/api/images/')) return true;
  return /^https?:\/\//i.test(url);
}

export function isAllowedHref(url: string): boolean {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  if (url.startsWith('/')) return true;
  return /^https?:\/\//i.test(url);
}

function getUpdatedTime(value: Date | string | number | null): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function trackLatest(
  current: number | null,
  value: Date | string | number | null
): number | null {
  const next = getUpdatedTime(value);
  if (next === null) return current;
  if (current === null) return next;
  return Math.max(current, next);
}

function sortByPosition<T extends { position: number; id: string }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });
}

function primaryImage(
  images: ProductImage[] | null | undefined,
  productName = ''
): { url: string; alt: string } | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const sorted = [...images].sort((a, b) => {
    const ap = typeof a?.position === 'number' ? a.position : 0;
    const bp = typeof b?.position === 'number' ? b.position : 0;
    return ap - bp;
  });
  for (const img of sorted) {
    if (!img || typeof img.url !== 'string') continue;
    const url = img.url.trim();
    if (!url) continue;
    return {
      url,
      alt: composeProductImageAlt(productName, img as ProductImageRecord),
    };
  }
  return null;
}

function toPrice(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toRating(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null || n <= 0 || n > 5) return null;
  return n;
}

function toReviewCount(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null || n < 0) return null;
  return Math.floor(n);
}

function optionalTrimmed(
  value: unknown,
  max = MAX_TITLE_LENGTH
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return truncate(trimmed, max);
}

function publicImages(
  images: ProductImage[] | null | undefined,
  env: Env,
  options?: R2UrlOptions,
  productName = ''
): PublicProductCardImage[] {
  return productCardImagesForClient(images, env, options, productName);
}

function normalizePayloadImages(
  images: ProductImage[] | null | undefined
): PublicProductCardImage[] {
  if (!Array.isArray(images) || images.length === 0) return [];
  const cleaned: PublicProductCardImage[] = [];
  for (const img of images) {
    if (!img || typeof img.url !== 'string') continue;
    const url = img.url.trim();
    if (!url) continue;
    const alt = composeProductImageAlt('', img as ProductImageRecord);
    const position =
      typeof img.position === 'number' && Number.isFinite(img.position)
        ? img.position
        : cleaned.length;
    const item: PublicProductCardImage = { url, alt, position };
    if (img.isOp === true) item.isOp = true;
    const record = img as unknown as Record<string, unknown>;
    const fullUrl = asTrimmedString(record.fullUrl, MAX_URL_LENGTH);
    if (fullUrl) item.fullUrl = fullUrl;
    cleaned.push(item);
  }
  cleaned.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return cleaned.slice(0, MAX_PRODUCT_CARD_IMAGES);
}

export const PRODUCT_CARD_COLUMNS = {
  id: products.id,
  slug: products.slug,
  name: products.name,
  images: products.images,
  defaultPrice: products.defaultPrice,
  aeSalesCount: products.aeSalesCount,
  aeRating: products.aeRating,
  aeReviewCount: products.aeReviewCount,
  position: products.position,
};

export type ProductCardRow = {
  id: string;
  slug: string;
  name: string;
  images: ProductImage[] | null;
  aeSalesCount: string | null;
  aeRating: number | null;
  aeReviewCount: number | null;
  position: number;
  defaultPrice: ProductDefaultPrice | null;
};

export function encodeFeedCursor(position: number, id: string): string {
  const raw = `${position}:${id}`;
  return Buffer.from(raw, 'utf8').toString('base64');
}

export function decodeFeedCursor(
  raw: string | null | undefined
): { position: number; id: string } | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const decoded = Buffer.from(raw.trim(), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep <= 0) return null;
    const position = Number.parseInt(decoded.slice(0, sep), 10);
    const id = decoded.slice(sep + 1);
    if (!Number.isFinite(position) || !isValidId(id)) return null;
    return { position, id };
  } catch {
    return null;
  }
}

/**
 * At most one product_feed, and it must be last after (position, id) sort.
 */
export function assertFeedLastInvariant(
  rows: BlockOrderRow[]
): { ok: true } | { ok: false; message: string } {
  const sorted = sortByPosition(rows);
  const feeds = sorted.filter((row) => row.blockType === 'product_feed');
  if (feeds.length > 1) {
    return {
      ok: false,
      message: 'Only one product feed block is allowed.',
    };
  }
  if (feeds.length === 1) {
    const last = sorted[sorted.length - 1];
    if (!last || last.id !== feeds[0]!.id) {
      return {
        ok: false,
        message: 'The product feed must be the last homepage block.',
      };
    }
  }
  return { ok: true };
}

function defaultConfig(blockType: HomepageBlockType): HomepageBlockConfig {
  switch (blockType) {
    case 'promo_slider':
      return { type: 'promo_slider', slides: [] };
    case 'product_grid':
      return {
        type: 'product_grid',
        source: 'featured',
        limit: DEFAULT_GRID_LIMIT,
      };
    case 'category_cta':
      return { type: 'category_cta', buttons: [] };
    case 'product_feed':
      return { type: 'product_feed', pageSize: DEFAULT_FEED_PAGE_SIZE };
  }
}

function sanitizeOptionalUrl(
  value: unknown,
  kind: 'image' | 'href'
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (!url) return undefined;
  if (url.length > MAX_URL_LENGTH) return undefined;
  if (kind === 'image' && !isAllowedImageUrl(url)) return undefined;
  if (kind === 'href' && !isAllowedHref(url)) return undefined;
  return url;
}

/**
 * Strict sanitizer used by admin writes. Rejects invalid nested fields.
 * `knownCategoryIds` / `knownProductIds` — when provided, referenced ids must exist.
 */
export function sanitizeHomepageConfig(
  blockType: HomepageBlockType,
  raw: unknown,
  knownCategoryIds?: Set<string>,
  knownProductIds?: Set<string>
): SanitizeConfigResult {
  const body = isRecord(raw) ? raw : {};

  if (blockType === 'promo_slider') {
    return sanitizePromoSliderConfig(
      body,
      MAX_SLIDES_PER_SLIDER,
      knownCategoryIds,
      knownProductIds
    );
  }

  if (blockType === 'product_grid') {
    const source = body.source === 'category' ? 'category' : 'featured';
    const limitRaw =
      typeof body.limit === 'number'
        ? body.limit
        : typeof body.limit === 'string'
          ? Number.parseInt(body.limit, 10)
          : DEFAULT_GRID_LIMIT;
    if (!Number.isFinite(limitRaw)) {
      return {
        ok: false,
        error: 'Grid limit must be a number.',
        code: 'INVALID_LIMIT',
      };
    }
    const limit = clampInt(limitRaw, 1, MAX_GRID_LIMIT);
    let categoryId: string | undefined;
    if (source === 'category') {
      if (
        typeof body.categoryId !== 'string' ||
        !isValidId(body.categoryId.trim())
      ) {
        return {
          ok: false,
          error: 'Pick a category for this product grid.',
          code: 'INVALID_CATEGORY_ID',
        };
      }
      categoryId = body.categoryId.trim();
      if (knownCategoryIds && !knownCategoryIds.has(categoryId)) {
        return {
          ok: false,
          error: 'Selected category was not found.',
          code: 'CATEGORY_NOT_FOUND',
        };
      }
    }
    return {
      ok: true,
      config: categoryId
        ? { type: 'product_grid', source, categoryId, limit }
        : { type: 'product_grid', source: 'featured', limit },
    };
  }

  if (blockType === 'category_cta') {
    if (body.buttons !== undefined && !Array.isArray(body.buttons)) {
      return {
        ok: false,
        error: 'CTA buttons must be an array.',
        code: 'INVALID_BUTTONS',
      };
    }
    const buttonsRaw = Array.isArray(body.buttons) ? body.buttons : [];
    if (buttonsRaw.length > MAX_BUTTONS_PER_CTA) {
      return {
        ok: false,
        error: `A CTA can have at most ${MAX_BUTTONS_PER_CTA} buttons.`,
        code: 'MAX_BUTTONS',
      };
    }
    const buttons: PublicCategoryCtaButton[] = [];
    const seen = new Set<string>();
    for (const entry of buttonsRaw) {
      if (!isRecord(entry)) {
        return {
          ok: false,
          error: 'Each CTA button must be an object.',
          code: 'INVALID_BUTTON',
        };
      }
      const label = asTrimmedString(entry.label, MAX_CTA_LABEL_LENGTH);
      if (!label) {
        return {
          ok: false,
          error: 'Each CTA button needs a label.',
          code: 'INVALID_BUTTON_LABEL',
        };
      }
      if (
        typeof entry.categoryId !== 'string' ||
        !isValidId(entry.categoryId.trim())
      ) {
        return {
          ok: false,
          error: 'Each CTA button must link to a category.',
          code: 'INVALID_CATEGORY_ID',
        };
      }
      const categoryId = entry.categoryId.trim();
      if (knownCategoryIds && !knownCategoryIds.has(categoryId)) {
        return {
          ok: false,
          error: `Category for button "${label}" was not found.`,
          code: 'CATEGORY_NOT_FOUND',
        };
      }
      let id =
        typeof entry.id === 'string' && isValidId(entry.id.trim())
          ? entry.id.trim()
          : nanoid();
      if (seen.has(id)) id = nanoid();
      seen.add(id);
      const href = sanitizeOptionalUrl(entry.href, 'href');
      buttons.push({
        id,
        label,
        categoryId,
        href: href ?? null,
        categoryName: null,
        categorySlug: null,
        categoryImage: null,
      });
    }
    const title = asTrimmedString(body.title, MAX_TITLE_LENGTH);
    const subtitle = asTrimmedString(body.subtitle, MAX_SUBTITLE_LENGTH);
    const config: HomepageBlockConfig = {
      type: 'category_cta',
      buttons: buttons.map((btn) => ({
        id: btn.id,
        label: btn.label,
        categoryId: btn.categoryId,
        ...(btn.href ? { href: btn.href } : {}),
      })),
    };
    if (title) config.title = title;
    if (subtitle) config.subtitle = subtitle;
    return { ok: true, config };
  }

  // product_feed
  const pageSizeRaw =
    typeof body.pageSize === 'number'
      ? body.pageSize
      : typeof body.pageSize === 'string'
        ? Number.parseInt(body.pageSize, 10)
        : DEFAULT_FEED_PAGE_SIZE;
  if (!Number.isFinite(pageSizeRaw)) {
    return {
      ok: false,
      error: 'Feed page size must be a number.',
      code: 'INVALID_PAGE_SIZE',
    };
  }
  const pageSize = clampInt(
    pageSizeRaw,
    MIN_FEED_PAGE_SIZE,
    MAX_FEED_PAGE_SIZE
  );
  return { ok: true, config: { type: 'product_feed', pageSize } };
}

export function defaultHomepageConfig(
  blockType: HomepageBlockType
): HomepageBlockConfig {
  return defaultConfig(blockType);
}

/**
 * Lenient config repair for public/admin reads. Never throws.
 * Returns null when the block cannot be represented.
 */
export function normalizeStoredConfig(
  blockType: HomepageBlockType,
  raw: unknown
): HomepageBlockConfig | null {
  const result = sanitizeHomepageConfig(blockType, raw);
  if (result.ok) return result.config;
  // Soft-repair: fall back to empty defaults so admin can still open the row.
  if (!isRecord(raw)) return defaultConfig(blockType);
  return defaultConfig(blockType);
}

export function configNeedsRepair(
  blockType: HomepageBlockType,
  raw: unknown
): boolean {
  return !sanitizeHomepageConfig(blockType, raw).ok;
}

// ─── Product card loader ──────────────────────────────────────────────────────

function toPublicProductCard(
  row: ProductCardRow,
  env: Env,
  options?: R2UrlOptions
): PublicProductCard {
  const images = publicImages(row.images, env, options, row.name);
  const img = images[0] ?? primaryImage(row.images, row.name);
  const imageUrl = img?.url
    ? resolveProductImageUrlForClient(img.url, env, options)
    : null;
  const price = row.defaultPrice?.normalPrice.from ?? null;
  const compareAtPrice = row.defaultPrice?.comparedPrice.from ?? null;
  const onSale =
    price !== null && compareAtPrice !== null && compareAtPrice > price;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    imageUrl,
    imageAlt: img?.alt ?? null,
    images,
    defaultPrice: row.defaultPrice ?? null,
    price,
    compareAtPrice,
    onSale,
    href: productHref(row.slug),
    aeSalesCount: optionalTrimmed(row.aeSalesCount, 64),
    aeRating: toRating(row.aeRating),
    aeReviewCount: toReviewCount(row.aeReviewCount),
  };
}

export async function hydrateProductCards(
  db: Database,
  rows: ProductCardRow[],
  env: Env,
  options?: R2UrlOptions
): Promise<PublicProductCard[]> {
  if (rows.length === 0) return [];

  const seen = new Set<string>();
  const cards: PublicProductCard[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    cards.push(toPublicProductCard(row, env, options));
  }
  return cards;
}

async function loadPublishedProducts(
  db: Database,
  options: {
    source: 'all' | 'featured' | 'category';
    categoryId?: string;
    limit: number;
    cursor?: { position: number; id: string } | null;
    env: Env;
    origin?: string;
  }
): Promise<{ items: PublicProductCard[]; nextCursor: string | null }> {
  const take = clampInt(options.limit, 1, MAX_FEED_PAGE_SIZE);
  const cursor = options.cursor ?? null;

  const cursorClause = cursor
    ? or(
        gt(products.position, cursor.position),
        and(eq(products.position, cursor.position), gt(products.id, cursor.id))
      )
    : undefined;

  let productRows: ProductCardRow[] = [];

  if (options.source === 'category' && options.categoryId) {
    const categoryId = options.categoryId;
    const whereClause = cursorClause
      ? and(
          eq(products.published, true),
          or(
            eq(products.categoryId, categoryId),
            sql`EXISTS (
              SELECT 1
              FROM product_categories pc
              WHERE pc.product_id = ${products.id}
                AND pc.category_id = ${categoryId}
            )`
          ),
          cursorClause
        )
      : and(
          eq(products.published, true),
          or(
            eq(products.categoryId, categoryId),
            sql`EXISTS (
              SELECT 1
              FROM product_categories pc
              WHERE pc.product_id = ${products.id}
                AND pc.category_id = ${categoryId}
            )`
          )
        );

    productRows = await db
      .select(PRODUCT_CARD_COLUMNS)
      .from(products)
      .where(whereClause)
      .orderBy(asc(products.position), asc(products.id))
      .limit(take + 1);
  } else {
    const filters = [eq(products.published, true)];
    if (options.source === 'featured') {
      filters.push(eq(products.featured, true));
    }
    if (cursorClause) filters.push(cursorClause);

    productRows = await db
      .select(PRODUCT_CARD_COLUMNS)
      .from(products)
      .where(and(...filters))
      .orderBy(asc(products.position), asc(products.id))
      .limit(take + 1);
  }

  const hasMore = productRows.length > take;
  const page = hasMore ? productRows.slice(0, take) : productRows;
  const items = await hydrateProductCards(db, page, options.env, {
    origin: options.origin,
  });
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeFeedCursor(last.position, last.id) : null;
  return { items, nextCursor };
}

/**
 * Infinite-scroll product page. Never throws — empty page on error.
 * Bad cursors are treated as the start of the feed.
 */
export async function loadProductFeedPage(
  db: Database,
  cursor: string | null | undefined,
  pageSize: number | null | undefined,
  env: Env,
  origin?: string
): Promise<ProductFeedPage> {
  try {
    const size = clampInt(
      typeof pageSize === 'number' && Number.isFinite(pageSize)
        ? pageSize
        : DEFAULT_FEED_PAGE_SIZE,
      MIN_FEED_PAGE_SIZE,
      MAX_FEED_PAGE_SIZE
    );
    const decoded = decodeFeedCursor(cursor);
    return await loadPublishedProducts(db, {
      source: 'all',
      limit: size,
      cursor: decoded,
      env,
      origin,
    });
  } catch (error) {
    console.error('Failed to load product feed page:', error);
    return { items: [], nextCursor: null };
  }
}

function productFeedCacheKey(
  version: string,
  cursor: string | null | undefined,
  pageSize: number,
  origin?: string
): string {
  return [
    'store:homepage:feed:v1',
    version,
    String(pageSize),
    encodeURIComponent(cursor ?? 'first'),
    encodeURIComponent(origin ?? 'relative'),
  ].join(':');
}

/**
 * Resolve a feed page from KV before querying D1. KV failures are intentionally
 * non-fatal so the feed remains available when the cache is unavailable.
 */
export async function getPublicProductFeedPage(
  db: Database,
  kv: KVNamespace,
  cursor: string | null | undefined,
  pageSize: number | null | undefined,
  env: Env,
  origin?: string
): Promise<{ data: ProductFeedPage; source: 'kv' | 'db' }> {
  const size = clampInt(
    typeof pageSize === 'number' && Number.isFinite(pageSize)
      ? pageSize
      : DEFAULT_FEED_PAGE_SIZE,
    MIN_FEED_PAGE_SIZE,
    MAX_FEED_PAGE_SIZE
  );
  const manager = kvManager(kv);
  let version = 'v1';
  try {
    version = (await manager.get(HOMEPAGE_FEED_VERSION_KEY)) ?? 'v1';
  } catch (error) {
    console.error('Failed to read homepage feed cache version:', error);
  }
  const key = productFeedCacheKey(version, cursor, size, origin);

  try {
    const cached = await manager.getJson<ProductFeedPage>(key);
    if (
      cached &&
      Array.isArray(cached.items) &&
      cached.items.every((item) => normalizeProductCard(item) !== null) &&
      (cached.nextCursor === null || typeof cached.nextCursor === 'string')
    ) {
      return {
        data: {
          items: cached.items
            .map((item) => normalizeProductCard(item))
            .filter((item): item is PublicProductCard => item !== null),
          nextCursor: cached.nextCursor,
        },
        source: 'kv',
      };
    }
  } catch (error) {
    console.error('Failed to read homepage feed from KV:', error);
  }

  const data = await loadProductFeedPage(db, cursor, size, env, origin);
  try {
    await manager.setJson(key, data, {
      expirationTtl: HOMEPAGE_FEED_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.error('Failed to write homepage feed to KV:', error);
  }
  return { data, source: 'db' };
}

// ─── Public homepage ──────────────────────────────────────────────────────────

async function serializePublicBlock(
  db: Database,
  row: HomepageBlock,
  categoriesById: Map<string, Category>,
  env: Env,
  options?: R2UrlOptions
): Promise<PublicHomepageBlock | null> {
  if (!isHomepageBlockType(row.blockType)) {
    console.warn(
      `Skipping homepage block ${row.id}: unknown type ${String(row.blockType)}`
    );
    return null;
  }

  const config = normalizeStoredConfig(row.blockType, row.config);
  if (!config) {
    console.warn(`Skipping homepage block ${row.id}: malformed config`);
    return null;
  }

  if (config.type === 'promo_slider') {
    let slides: PublicPromoSlide[] = [];
    try {
      slides = await serializePublicPromoSlides(
        db,
        config,
        categoriesById,
        env,
        options
      );
    } catch (error) {
      console.warn(`Failed to serialize promo slider ${row.id}:`, error);
    }
    return {
      id: row.id,
      blockType: 'promo_slider',
      position: row.position,
      config: { type: 'promo_slider', slides },
    };
  }

  if (config.type === 'product_grid') {
    const category =
      config.source === 'category' && config.categoryId
        ? (categoriesById.get(config.categoryId) ?? null)
        : null;
    let productsForGrid: PublicProductCard[] = [];
    try {
      const loaded = await loadPublishedProducts(db, {
        source: config.source,
        categoryId: config.categoryId,
        limit: config.limit,
        env,
        origin: options?.origin,
      });
      productsForGrid = loaded.items;
    } catch (error) {
      console.warn(`Failed to hydrate product grid ${row.id}:`, error);
    }
    return {
      id: row.id,
      blockType: 'product_grid',
      position: row.position,
      config: {
        type: 'product_grid',
        source: config.source,
        categoryId: config.categoryId,
        categoryName: category?.name ?? null,
        categorySlug: category?.slug ?? null,
        limit: config.limit,
      },
      products: productsForGrid,
    };
  }

  if (config.type === 'category_cta') {
    const buttons: PublicCategoryCtaButton[] = [];
    for (const btn of config.buttons) {
      const category = categoriesById.get(btn.categoryId) ?? null;
      const href =
        (btn.href && btn.href.trim()) ||
        (category ? categoryHref(category.slug) : null);
      if (!href) continue;
      buttons.push({
        id: btn.id,
        label: btn.label,
        categoryId: btn.categoryId,
        href,
        categoryName: category?.name ?? null,
        categorySlug: category?.slug ?? null,
        categoryImage: category?.image ?? null,
      });
    }
    return {
      id: row.id,
      blockType: 'category_cta',
      position: row.position,
      config: {
        type: 'category_cta',
        title: config.title,
        subtitle: config.subtitle,
        buttons,
      },
    };
  }

  // product_feed — include the first page so SSR HTML has real products.
  let feed: ProductFeedPage = { items: [], nextCursor: null };
  try {
    feed = await loadPublishedProducts(db, {
      source: 'all',
      limit: config.pageSize,
      env,
      origin: options?.origin,
    });
  } catch (error) {
    console.warn(`Failed to hydrate product feed ${row.id}:`, error);
  }
  return {
    id: row.id,
    blockType: 'product_feed',
    position: row.position,
    config: { type: 'product_feed', pageSize: config.pageSize },
    items: feed.items,
    nextCursor: feed.nextCursor,
  };
}

/**
 * Load visible homepage blocks from D1, hydrate products/categories,
 * skip malformed rows. Never throws on bad config.
 */
export async function loadPublicHomepageFromDb(
  db: Database,
  env: Env,
  origin?: string
): Promise<HomepagePayload> {
  const [rows, categoryRows] = await Promise.all([
    db
      .select()
      .from(homepageBlocks)
      .where(eq(homepageBlocks.isVisible, true))
      .orderBy(asc(homepageBlocks.position), asc(homepageBlocks.id)),
    db
      .select()
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.name)),
  ]);

  const categoriesById = new Map(categoryRows.map((row) => [row.id, row]));
  let latestUpdated: number | null = null;
  for (const row of rows) {
    latestUpdated = trackLatest(latestUpdated, row.updatedAt);
  }

  const blocks: PublicHomepageBlock[] = [];
  for (const row of rows) {
    try {
      const serialized = await serializePublicBlock(
        db,
        row,
        categoriesById,
        env,
        {
          origin,
        }
      );
      if (serialized) blocks.push(serialized);
    } catch (error) {
      console.warn(`Skipping homepage block ${row.id}:`, error);
    }
  }

  return {
    blocks,
    updatedAt:
      latestUpdated !== null ? new Date(latestUpdated).toISOString() : null,
    cachedAt: new Date().toISOString(),
  };
}

function normalizePublicBlock(raw: unknown): PublicHomepageBlock | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const blockType = raw.blockType;
  const position =
    typeof raw.position === 'number' && Number.isFinite(raw.position)
      ? raw.position
      : 0;
  if (!id || !isHomepageBlockType(blockType)) return null;

  if (blockType === 'promo_slider') {
    const config = isRecord(raw.config) ? raw.config : {};
    const slides = normalizePublicPromoSlides(config.slides);
    return {
      id,
      blockType: 'promo_slider',
      position,
      config: { type: 'promo_slider', slides },
    };
  }

  if (blockType === 'product_grid') {
    const config = isRecord(raw.config) ? raw.config : {};
    const source = config.source === 'category' ? 'category' : 'featured';
    const limit = clampInt(
      typeof config.limit === 'number' ? config.limit : DEFAULT_GRID_LIMIT,
      1,
      MAX_GRID_LIMIT
    );
    const productsRaw = Array.isArray(raw.products) ? raw.products : [];
    const productCards = productsRaw
      .map(normalizeProductCard)
      .filter((card): card is PublicProductCard => card !== null);
    return {
      id,
      blockType: 'product_grid',
      position,
      config: {
        type: 'product_grid',
        source,
        categoryId:
          typeof config.categoryId === 'string' ? config.categoryId : undefined,
        categoryName:
          typeof config.categoryName === 'string' ? config.categoryName : null,
        categorySlug:
          typeof config.categorySlug === 'string' ? config.categorySlug : null,
        limit,
      },
      products: productCards,
    };
  }

  if (blockType === 'category_cta') {
    const config = isRecord(raw.config) ? raw.config : {};
    const buttonsRaw = Array.isArray(config.buttons) ? config.buttons : [];
    const buttons: PublicCategoryCtaButton[] = [];
    for (const entry of buttonsRaw) {
      if (!isRecord(entry)) continue;
      const btnId = typeof entry.id === 'string' ? entry.id : '';
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      const categoryId =
        typeof entry.categoryId === 'string' ? entry.categoryId : '';
      if (!btnId || !label || !categoryId) continue;
      const href =
        typeof entry.href === 'string' && entry.href.trim()
          ? entry.href.trim()
          : null;
      buttons.push({
        id: btnId,
        label,
        categoryId,
        href,
        categoryName:
          typeof entry.categoryName === 'string' ? entry.categoryName : null,
        categorySlug:
          typeof entry.categorySlug === 'string' ? entry.categorySlug : null,
        categoryImage:
          typeof entry.categoryImage === 'string' ? entry.categoryImage : null,
      });
    }
    return {
      id,
      blockType: 'category_cta',
      position,
      config: {
        type: 'category_cta',
        title: typeof config.title === 'string' ? config.title : undefined,
        subtitle:
          typeof config.subtitle === 'string' ? config.subtitle : undefined,
        buttons,
      },
    };
  }

  const config = isRecord(raw.config) ? raw.config : {};
  const pageSize = clampInt(
    typeof config.pageSize === 'number'
      ? config.pageSize
      : DEFAULT_FEED_PAGE_SIZE,
    MIN_FEED_PAGE_SIZE,
    MAX_FEED_PAGE_SIZE
  );
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items = itemsRaw
    .map(normalizeProductCard)
    .filter((card): card is PublicProductCard => card !== null);
  const nextCursor =
    typeof raw.nextCursor === 'string' && raw.nextCursor.trim()
      ? raw.nextCursor
      : null;
  return {
    id,
    blockType: 'product_feed',
    position,
    config: { type: 'product_feed', pageSize },
    items,
    nextCursor,
  };
}

function normalizeProductCard(raw: unknown): PublicProductCard | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id || !slug || !name) return null;
  const price = toPrice(raw.price as number | string | null);
  const compareAtPrice = toPrice(raw.compareAtPrice as number | string | null);
  const defaultPrice = normalizeDefaultPrice(raw.defaultPrice);
  const onSale =
    typeof raw.onSale === 'boolean'
      ? raw.onSale
      : price !== null && compareAtPrice !== null && compareAtPrice > price;
  const href =
    typeof raw.href === 'string' && raw.href.trim()
      ? raw.href.trim()
      : productHref(slug);
  const imageUrl =
    typeof raw.imageUrl === 'string' && raw.imageUrl.trim()
      ? raw.imageUrl.trim()
      : null;
  const imageAlt =
    typeof raw.imageAlt === 'string' && raw.imageAlt.trim()
      ? raw.imageAlt.trim()
      : null;
  let images = normalizePayloadImages(raw.images as ProductImage[] | null);
  if (images.length === 0 && imageUrl) {
    images = [{ url: imageUrl, alt: imageAlt ?? name }];
  }

  return {
    id,
    slug,
    name,
    imageUrl: images[0]?.url ?? imageUrl,
    imageAlt: images[0]?.alt ?? imageAlt,
    images,
    defaultPrice,
    price,
    compareAtPrice,
    onSale,
    href,
    aeSalesCount: optionalTrimmed(raw.aeSalesCount, 64),
    aeRating: toRating(raw.aeRating),
    aeReviewCount: toReviewCount(raw.aeReviewCount),
  };
}

function normalizeDefaultPrice(raw: unknown): ProductDefaultPrice | null {
  if (!isRecord(raw)) return null;

  const normalizeRange = (value: unknown) => {
    if (!isRecord(value)) return { from: null, to: null };
    return {
      from: toPrice(value.from as number | string | null | undefined),
      to: toPrice(value.to as number | string | null | undefined),
    };
  };

  const normalPrice = normalizeRange(raw.normalPrice);
  const comparedPrice = normalizeRange(raw.comparedPrice);
  if (
    normalPrice.from === null &&
    normalPrice.to === null &&
    comparedPrice.from === null &&
    comparedPrice.to === null
  ) {
    return null;
  }

  return { normalPrice, comparedPrice };
}

export function normalizePublicPayload(raw: HomepagePayload): HomepagePayload {
  const blocks = Array.isArray(raw.blocks)
    ? raw.blocks
        .map((block) => normalizePublicBlock(block))
        .filter((block): block is PublicHomepageBlock => block !== null)
    : [];

  return {
    blocks,
    updatedAt: raw.updatedAt ?? null,
    cachedAt: raw.cachedAt || new Date().toISOString(),
  };
}

/**
 * Resolve public homepage: KV first, then D1. Re-populates KV on miss.
 * KV failures never break the read.
 */
export async function getPublicHomepage(
  db: Database,
  kv: KVNamespace,
  env: Env,
  origin?: string
): Promise<{ data: HomepagePayload; source: 'kv' | 'db' }> {
  const manager = kvManager(kv);

  try {
    const cached = await manager.getJson<HomepagePayload>(HOMEPAGE_KV_KEY);
    if (cached && typeof cached === 'object' && Array.isArray(cached.blocks)) {
      return { data: normalizePublicPayload(cached), source: 'kv' };
    }
  } catch (error) {
    console.error('Failed to read homepage from KV:', error);
  }

  const data = normalizePublicPayload(
    await loadPublicHomepageFromDb(db, env, origin)
  );

  try {
    await manager.setJson(HOMEPAGE_KV_KEY, data, {
      expirationTtl: HOMEPAGE_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.error('Failed to write homepage to KV:', error);
  }

  return { data, source: 'db' };
}

/** Drop the public homepage cache so the next store request rebuilds from D1. */
export async function invalidateHomepageCache(kv: KVNamespace): Promise<void> {
  const manager = kvManager(kv);
  try {
    await Promise.all([
      manager.delete(HOMEPAGE_KV_KEY),
      manager.set(HOMEPAGE_FEED_VERSION_KEY, nanoid()),
    ]);
  } catch (error) {
    console.error('Failed to invalidate homepage KV cache:', error);
  }
}

/**
 * Full block list for admin (includes hidden rows, no product hydration).
 */
export async function loadAdminHomepageFromDb(
  db: Database
): Promise<HomepageAdminBlock[]> {
  const rows = await db
    .select()
    .from(homepageBlocks)
    .orderBy(asc(homepageBlocks.position), asc(homepageBlocks.id));

  return rows.map((row) => {
    const blockType = isHomepageBlockType(row.blockType)
      ? row.blockType
      : 'promo_slider';
    const needsRepair =
      !isHomepageBlockType(row.blockType) ||
      configNeedsRepair(blockType, row.config);
    const config = isRecord(row.config)
      ? (row.config as HomepageBlockConfig | Record<string, unknown>)
      : defaultHomepageConfig(blockType);
    return {
      id: row.id,
      blockType,
      config,
      position: row.position,
      isVisible: row.isVisible,
      needsRepair,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export async function loadAvailableHomepageCategories(
  db: Database
): Promise<HomepageAvailableCategory[]> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      image: categories.image,
      position: categories.position,
      parentId: categories.parentId,
    })
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    image: row.image,
    position: row.position,
    parentId: row.parentId,
  }));
}

export async function loadCategoryIdSet(db: Database): Promise<Set<string>> {
  const rows = await db.select({ id: categories.id }).from(categories);
  return new Set(rows.map((row) => row.id));
}
