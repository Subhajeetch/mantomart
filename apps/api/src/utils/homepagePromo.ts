import { and, asc, eq, inArray, like, min, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  isPromoLinkKind,
  isPromoSlideLayout,
  isPromoSlideTheme,
  products,
  productSkus,
  PROMO_SLIDE_LAYOUT_META,
  type Category,
  type Database,
  type HomepageBlockConfig,
  type ProductImage,
  type PromoLinkConfig,
  type PromoSlideConfigItem,
  type PromoSlideLayout,
  type PromoSlideOffer,
  type PromoSlideProductSlot,
  type PromoSliderConfig,
  type PromoSlideTheme,
} from '@repo/db';
import type Env from '@/types/env';
import { productCardImagesForClient } from '@/utils/productImageHost';
import type { R2UrlOptions } from '@/utils/r2';

export type PublicProductCardImage = {
  url: string;
  alt: string;
  position?: number;
  /** isOptimised — smaller card-sized copy hosted alongside the full image. */
  isOp?: boolean;
  /** Full-quality image URL paired with an optimized card image. */
  fullUrl?: string;
};

type PublicProductCard = {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  imageAlt: string | null;
  images: PublicProductCardImage[];
  price: number | null;
  compareAtPrice: number | null;
  onSale: boolean;
  href: string;
};

type SanitizeConfigResult =
  | { ok: true; config: HomepageBlockConfig }
  | { ok: false; error: string; code: string };

const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 120;
const MAX_SUBTITLE_LENGTH = 240;
const MAX_CTA_LABEL_LENGTH = 40;
const MAX_DISCOUNT_LABEL_LENGTH = 40;
const MAX_KICKER_LENGTH = 80;
const MAX_GRAPHIC_TITLE_LENGTH = 80;
const MAX_GRAPHIC_SUBTITLE_LENGTH = 80;
const MAX_OFFER_CODE_LENGTH = 32;
const MAX_NAME_LENGTH = 200;
const MAX_SLUG_LENGTH = 180;
const MAX_URL_LENGTH = 2048;

function isValidId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function isAllowedImageUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  if (url.startsWith('/api/images/')) return true;
  return /^https?:\/\//i.test(url);
}

function isAllowedHref(url: string): boolean {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  if (url.startsWith('/')) return true;
  return /^https?:\/\//i.test(url);
}
const MAX_PRODUCTS_PER_SLIDE = 4;
const MAX_OFFERS_PER_SLIDE = 3;
const MAX_SEARCH_RESULTS = 8;
const MAX_SEARCH_LENGTH = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

function toPrice(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

function sanitizeEndsAt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const time = Date.parse(trimmed);
  if (!Number.isFinite(time)) return undefined;
  return new Date(time).toISOString();
}

function pushId(target: string[], value: unknown) {
  if (typeof value !== 'string') return;
  const id = value.trim();
  if (isValidId(id)) target.push(id);
}

/**
 * Collect product ids referenced by a raw promo_slider config (slots + links).
 */
export function collectPromoProductIds(raw: unknown): string[] {
  if (!isRecord(raw) || !Array.isArray(raw.slides)) return [];
  const ids: string[] = [];
  for (const entry of raw.slides) {
    if (!isRecord(entry)) continue;
    collectLinkProductId(ids, entry.slideLink);
    collectLinkProductId(ids, entry.titleLink);
    if (Array.isArray(entry.products)) {
      for (const slot of entry.products) {
        if (!isRecord(slot)) continue;
        pushId(ids, slot.productId);
        collectLinkProductId(ids, slot.link);
      }
    }
    if (Array.isArray(entry.offers)) {
      for (const offer of entry.offers) {
        if (!isRecord(offer)) continue;
        collectLinkProductId(ids, offer.link);
      }
    }
  }
  return [...new Set(ids)];
}

function collectLinkProductId(ids: string[], raw: unknown) {
  if (!isRecord(raw)) return;
  if (raw.kind === 'product') pushId(ids, raw.productId);
}

export async function loadExistingProductIdSet(
  db: Database,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const unique = [...new Set(ids.filter((id) => isValidId(id)))];
  if (unique.length === 0) return new Set();
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.id, unique));
  return new Set(rows.map((row) => row.id));
}

function sanitizeLink(
  raw: unknown,
  knownCategoryIds?: Set<string>,
  knownProductIds?: Set<string>
):
  | { ok: true; link?: PromoLinkConfig }
  | { ok: false; error: string; code: string } {
  if (raw === undefined || raw === null) return { ok: true };
  if (!isRecord(raw)) {
    return {
      ok: false,
      error: 'Each link must be an object.',
      code: 'INVALID_LINK',
    };
  }
  if (!isPromoLinkKind(raw.kind)) {
    return {
      ok: false,
      error: 'Link kind must be product, category, or custom.',
      code: 'INVALID_LINK',
    };
  }

  if (raw.kind === 'product') {
    const productId =
      typeof raw.productId === 'string' ? raw.productId.trim() : '';
    if (!isValidId(productId)) {
      return {
        ok: false,
        error: 'A product link needs a valid product.',
        code: 'INVALID_LINK_PRODUCT',
      };
    }
    if (knownProductIds && !knownProductIds.has(productId)) {
      return { ok: true };
    }
    const link: PromoLinkConfig = { kind: 'product', productId };
    const productName = asTrimmedString(raw.productName, MAX_NAME_LENGTH);
    if (productName) link.productName = productName;
    const productSlug = asTrimmedString(raw.productSlug, MAX_SLUG_LENGTH);
    if (productSlug) link.productSlug = productSlug;
    return { ok: true, link };
  }

  if (raw.kind === 'category') {
    const categoryId =
      typeof raw.categoryId === 'string' ? raw.categoryId.trim() : '';
    if (!isValidId(categoryId)) {
      return {
        ok: false,
        error: 'A category link needs a valid category.',
        code: 'INVALID_LINK_CATEGORY',
      };
    }
    if (knownCategoryIds && !knownCategoryIds.has(categoryId)) {
      return { ok: true };
    }
    const link: PromoLinkConfig = { kind: 'category', categoryId };
    const categoryName = asTrimmedString(raw.categoryName, MAX_NAME_LENGTH);
    if (categoryName) link.categoryName = categoryName;
    const categorySlug = asTrimmedString(raw.categorySlug, MAX_SLUG_LENGTH);
    if (categorySlug) link.categorySlug = categorySlug;
    return { ok: true, link };
  }

  const href = sanitizeOptionalUrl(raw.href, 'href');
  if (!href) {
    return {
      ok: false,
      error: 'A custom link needs a valid URL or path.',
      code: 'INVALID_LINK_HREF',
    };
  }
  return { ok: true, link: { kind: 'custom', href } };
}

export function sanitizePromoSliderConfig(
  body: Record<string, unknown>,
  maxSlides: number,
  knownCategoryIds?: Set<string>,
  knownProductIds?: Set<string>
): SanitizeConfigResult {
  if (body.slides !== undefined && !Array.isArray(body.slides)) {
    return {
      ok: false,
      error: 'Slider slides must be an array.',
      code: 'INVALID_SLIDES',
    };
  }
  const slidesRaw = Array.isArray(body.slides) ? body.slides : [];
  if (slidesRaw.length > maxSlides) {
    return {
      ok: false,
      error: `A slider can have at most ${maxSlides} slides.`,
      code: 'MAX_SLIDES',
    };
  }

  const slides: PromoSlideConfigItem[] = [];
  const seen = new Set<string>();

  for (const entry of slidesRaw) {
    if (!isRecord(entry)) {
      return {
        ok: false,
        error: 'Each slide must be an object.',
        code: 'INVALID_SLIDE',
      };
    }

    let id =
      typeof entry.id === 'string' && isValidId(entry.id.trim())
        ? entry.id.trim()
        : nanoid();
    if (seen.has(id)) id = nanoid();
    seen.add(id);

    const audience =
      entry.audience === 'new_user' || entry.audience === 'all'
        ? entry.audience
        : 'all';

    const imageUrl = sanitizeOptionalUrl(entry.imageUrl, 'image');
    const layoutRaw = entry.layout;
    const hasLayout = isPromoSlideLayout(layoutRaw);
    const isLegacy =
      layoutRaw === 'legacy' || (!hasLayout && Boolean(imageUrl));

    if (!hasLayout && !isLegacy) {
      return {
        ok: false,
        error:
          'Each slide needs a layout (deals banner, welcome deal, split products, flash row, or stack showcase).',
        code: 'INVALID_SLIDE_LAYOUT',
      };
    }

    if (isLegacy) {
      if (!imageUrl) {
        return {
          ok: false,
          error:
            'A classic image slide needs a valid image URL (http(s) or /api/images/…).',
          code: 'INVALID_IMAGE_URL',
        };
      }
      const slide: PromoSlideConfigItem = {
        id,
        layout: 'legacy',
        audience,
        imageUrl,
      };
      const mobile = sanitizeOptionalUrl(entry.mobileImageUrl, 'image');
      if (mobile) slide.mobileImageUrl = mobile;
      const title = asTrimmedString(entry.title, MAX_TITLE_LENGTH);
      if (title) slide.title = title;
      const subtitle = asTrimmedString(entry.subtitle, MAX_SUBTITLE_LENGTH);
      if (subtitle) slide.subtitle = subtitle;
      const ctaLabel = asTrimmedString(entry.ctaLabel, MAX_CTA_LABEL_LENGTH);
      if (ctaLabel) slide.ctaLabel = ctaLabel;
      const ctaHref = sanitizeOptionalUrl(entry.ctaHref, 'href');
      if (ctaHref) slide.ctaHref = ctaHref;
      const discountLabel = asTrimmedString(
        entry.discountLabel,
        MAX_DISCOUNT_LABEL_LENGTH
      );
      if (discountLabel) slide.discountLabel = discountLabel;
      slides.push(slide);
      continue;
    }

    const layout = layoutRaw as PromoSlideLayout;
    const meta = PROMO_SLIDE_LAYOUT_META[layout];
    const theme: PromoSlideTheme = isPromoSlideTheme(entry.theme)
      ? entry.theme
      : 'primary';

    const slide: PromoSlideConfigItem = {
      id,
      layout,
      audience,
      theme,
    };

    const kicker = asTrimmedString(entry.kicker, MAX_KICKER_LENGTH);
    if (kicker) slide.kicker = kicker;
    const title = asTrimmedString(entry.title, MAX_TITLE_LENGTH);
    if (title) slide.title = title;
    const subtitle = asTrimmedString(entry.subtitle, MAX_SUBTITLE_LENGTH);
    if (subtitle) slide.subtitle = subtitle;
    const ctaLabel = asTrimmedString(entry.ctaLabel, MAX_CTA_LABEL_LENGTH);
    if (ctaLabel) slide.ctaLabel = ctaLabel;
    const endsAt = sanitizeEndsAt(entry.endsAt);
    if (endsAt) slide.endsAt = endsAt;
    if (meta.hasGraphic) {
      const graphicTitle = asTrimmedString(
        entry.graphicTitle,
        MAX_GRAPHIC_TITLE_LENGTH
      );
      if (graphicTitle) slide.graphicTitle = graphicTitle;
      const graphicSubtitle = asTrimmedString(
        entry.graphicSubtitle,
        MAX_GRAPHIC_SUBTITLE_LENGTH
      );
      if (graphicSubtitle) slide.graphicSubtitle = graphicSubtitle;
    }

    const slideLinkResult = sanitizeLink(
      entry.slideLink,
      knownCategoryIds,
      knownProductIds
    );
    if (!slideLinkResult.ok) return slideLinkResult;
    if (slideLinkResult.link) slide.slideLink = slideLinkResult.link;

    const titleLinkResult = sanitizeLink(
      entry.titleLink,
      knownCategoryIds,
      knownProductIds
    );
    if (!titleLinkResult.ok) return titleLinkResult;
    if (titleLinkResult.link) slide.titleLink = titleLinkResult.link;

    const productsRaw = Array.isArray(entry.products) ? entry.products : [];
    if (productsRaw.length > MAX_PRODUCTS_PER_SLIDE) {
      return {
        ok: false,
        error: `A slide can have at most ${MAX_PRODUCTS_PER_SLIDE} products.`,
        code: 'MAX_SLIDE_PRODUCTS',
      };
    }
    const productSlots: PromoSlideProductSlot[] = [];
    const seenSlots = new Set<string>();
    for (const slotRaw of productsRaw.slice(0, meta.productSlots)) {
      if (!isRecord(slotRaw)) {
        return {
          ok: false,
          error: 'Each slide product must be an object.',
          code: 'INVALID_SLIDE_PRODUCT',
        };
      }
      const productId =
        typeof slotRaw.productId === 'string' ? slotRaw.productId.trim() : '';
      if (!isValidId(productId)) {
        return {
          ok: false,
          error: 'Each slide product needs a valid product.',
          code: 'INVALID_SLIDE_PRODUCT',
        };
      }
      if (knownProductIds && !knownProductIds.has(productId)) {
        continue;
      }
      let slotId =
        typeof slotRaw.id === 'string' && isValidId(slotRaw.id.trim())
          ? slotRaw.id.trim()
          : nanoid();
      if (seenSlots.has(slotId)) slotId = nanoid();
      seenSlots.add(slotId);

      const slot: PromoSlideProductSlot = { id: slotId, productId };
      const name = asTrimmedString(slotRaw.name, MAX_NAME_LENGTH);
      if (name) slot.name = name;
      const slug = asTrimmedString(slotRaw.slug, MAX_SLUG_LENGTH);
      if (slug) slot.slug = slug;
      const imageUrlSlot = sanitizeOptionalUrl(slotRaw.imageUrl, 'image');
      if (imageUrlSlot) slot.imageUrl = imageUrlSlot;
      const imageAlt = asTrimmedString(slotRaw.imageAlt, MAX_TITLE_LENGTH);
      if (imageAlt) slot.imageAlt = imageAlt;
      const price = toPrice(slotRaw.price);
      if (price !== undefined) slot.price = price;
      const compareAtPrice = toPrice(slotRaw.compareAtPrice);
      if (compareAtPrice !== undefined) slot.compareAtPrice = compareAtPrice;
      const discountLabel = asTrimmedString(
        slotRaw.discountLabel,
        MAX_DISCOUNT_LABEL_LENGTH
      );
      if (discountLabel) slot.discountLabel = discountLabel;
      const salePriceCents = toPrice(slotRaw.salePriceCents);
      if (salePriceCents !== undefined) slot.salePriceCents = salePriceCents;
      const compareAtOverrideCents = toPrice(slotRaw.compareAtOverrideCents);
      if (compareAtOverrideCents !== undefined) {
        slot.compareAtOverrideCents = compareAtOverrideCents;
      }
      const slotLink = sanitizeLink(
        slotRaw.link,
        knownCategoryIds,
        knownProductIds
      );
      if (!slotLink.ok) return slotLink;
      if (slotLink.link) slot.link = slotLink.link;
      productSlots.push(slot);
    }
    if (productSlots.length > 0) slide.products = productSlots;

    if (meta.offerSlots > 0) {
      const offersRaw = Array.isArray(entry.offers) ? entry.offers : [];
      if (offersRaw.length > MAX_OFFERS_PER_SLIDE) {
        return {
          ok: false,
          error: `A slide can have at most ${MAX_OFFERS_PER_SLIDE} offers.`,
          code: 'MAX_SLIDE_OFFERS',
        };
      }
      const offers: PromoSlideOffer[] = [];
      const seenOffers = new Set<string>();
      for (const offerRaw of offersRaw.slice(0, meta.offerSlots)) {
        if (!isRecord(offerRaw)) {
          return {
            ok: false,
            error: 'Each offer must be an object.',
            code: 'INVALID_SLIDE_OFFER',
          };
        }
        const offerTitle = asTrimmedString(offerRaw.title, MAX_TITLE_LENGTH);
        if (!offerTitle) continue;
        let offerId =
          typeof offerRaw.id === 'string' && isValidId(offerRaw.id.trim())
            ? offerRaw.id.trim()
            : nanoid();
        if (seenOffers.has(offerId)) offerId = nanoid();
        seenOffers.add(offerId);
        const offer: PromoSlideOffer = { id: offerId, title: offerTitle };
        const offerSubtitle = asTrimmedString(
          offerRaw.subtitle,
          MAX_SUBTITLE_LENGTH
        );
        if (offerSubtitle) offer.subtitle = offerSubtitle;
        const code = asTrimmedString(offerRaw.code, MAX_OFFER_CODE_LENGTH);
        if (code) offer.code = code;
        const offerLink = sanitizeLink(
          offerRaw.link,
          knownCategoryIds,
          knownProductIds
        );
        if (!offerLink.ok) return offerLink;
        if (offerLink.link) offer.link = offerLink.link;
        offers.push(offer);
      }
      if (offers.length > 0) slide.offers = offers;
    }

    slides.push(slide);
  }

  const config: PromoSliderConfig = { type: 'promo_slider', slides };
  return { ok: true, config };
}

export type PublicPromoSlideProduct = {
  id: string;
  href: string;
  name: string;
  imageUrl: string | null;
  imageAlt: string | null;
  images?: PublicProductCardImage[];
  price: number | null;
  compareAtPrice: number | null;
  onSale: boolean;
  discountLabel?: string;
};

export type PublicPromoSlideOffer = {
  id: string;
  title: string;
  subtitle?: string;
  code?: string;
  href?: string;
};

export type PublicPromoSlide = {
  id: string;
  layout: PromoSlideLayout | 'legacy';
  audience: 'all' | 'new_user';
  theme: PromoSlideTheme;
  kicker?: string;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  endsAt?: string;
  graphicTitle?: string;
  graphicSubtitle?: string;
  slideHref?: string;
  titleHref?: string;
  products: PublicPromoSlideProduct[];
  offers: PublicPromoSlideOffer[];
  imageUrl?: string;
  mobileImageUrl?: string;
  ctaHref?: string;
  discountLabel?: string;
};

function resolveLinkHref(
  link: PromoLinkConfig | undefined,
  productsById: Map<string, PublicProductCard>,
  categoriesById: Map<string, Category>
): string | undefined {
  if (!link) return undefined;
  if (link.kind === 'custom') {
    return link.href && isAllowedHref(link.href) ? link.href : undefined;
  }
  if (link.kind === 'product') {
    if (!link.productId) return undefined;
    const product = productsById.get(link.productId);
    if (product) return product.href;
    if (link.productSlug) return productHref(link.productSlug);
    return undefined;
  }
  if (!link.categoryId) return undefined;
  const category = categoriesById.get(link.categoryId);
  if (category) return categoryHref(category.slug);
  if (link.categorySlug) return categoryHref(link.categorySlug);
  return undefined;
}

export async function loadPublishedProductCardsByIds(
  db: Database,
  ids: string[],
  env: Env,
  options?: R2UrlOptions
): Promise<Map<string, PublicProductCard>> {
  const unique = [...new Set(ids.filter((id) => isValidId(id)))];
  const map = new Map<string, PublicProductCard>();
  if (unique.length === 0) return map;

  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      images: products.images,
    })
    .from(products)
    .where(and(eq(products.published, true), inArray(products.id, unique)));

  if (rows.length === 0) return map;

  const productIds = rows.map((row) => row.id);
  const skuRows = await db
    .select({
      productId: productSkus.productId,
      price: productSkus.price,
      compareAtPrice: productSkus.compareAtPrice,
    })
    .from(productSkus)
    .where(inArray(productSkus.productId, productIds));

  const bestByProduct = new Map<
    string,
    { price: number; compareAtPrice: number | null }
  >();
  for (const sku of skuRows) {
    const price =
      typeof sku.price === 'number' && Number.isFinite(sku.price)
        ? sku.price
        : Number(sku.price);
    if (!Number.isFinite(price)) continue;
    const compare =
      sku.compareAtPrice === null || sku.compareAtPrice === undefined
        ? null
        : typeof sku.compareAtPrice === 'number'
          ? sku.compareAtPrice
          : Number(sku.compareAtPrice);
    const current = bestByProduct.get(sku.productId);
    if (!current || price < current.price) {
      bestByProduct.set(sku.productId, {
        price,
        compareAtPrice:
          compare !== null && Number.isFinite(compare) ? compare : null,
      });
    }
  }

  for (const row of rows) {
    const images = productCardImagesForClient(row.images, env, options);
    const img = images[0] ?? null;
    const pricing = bestByProduct.get(row.id);
    const price = pricing?.price ?? null;
    const compareAtPrice = pricing?.compareAtPrice ?? null;
    const onSale =
      price !== null && compareAtPrice !== null && compareAtPrice > price;
    map.set(row.id, {
      id: row.id,
      slug: row.slug,
      name: row.name,
      imageUrl: img?.url ?? null,
      imageAlt: img?.alt ?? null,
      images,
      price,
      compareAtPrice,
      onSale,
      href: productHref(row.slug),
    });
  }
  return map;
}

function publicProductFromSlot(
  slot: PromoSlideProductSlot,
  live: PublicProductCard | undefined,
  href: string
): PublicPromoSlideProduct | null {
  const name = live?.name || slot.name;
  if (!name) return null;
  const price =
    slot.salePriceCents !== undefined
      ? slot.salePriceCents
      : (live?.price ?? slot.price ?? null);
  const compareAtPrice =
    slot.compareAtOverrideCents !== undefined
      ? slot.compareAtOverrideCents
      : (live?.compareAtPrice ?? slot.compareAtPrice ?? null);
  const onSale =
    price !== null && compareAtPrice !== null && compareAtPrice > price;
  return {
    id: slot.id,
    href,
    name,
    imageUrl: live?.imageUrl ?? slot.imageUrl ?? null,
    imageAlt: live?.imageAlt ?? slot.imageAlt ?? null,
    images: live?.images,
    price,
    compareAtPrice: onSale ? compareAtPrice : compareAtPrice,
    onSale,
    discountLabel: slot.discountLabel,
  };
}

export async function serializePublicPromoSlides(
  db: Database,
  config: PromoSliderConfig,
  categoriesById: Map<string, Category>,
  env: Env,
  options?: R2UrlOptions
): Promise<PublicPromoSlide[]> {
  const productIds = collectPromoProductIds(config);
  let productsById = new Map<string, PublicProductCard>();
  try {
    productsById = await loadPublishedProductCardsByIds(
      db,
      productIds,
      env,
      options
    );
  } catch (error) {
    console.warn('Failed to hydrate promo slider products:', error);
  }

  const slides: PublicPromoSlide[] = [];
  for (const raw of config.slides) {
    if (raw.layout === 'legacy') {
      if (!raw.imageUrl) continue;
      const slide: PublicPromoSlide = {
        id: raw.id,
        layout: 'legacy',
        audience: raw.audience,
        theme: 'primary',
        products: [],
        offers: [],
        imageUrl: raw.imageUrl,
      };
      if (raw.mobileImageUrl) slide.mobileImageUrl = raw.mobileImageUrl;
      if (raw.title) slide.title = raw.title;
      if (raw.subtitle) slide.subtitle = raw.subtitle;
      if (raw.ctaLabel) slide.ctaLabel = raw.ctaLabel;
      if (raw.ctaHref) {
        slide.ctaHref = raw.ctaHref;
        slide.slideHref = raw.ctaHref;
        slide.titleHref = raw.ctaHref;
      }
      if (raw.discountLabel) slide.discountLabel = raw.discountLabel;
      slides.push(slide);
      continue;
    }

    if (!isPromoSlideLayout(raw.layout)) continue;

    const slideHref = resolveLinkHref(
      raw.slideLink,
      productsById,
      categoriesById
    );
    const titleHref =
      resolveLinkHref(raw.titleLink, productsById, categoriesById) ?? slideHref;

    const productsOut: PublicPromoSlideProduct[] = [];
    for (const slot of raw.products ?? []) {
      const live = productsById.get(slot.productId);
      if (!live) continue;
      const href =
        resolveLinkHref(slot.link, productsById, categoriesById) ?? live.href;
      if (!href) continue;
      const card = publicProductFromSlot(slot, live, href);
      if (card) productsOut.push(card);
    }

    const offersOut: PublicPromoSlideOffer[] = [];
    for (const offer of raw.offers ?? []) {
      const href = resolveLinkHref(offer.link, productsById, categoriesById);
      const item: PublicPromoSlideOffer = { id: offer.id, title: offer.title };
      if (offer.subtitle) item.subtitle = offer.subtitle;
      if (offer.code) item.code = offer.code;
      if (href) item.href = href;
      offersOut.push(item);
    }

    const hasContent =
      Boolean(raw.title) ||
      Boolean(raw.subtitle) ||
      Boolean(raw.kicker) ||
      Boolean(raw.graphicTitle) ||
      productsOut.length > 0 ||
      offersOut.length > 0;
    if (!hasContent) continue;

    const slide: PublicPromoSlide = {
      id: raw.id,
      layout: raw.layout,
      audience: raw.audience,
      theme: isPromoSlideTheme(raw.theme) ? raw.theme : 'primary',
      products: productsOut,
      offers: offersOut,
    };
    if (raw.kicker) slide.kicker = raw.kicker;
    if (raw.title) slide.title = raw.title;
    if (raw.subtitle) slide.subtitle = raw.subtitle;
    if (raw.ctaLabel) slide.ctaLabel = raw.ctaLabel;
    if (raw.endsAt) slide.endsAt = raw.endsAt;
    if (raw.graphicTitle) slide.graphicTitle = raw.graphicTitle;
    if (raw.graphicSubtitle) slide.graphicSubtitle = raw.graphicSubtitle;
    if (slideHref) slide.slideHref = slideHref;
    if (titleHref) slide.titleHref = titleHref;
    slides.push(slide);
  }
  return slides;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizePayloadImages(raw: unknown): PublicProductCardImage[] {
  if (!Array.isArray(raw)) return [];
  const images: PublicProductCardImage[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const url = asString(entry.url);
    if (!url) continue;
    const image: PublicProductCardImage = {
      url,
      alt: asString(entry.alt) ?? '',
    };
    if (typeof entry.position === 'number' && Number.isFinite(entry.position)) {
      image.position = entry.position;
    }
    if (entry.isOp === true) {
      image.isOp = true;
    }
    const fullUrl = asString(entry.fullUrl);
    if (fullUrl) {
      image.fullUrl = fullUrl;
    }
    images.push(image);
  }
  images.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return images.slice(0, 5);
}

export function normalizePublicPromoSlides(raw: unknown): PublicPromoSlide[] {
  if (!Array.isArray(raw)) return [];
  const slides: PublicPromoSlide[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = asString(entry.id);
    if (!id) continue;
    const audience = entry.audience === 'new_user' ? 'new_user' : 'all';
    const imageUrl = asString(entry.imageUrl);
    const layout = isPromoSlideLayout(entry.layout)
      ? entry.layout
      : imageUrl
        ? 'legacy'
        : null;
    if (!layout) continue;

    if (layout === 'legacy') {
      if (!imageUrl) continue;
      const slide: PublicPromoSlide = {
        id,
        layout: 'legacy',
        audience,
        theme: 'primary',
        products: [],
        offers: [],
        imageUrl,
      };
      const mobile = asString(entry.mobileImageUrl);
      if (mobile) slide.mobileImageUrl = mobile;
      const title = asString(entry.title);
      if (title) slide.title = title;
      const subtitle = asString(entry.subtitle);
      if (subtitle) slide.subtitle = subtitle;
      const ctaLabel = asString(entry.ctaLabel);
      if (ctaLabel) slide.ctaLabel = ctaLabel;
      const ctaHref = asString(entry.ctaHref);
      if (ctaHref) {
        slide.ctaHref = ctaHref;
        slide.slideHref = ctaHref;
        slide.titleHref = ctaHref;
      }
      const discountLabel = asString(entry.discountLabel);
      if (discountLabel) slide.discountLabel = discountLabel;
      slides.push(slide);
      continue;
    }

    const productsRaw = Array.isArray(entry.products) ? entry.products : [];
    const productsOut: PublicPromoSlideProduct[] = [];
    for (const slot of productsRaw) {
      if (!isRecord(slot)) continue;
      const slotId = asString(slot.id);
      const href = asString(slot.href);
      const name = asString(slot.name);
      if (!slotId || !href || !name) continue;
      const price = asFiniteNumber(slot.price);
      const compareAtPrice = asFiniteNumber(slot.compareAtPrice);
      const onSale =
        typeof slot.onSale === 'boolean'
          ? slot.onSale
          : price !== null && compareAtPrice !== null && compareAtPrice > price;
      const item: PublicPromoSlideProduct = {
        id: slotId,
        href,
        name,
        imageUrl: asString(slot.imageUrl) ?? null,
        imageAlt: asString(slot.imageAlt) ?? null,
        images: normalizePayloadImages(slot.images),
        price,
        compareAtPrice,
        onSale,
      };
      const discountLabel = asString(slot.discountLabel);
      if (discountLabel) item.discountLabel = discountLabel;
      productsOut.push(item);
    }

    const offersRaw = Array.isArray(entry.offers) ? entry.offers : [];
    const offersOut: PublicPromoSlideOffer[] = [];
    for (const offer of offersRaw) {
      if (!isRecord(offer)) continue;
      const offerId = asString(offer.id);
      const title = asString(offer.title);
      if (!offerId || !title) continue;
      const item: PublicPromoSlideOffer = { id: offerId, title };
      const subtitle = asString(offer.subtitle);
      if (subtitle) item.subtitle = subtitle;
      const code = asString(offer.code);
      if (code) item.code = code;
      const href = asString(offer.href);
      if (href) item.href = href;
      offersOut.push(item);
    }

    const slide: PublicPromoSlide = {
      id,
      layout,
      audience,
      theme: isPromoSlideTheme(entry.theme) ? entry.theme : 'primary',
      products: productsOut,
      offers: offersOut,
    };
    const kicker = asString(entry.kicker);
    if (kicker) slide.kicker = kicker;
    const title = asString(entry.title);
    if (title) slide.title = title;
    const subtitle = asString(entry.subtitle);
    if (subtitle) slide.subtitle = subtitle;
    const ctaLabel = asString(entry.ctaLabel);
    if (ctaLabel) slide.ctaLabel = ctaLabel;
    const endsAt = asString(entry.endsAt);
    if (endsAt) slide.endsAt = endsAt;
    const graphicTitle = asString(entry.graphicTitle);
    if (graphicTitle) slide.graphicTitle = graphicTitle;
    const graphicSubtitle = asString(entry.graphicSubtitle);
    if (graphicSubtitle) slide.graphicSubtitle = graphicSubtitle;
    const slideHref = asString(entry.slideHref);
    if (slideHref) slide.slideHref = slideHref;
    const titleHref = asString(entry.titleHref);
    if (titleHref) slide.titleHref = titleHref;
    slides.push(slide);
  }
  return slides;
}

export type HomepageProductSearchHit = {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  imageAlt: string | null;
  images: PublicProductCardImage[];
  price: number | null;
  compareAtPrice: number | null;
};

export async function searchHomepageProducts(
  db: Database,
  query: string,
  env: Env,
  options?: R2UrlOptions
): Promise<HomepageProductSearchHit[]> {
  const search = query.trim();
  if (search.length < 1 || search.length > MAX_SEARCH_LENGTH) return [];

  const escaped = search
    .toLowerCase()
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  const pattern = `%${escaped}%`;

  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      images: products.images,
    })
    .from(products)
    .where(
      and(
        eq(products.published, true),
        or(
          like(sql`lower(${products.name})`, pattern),
          like(sql`lower(${products.slug})`, pattern),
          like(sql`lower(${products.id})`, pattern)
        )
      )
    )
    .orderBy(asc(products.position), asc(products.name))
    .limit(MAX_SEARCH_RESULTS);

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const skuRows = await db
    .select({
      productId: productSkus.productId,
      minPrice: min(productSkus.price),
      minCompareAtPrice: min(productSkus.compareAtPrice),
    })
    .from(productSkus)
    .where(inArray(productSkus.productId, ids))
    .groupBy(productSkus.productId);

  const priceByProduct = new Map(
    skuRows.map((row) => {
      const price =
        typeof row.minPrice === 'number' && Number.isFinite(row.minPrice)
          ? row.minPrice
          : null;
      const compare =
        typeof row.minCompareAtPrice === 'number' &&
        Number.isFinite(row.minCompareAtPrice)
          ? row.minCompareAtPrice
          : null;
      return [row.productId, { price, compareAtPrice: compare }] as const;
    })
  );

  return rows.map((row) => {
    const images = productCardImagesForClient(row.images, env, options);
    const img = images[0] ?? null;
    const pricing = priceByProduct.get(row.id);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      imageUrl: img?.url ?? null,
      imageAlt: img?.alt ?? null,
      images,
      price: pricing?.price ?? null,
      compareAtPrice: pricing?.compareAtPrice ?? null,
    };
  });
}
