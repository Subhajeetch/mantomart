import { and, asc, eq, gt, inArray, ne, not, or, type SQL } from 'drizzle-orm';
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
import type Env from '@/types/env';
import kvManager from '@/utils/kvManager';
import {
  DEFAULT_FEED_PAGE_SIZE,
  hydrateProductCards,
  isValidId,
  MAX_FEED_PAGE_SIZE,
  MIN_FEED_PAGE_SIZE,
  PRODUCT_CARD_COLUMNS,
  type ProductCardRow,
  type PublicProductCard,
} from '@/utils/homepageContent';
import {
  resolveProductImageUrlForClient,
  resolveProductImagesForClient,
} from '@/utils/productImageHost';
import type { R2UrlOptions } from '@/utils/r2';

const MAX_SLUG_LENGTH = 180;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CATEGORY_WALK = 8;
const QUERY_CHUNK = 80;
const MAX_HTML_LENGTH = 200_000;
const MAX_MORE_FOR_YOU_ITEMS = 36;

const PRODUCT_CACHE_TTL_SECONDS = 300;
const PRODUCT_CACHE_VERSION_KEY = 'store:product:version:v1';

const DANGEROUS_TAG_RE =
  /<\/?(?:script|iframe|object|embed|link|meta|base|form|input|button|textarea|select|style)(?:\s[\s\S]*?)?>/gi;

export const PUBLIC_PRODUCT_CACHE_TTL_SECONDS = PRODUCT_CACHE_TTL_SECONDS;

function productCacheKey(
  version: string,
  slug: string,
  origin?: string
): string {
  return `store:product:v1:${version}:${encodeURIComponent(slug)}:${encodeURIComponent(origin ?? '')}`;
}

export type PublicGalleryImage = {
  type: 'image';
  url: string;
  alt: string;
  forVariant: string | null;
  variantKeys: string[];
};

export type PublicGalleryVideo = {
  type: 'video';
  url: string;
  poster: string | null;
  alt: string;
};

export type PublicGalleryItem = PublicGalleryImage | PublicGalleryVideo;

export type PublicOptionValue = {
  value: string;
  image: string | null;
  inStock: boolean;
};

export type PublicOptionGroup = {
  name: string;
  values: PublicOptionValue[];
  hasImages: boolean;
};

export type PublicSku = {
  id: string;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  options: Record<string, string>;
};

export type PublicAttribute = {
  name: string;
  value: string;
  unit: string | null;
};

export type PublicCategoryRef = {
  id: string;
  name: string;
  slug: string;
  href: string;
};

export type PublicProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  mobileDetail: string | null;
  hasSizeChart: boolean;
  sizeChartImage: string | null;
  sizeChartDescription: string | null;
  aeRating: number | null;
  aeReviewCount: number | null;
  aeSalesCount: string | null;
  tags: string[];
  metaTitle: string | null;
  metaDescription: string | null;
  gallery: PublicGalleryItem[];
  optionGroups: PublicOptionGroup[];
  skus: PublicSku[];
  attributes: PublicAttribute[];
  category: PublicCategoryRef | null;
  breadcrumbs: PublicCategoryRef[];
};

export type MoreForYouPage = {
  items: PublicProductCard[];
  nextCursor: string | null;
};

export type LoadProductResult =
  | { ok: true; product: PublicProduct }
  | { ok: false; code: 'INVALID_SLUG' | 'NOT_FOUND' | 'INTERNAL' };

export type LoadMoreResult =
  | { ok: true; page: MoreForYouPage }
  | { ok: false; code: 'INVALID_SLUG' | 'NOT_FOUND' | 'INTERNAL' };

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  position: number;
};

type SkuPropertyPublic = {
  skuId: string;
  propertyName: string;
  value: string;
  image: string | null;
};

type SkuRowPublic = {
  id: string;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  images: ProductImage[];
  properties: SkuPropertyPublic[];
};

function clampInt(value: number, minValue: number, maxValue: number): number {
  if (!Number.isFinite(value)) return minValue;
  return Math.max(minValue, Math.min(maxValue, Math.floor(value)));
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

function trimToNull(value: unknown, max = 10_000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function isValidProductSlug(slug: string): boolean {
  if (!slug || slug.length > MAX_SLUG_LENGTH) return false;
  return SLUG_RE.test(slug);
}

function categoryHref(slug: string): string {
  return `/category/${slug}`;
}

function chunkArray<T>(items: T[], size = QUERY_CHUNK): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function sanitizeHtml(html: string | null | undefined): string | null {
  const raw = trimToNull(html, MAX_HTML_LENGTH);
  if (!raw) return null;
  let out = raw.replace(DANGEROUS_TAG_RE, '');
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(
    /(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi,
    '$1=$2$2'
  );
  out = out.trim();
  return out || null;
}

function urlKey(url: string): string {
  return url
    .trim()
    .split('#')[0]!
    .split('?')[0]!
    .replace(/\/+$/, '')
    .toLowerCase();
}

function imagePosition(img: ProductImage, fallback: number): number {
  return typeof img.position === 'number' && Number.isFinite(img.position)
    ? img.position
    : fallback;
}

function variantKeysOf(img: ProductImage): string[] {
  if (!Array.isArray(img.variantKeys)) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of img.variantKeys) {
    if (typeof key !== 'string') continue;
    const trimmed = key.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    keys.push(trimmed);
  }
  return keys;
}

function fullImages(images: ProductImage[] | null | undefined): ProductImage[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter((img) => img && typeof img.url === 'string' && img.url.trim())
    .filter((img) => img.isOp !== true)
    .sort((a, b) => imagePosition(a, 0) - imagePosition(b, 0));
}

function composeGalleryAlt(
  productName: string,
  forVariant: string | null,
  viewIndex: number
): string {
  const name = productName.trim() || 'Product';
  const color = forVariant?.trim() ?? '';
  const base = color ? `${name} in ${color}` : name;
  if (viewIndex <= 1) return base;
  return `${base}, view ${viewIndex}`;
}

function buildGallery(
  productName: string,
  productImages: ProductImage[],
  skuImages: ProductImage[][],
  videos: ProductVideo[],
  mainVideo: string | null,
  env: Env,
  options?: R2UrlOptions
): PublicGalleryItem[] {
  const collected: Array<{
    url: string;
    forVariant: string | null;
    variantKeys: string[];
    position: number;
    order: number;
  }> = [];
  const seen = new Set<string>();

  const pushImage = (img: ProductImage, fallbackPosition: number) => {
    const raw = img.url.trim();
    if (!raw) return;
    const key = urlKey(raw);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const forVariant = trimToNull(img.forVariant, 80);
    collected.push({
      url: resolveProductImageUrlForClient(raw, env, options) || raw,
      forVariant,
      variantKeys: variantKeysOf(img),
      position: imagePosition(img, fallbackPosition),
      order: collected.length,
    });
  };

  for (let i = 0; i < productImages.length; i++) {
    pushImage(productImages[i]!, i);
  }
  for (const sku of skuImages) {
    for (let i = 0; i < sku.length; i++) {
      pushImage(sku[i]!, collected.length + i);
    }
  }

  const groups = new Map<string, typeof collected>();
  const groupOrder: string[] = [];
  for (const item of collected) {
    const groupKey = (item.forVariant ?? '').toLowerCase();
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
      groupOrder.push(groupKey);
    }
    groups.get(groupKey)!.push(item);
  }

  const gallery: PublicGalleryItem[] = [];
  for (const groupKey of groupOrder) {
    const items = groups.get(groupKey) ?? [];
    items.sort((a, b) => a.position - b.position || a.order - b.order);
    items.forEach((item, index) => {
      gallery.push({
        type: 'image',
        url: item.url,
        alt: composeGalleryAlt(productName, item.forVariant, index + 1),
        forVariant: item.forVariant,
        variantKeys: item.variantKeys,
      });
    });
  }

  const seenVideo = new Set<string>();
  const pushVideo = (url: string, poster: string | null, alt: string | null) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    const key = urlKey(trimmed);
    if (!key || seenVideo.has(key)) return;
    seenVideo.add(key);
    const resolvedPoster = poster
      ? resolveProductImageUrlForClient(poster, env, options) || poster
      : null;
    gallery.push({
      type: 'video',
      url: trimmed,
      poster: resolvedPoster,
      alt: alt?.trim() || `${productName.trim() || 'Product'} video`,
    });
  };

  if (mainVideo) {
    const match = videos.find((v) => urlKey(v.url) === urlKey(mainVideo));
    pushVideo(mainVideo, match?.poster ?? null, match?.alt ?? null);
  }
  for (const video of videos) {
    if (!video || typeof video.url !== 'string') continue;
    pushVideo(video.url, video.poster ?? null, video.alt ?? null);
  }

  return gallery;
}

function buildOptionGroups(skus: SkuRowPublic[]): PublicOptionGroup[] {
  const nameOrder: string[] = [];
  for (const sku of skus) {
    for (const prop of sku.properties) {
      const name = prop.propertyName.trim();
      if (!name) continue;
      if (!nameOrder.includes(name)) nameOrder.push(name);
    }
  }

  const groups: PublicOptionGroup[] = [];
  for (const name of nameOrder) {
    const values = new Map<
      string,
      { image: string | null; inStock: boolean; order: number }
    >();
    for (const sku of skus) {
      const prop = sku.properties.find((p) => p.propertyName.trim() === name);
      if (!prop) continue;
      const value = prop.value.trim();
      if (!value) continue;
      const existing = values.get(value);
      const image = prop.image?.trim() || existing?.image || null;
      const inStock = (existing?.inStock ?? false) || sku.stock > 0;
      if (!existing) {
        values.set(value, { image, inStock, order: values.size });
      } else {
        values.set(value, {
          image,
          inStock,
          order: existing.order,
        });
      }
    }
    const list = [...values.entries()]
      .sort((a, b) => a[1].order - b[1].order)
      .map(([value, meta]) => ({
        value,
        image: meta.image,
        inStock: meta.inStock,
      }));
    if (list.length === 0) continue;
    groups.push({
      name,
      values: list,
      hasImages: list.some((v) => Boolean(v.image)),
    });
  }

  groups.sort((a, b) => Number(b.hasImages) - Number(a.hasImages));
  return groups;
}

function buildPublicSkus(skus: SkuRowPublic[]): PublicSku[] {
  return skus.map((sku) => {
    const options: Record<string, string> = {};
    for (const prop of sku.properties) {
      const name = prop.propertyName.trim();
      const value = prop.value.trim();
      if (!name || !value) continue;
      options[name] = value;
    }
    return {
      id: sku.id,
      price: sku.price,
      compareAtPrice: sku.compareAtPrice,
      stock: Math.max(0, sku.stock),
      options,
    };
  });
}

function categoryRef(row: CategoryRow): PublicCategoryRef {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    href: categoryHref(row.slug),
  };
}

function categoryDepth(
  id: string,
  byId: Map<string, CategoryRow>
): number {
  let depth = 0;
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current) && depth < MAX_CATEGORY_WALK) {
    seen.add(current);
    const row = byId.get(current);
    if (!row?.parentId) break;
    current = row.parentId;
    depth += 1;
  }
  return depth;
}

function walkToRoot(
  startId: string,
  byId: Map<string, CategoryRow>
): CategoryRow[] {
  const chain: CategoryRow[] = [];
  const seen = new Set<string>();
  let current: string | null = startId;
  let depth = 0;
  while (current && !seen.has(current) && depth < MAX_CATEGORY_WALK) {
    seen.add(current);
    const row = byId.get(current);
    if (!row) break;
    chain.push(row);
    current = row.parentId;
    depth += 1;
  }
  return chain;
}

function pickPrimaryCategoryId(
  productCategoryId: string | null,
  assigned: CategoryRow[],
  byId: Map<string, CategoryRow>
): string | null {
  if (assigned.length === 0) {
    return productCategoryId && byId.has(productCategoryId)
      ? productCategoryId
      : null;
  }
  let best = assigned[0]!;
  let bestDepth = categoryDepth(best.id, byId);
  for (let i = 1; i < assigned.length; i++) {
    const row = assigned[i]!;
    const depth = categoryDepth(row.id, byId);
    if (
      depth > bestDepth ||
      (depth === bestDepth &&
        (row.position < best.position ||
          (row.position === best.position && row.name.localeCompare(best.name) < 0)))
    ) {
      best = row;
      bestDepth = depth;
    }
  }
  return best.id;
}

function cursorClause(
  cursor: { position: number; id: string } | null
): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    gt(products.position, cursor.position),
    and(eq(products.position, cursor.position), gt(products.id, cursor.id))
  );
}

function categoryMembership(
  db: Database,
  categoryIds: string[]
) {
  if (categoryIds.length === 0) return undefined;
  const joinQuery =
    categoryIds.length === 1
      ? db
          .select({ id: productCategories.productId })
          .from(productCategories)
          .where(eq(productCategories.categoryId, categoryIds[0]!))
      : db
          .select({ id: productCategories.productId })
          .from(productCategories)
          .where(inArray(productCategories.categoryId, categoryIds));
  const legacy =
    categoryIds.length === 1
      ? eq(products.categoryId, categoryIds[0]!)
      : inArray(products.categoryId, categoryIds);
  return or(legacy, inArray(products.id, joinQuery));
}

export function encodeMoreCursor(
  level: number,
  position?: number,
  id?: string,
  served = 0
): string {
  if (position === undefined || !id) {
    return Buffer.from(`${level}:${Math.max(0, served)}`, 'utf8').toString(
      'base64'
    );
  }
  return Buffer.from(
    `${level}:${position}:${id}:${Math.max(0, served)}`,
    'utf8'
  ).toString('base64');
}

export function decodeMoreCursor(
  raw: string | null | undefined
): {
  level: number;
  position: number | null;
  id: string | null;
  served: number;
} | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const decoded = Buffer.from(raw.trim(), 'base64').toString('utf8');
    if (/^\d+$/.test(decoded)) {
      const level = Number.parseInt(decoded, 10);
      if (!Number.isFinite(level) || level < 0) return null;
      return { level, position: null, id: null, served: 0 };
    }
    const sep1 = decoded.indexOf(':');
    if (sep1 <= 0) return null;
    const sep2 = decoded.indexOf(':', sep1 + 1);
    if (sep2 === -1) {
      const level = Number.parseInt(decoded.slice(0, sep1), 10);
      const served = Number.parseInt(decoded.slice(sep1 + 1), 10);
      if (
        !Number.isFinite(level) ||
        level < 0 ||
        !Number.isFinite(served) ||
        served < 0
      ) {
        return null;
      }
      return { level, position: null, id: null, served };
    }
    if (sep2 <= sep1) return null;
    const sep3 = decoded.indexOf(':', sep2 + 1);
    const level = Number.parseInt(decoded.slice(0, sep1), 10);
    const position = Number.parseInt(decoded.slice(sep1 + 1, sep2), 10);
    const id = decoded.slice(sep2 + 1, sep3 === -1 ? undefined : sep3);
    const served = sep3 === -1 ? 0 : Number.parseInt(decoded.slice(sep3 + 1), 10);
    if (!Number.isFinite(level) || level < 0) return null;
    if (!Number.isFinite(position) || !isValidId(id)) return null;
    if (!Number.isFinite(served) || served < 0) return null;
    return { level, position, id, served };
  } catch {
    return null;
  }
}

async function loadAllCategories(db: Database): Promise<Map<string, CategoryRow>> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      parentId: categories.parentId,
      position: categories.position,
    })
    .from(categories);
  const map = new Map<string, CategoryRow>();
  for (const row of rows) map.set(row.id, row);
  return map;
}

async function loadAssignedCategories(
  db: Database,
  productId: string,
  productCategoryId: string | null,
  byId: Map<string, CategoryRow>
): Promise<CategoryRow[]> {
  const joinRows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      parentId: categories.parentId,
      position: categories.position,
    })
    .from(productCategories)
    .innerJoin(categories, eq(productCategories.categoryId, categories.id))
    .where(eq(productCategories.productId, productId))
    .orderBy(asc(categories.position), asc(categories.name));

  const seen = new Set<string>();
  const assigned: CategoryRow[] = [];
  for (const row of joinRows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    assigned.push(row);
  }
  if (productCategoryId && !seen.has(productCategoryId)) {
    const extra = byId.get(productCategoryId);
    if (extra) assigned.push(extra);
  }
  return assigned;
}

async function loadNested(
  db: Database,
  productId: string,
  env: Env,
  options?: R2UrlOptions
): Promise<{ skus: SkuRowPublic[]; attributes: PublicAttribute[] }> {
  const [skuRows, attributeRows] = await Promise.all([
    db
      .select({
        id: productSkus.id,
        price: productSkus.price,
        compareAtPrice: productSkus.compareAtPrice,
        stock: productSkus.stock,
        images: productSkus.images,
      })
      .from(productSkus)
      .where(eq(productSkus.productId, productId)),
    db
      .select({
        attrName: productAttributes.attrName,
        attrValue: productAttributes.attrValue,
        attrValueUnit: productAttributes.attrValueUnit,
        position: productAttributes.position,
      })
      .from(productAttributes)
      .where(eq(productAttributes.productId, productId))
      .orderBy(asc(productAttributes.position), asc(productAttributes.attrName)),
  ]);

  const skuIds = skuRows.map((row) => row.id);
  const propertyRows: SkuPropertyPublic[] = [];
  for (const chunk of chunkArray(skuIds)) {
    const rows = await db
      .select({
        skuId: skuProperties.skuId,
        propertyName: skuProperties.propertyName,
        value: skuProperties.value,
        image: skuProperties.image,
      })
      .from(skuProperties)
      .where(inArray(skuProperties.skuId, chunk));
    propertyRows.push(...rows);
  }

  const propsBySku = new Map<string, SkuPropertyPublic[]>();
  for (const prop of propertyRows) {
    const image = prop.image
      ? resolveProductImageUrlForClient(prop.image, env, options) || prop.image
      : null;
    const cleaned: SkuPropertyPublic = {
      skuId: prop.skuId,
      propertyName: prop.propertyName,
      value: prop.value,
      image,
    };
    const list = propsBySku.get(prop.skuId) ?? [];
    list.push(cleaned);
    propsBySku.set(prop.skuId, list);
  }

  const skus: SkuRowPublic[] = skuRows.map((row) => {
    const price = toPrice(row.price) ?? 0;
    return {
      id: row.id,
      price,
      compareAtPrice: toPrice(row.compareAtPrice),
      stock: Math.max(0, toFiniteNumber(row.stock) ?? 0),
      images: resolveProductImagesForClient(
        fullImages(row.images ?? []),
        env,
        options
      ),
      properties: propsBySku.get(row.id) ?? [],
    };
  });

  const attributes: PublicAttribute[] = [];
  for (const row of attributeRows) {
    const name = trimToNull(row.attrName, 120);
    const value = trimToNull(row.attrValue, 500);
    if (!name || !value) continue;
    attributes.push({
      name,
      value,
      unit: trimToNull(row.attrValueUnit, 40),
    });
  }

  return { skus, attributes };
}

function publicTags(raw: string[] | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of raw) {
    const trimmed = trimToNull(tag, 64);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 40) break;
  }
  return out;
}

export async function loadPublicProduct(
  db: Database,
  slug: string,
  env: Env,
  origin?: string
): Promise<LoadProductResult> {
  const cleaned = slug.trim().toLowerCase();
  if (!isValidProductSlug(cleaned)) {
    return { ok: false, code: 'INVALID_SLUG' };
  }

  try {
    const options: R2UrlOptions | undefined = origin ? { origin } : undefined;
    const [row] = await db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        description: products.description,
        mobileDetail: products.mobileDetail,
        hasSizeChart: products.hasSizeChart,
        sizeChartImage: products.sizeChartImage,
        sizeChartDescription: products.sizeChartDescription,
        aeRating: products.aeRating,
        aeReviewCount: products.aeReviewCount,
        aeSalesCount: products.aeSalesCount,
        images: products.images,
        videos: products.videos,
        mainVideo: products.mainVideo,
        categoryId: products.categoryId,
        tags: products.tags,
        metaTitle: products.metaTitle,
        metaDescription: products.metaDescription,
      })
      .from(products)
      .where(and(eq(products.slug, cleaned), eq(products.published, true)))
      .limit(1);

    if (!row) return { ok: false, code: 'NOT_FOUND' };

    const [byId, nested] = await Promise.all([
      loadAllCategories(db),
      loadNested(db, row.id, env, options),
    ]);
    const assigned = await loadAssignedCategories(
      db,
      row.id,
      row.categoryId,
      byId
    );
    const primaryId = pickPrimaryCategoryId(row.categoryId, assigned, byId);
    const chain = primaryId ? walkToRoot(primaryId, byId) : [];
    const leaf = chain[0] ?? null;
    const breadcrumbs = [...chain].reverse().map(categoryRef);

    const productImages = resolveProductImagesForClient(
      fullImages(row.images ?? []),
      env,
      options
    );
    const gallery = buildGallery(
      row.name,
      productImages,
      nested.skus.map((sku) => sku.images),
      Array.isArray(row.videos) ? row.videos : [],
      row.mainVideo,
      env,
      options
    );

    const sizeChartImage = row.hasSizeChart
      ? row.sizeChartImage
        ? resolveProductImageUrlForClient(row.sizeChartImage, env, options) ||
          row.sizeChartImage
        : null
      : null;

    const product: PublicProduct = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: sanitizeHtml(row.description),
      mobileDetail: sanitizeHtml(row.mobileDetail),
      hasSizeChart: Boolean(row.hasSizeChart) && Boolean(sizeChartImage || row.sizeChartDescription),
      sizeChartImage,
      sizeChartDescription: row.hasSizeChart
        ? trimToNull(row.sizeChartDescription, 4000)
        : null,
      aeRating: toRating(row.aeRating),
      aeReviewCount: toReviewCount(row.aeReviewCount),
      aeSalesCount: trimToNull(row.aeSalesCount, 64),
      tags: publicTags(row.tags),
      metaTitle: trimToNull(row.metaTitle, 120),
      metaDescription: trimToNull(row.metaDescription, 320),
      gallery,
      optionGroups: buildOptionGroups(nested.skus),
      skus: buildPublicSkus(nested.skus),
      attributes: nested.attributes,
      category: leaf ? categoryRef(leaf) : null,
      breadcrumbs,
    };

    return { ok: true, product };
  } catch (error) {
    console.error('loadPublicProduct failed:', error);
    return { ok: false, code: 'INTERNAL' };
  }
}

/**
 * Resolve a public product through KV. The cache key includes the request
 * origin because serialized image URLs are origin-dependent.
 */
export async function getPublicProduct(
  db: Database,
  kv: KVNamespace,
  slug: string,
  env: Env,
  origin?: string
): Promise<LoadProductResult> {
  const manager = kvManager(kv);
  let version = '1';

  try {
    version = (await manager.get(PRODUCT_CACHE_VERSION_KEY)) ?? version;
    const cached = await manager.getJson<LoadProductResult>(
      productCacheKey(version, slug, origin)
    );
    if (
      cached?.ok === true &&
      cached.product &&
      typeof cached.product === 'object'
    ) {
      return cached;
    }
  } catch (error) {
    console.error('Failed to read product from KV:', error);
  }

  const result = await loadPublicProduct(db, slug, env, origin);
  if (!result.ok) return result;

  try {
    await manager.setJson(
      productCacheKey(version, slug.trim().toLowerCase(), origin),
      result,
      { expirationTtl: PRODUCT_CACHE_TTL_SECONDS }
    );
  } catch (error) {
    console.error('Failed to write product to KV:', error);
  }

  return result;
}

/**
 * Version-bust all public product entries. Old entries expire naturally,
 * avoiding an unbounded KV list/delete operation.
 */
export async function invalidatePublicProductCache(
  kv: KVNamespace
): Promise<void> {
  try {
    await kvManager(kv).set(PRODUCT_CACHE_VERSION_KEY, crypto.randomUUID());
  } catch (error) {
    console.error('Failed to invalidate product KV cache:', error);
  }
}

async function queryMoreLevel(
  db: Database,
  args: {
    level: number;
    chain: CategoryRow[];
    excludeProductId: string;
    inner: { position: number; id: string } | null;
    limit: number;
  }
): Promise<ProductCardRow[]> {
  const take = Math.max(1, args.limit);
  const chainIds = args.chain.map((c) => c.id);
  const isGlobal =
    args.chain.length === 0 || args.level >= args.chain.length;

  const filters: SQL[] = [
    eq(products.published, true),
    ne(products.id, args.excludeProductId),
  ];

  const inner = cursorClause(args.inner);
  if (inner) filters.push(inner);

  if (isGlobal) {
    const inChain = categoryMembership(db, chainIds);
    if (inChain) filters.push(not(inChain));
  } else {
    const cat = args.chain[args.level];
    if (!cat) return [];
    const thisCat = categoryMembership(db, [cat.id]);
    if (thisCat) filters.push(thisCat);
    const prevIds = chainIds.slice(0, args.level);
    const prev = categoryMembership(db, prevIds);
    if (prev) filters.push(not(prev));
  }

  return db
    .select(PRODUCT_CARD_COLUMNS)
    .from(products)
    .where(and(...filters))
    .orderBy(asc(products.position), asc(products.id))
    .limit(take);
}

export async function loadMoreForYou(
  db: Database,
  slug: string,
  cursor: string | null | undefined,
  pageSize: number | null | undefined,
  env: Env,
  origin?: string
): Promise<LoadMoreResult> {
  const cleaned = slug.trim().toLowerCase();
  if (!isValidProductSlug(cleaned)) {
    return { ok: false, code: 'INVALID_SLUG' };
  }

  try {
    const take = clampInt(
      typeof pageSize === 'number' && Number.isFinite(pageSize)
        ? pageSize
        : DEFAULT_FEED_PAGE_SIZE,
      MIN_FEED_PAGE_SIZE,
      MAX_FEED_PAGE_SIZE
    );

    const [row] = await db
      .select({
        id: products.id,
        categoryId: products.categoryId,
      })
      .from(products)
      .where(and(eq(products.slug, cleaned), eq(products.published, true)))
      .limit(1);
    if (!row) return { ok: false, code: 'NOT_FOUND' };

    const byId = await loadAllCategories(db);
    const assigned = await loadAssignedCategories(
      db,
      row.id,
      row.categoryId,
      byId
    );
    const primaryId = pickPrimaryCategoryId(row.categoryId, assigned, byId);
    const chain = primaryId ? walkToRoot(primaryId, byId) : [];
    const maxLevel = chain.length === 0 ? 0 : chain.length;

    const decoded = decodeMoreCursor(cursor);
    const served = Math.min(
      MAX_MORE_FOR_YOU_ITEMS,
      Math.max(0, decoded?.served ?? 0)
    );
    if (served >= MAX_MORE_FOR_YOU_ITEMS) {
      return { ok: true, page: { items: [], nextCursor: null } };
    }
    const remaining = Math.min(take, MAX_MORE_FOR_YOU_ITEMS - served);
    let level = decoded?.level ?? 0;
    if (level < 0) level = 0;
    let inner: { position: number; id: string } | null =
      decoded?.position !== null &&
      decoded?.position !== undefined &&
      decoded.id
        ? { position: decoded.position, id: decoded.id }
        : null;

    const collected: ProductCardRow[] = [];
    let nextCursor: string | null = null;

    while (collected.length < remaining && level <= maxLevel) {
      const need = remaining - collected.length + 1;
      const rows = await queryMoreLevel(db, {
        level,
        chain,
        excludeProductId: row.id,
        inner,
        limit: need,
      });
      const room = remaining - collected.length;
      const used = rows.slice(0, room);
      collected.push(...used);

      if (rows.length > room) {
        const last = used[used.length - 1];
        if (last) {
          nextCursor = encodeMoreCursor(
            level,
            last.position,
            last.id,
            served + collected.length
          );
        }
        break;
      }

      level += 1;
      inner = null;
    }

    if (!nextCursor && level <= maxLevel) {
      nextCursor = encodeMoreCursor(
        level,
        undefined,
        undefined,
        served + collected.length
      );
    }

    const items = await hydrateProductCards(db, collected, env, {
      origin,
    });

    return {
      ok: true,
      page: { items, nextCursor },
    };
  } catch (error) {
    console.error('loadMoreForYou failed:', error);
    return { ok: false, code: 'INTERNAL' };
  }
}
