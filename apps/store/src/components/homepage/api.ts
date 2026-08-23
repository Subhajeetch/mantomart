import { asNumber, asString, isRecord } from "./format";
import type {
  FeedResponse,
  HomepageErrorResponse,
  HomepageResponse,
  PublicCategoryCtaBlock,
  PublicHomepageBlock,
  PublicProductCard,
  PublicProductCardImage,
  PublicProductFeedBlock,
  PublicProductGridBlock,
  PublicPromoSlide,
  PublicPromoSlideOffer,
  PublicPromoSlideProduct,
  PublicPromoSliderBlock,
  PromoSlideLayout,
  PromoSlideTheme,
} from "./types";

const HOMEPAGE_REVALIDATE_SECONDS = 5 * 24 * 60 * 60;
const MAX_PRODUCT_CARD_IMAGES = 7;

function getApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "";
  return baseUrl.replace(/\/$/, "");
}

function productHref(slug: string): string {
  const cleaned = slug.trim().replace(/^\/+|\/+$/g, "");
  return cleaned ? `/product/${cleaned}` : "/";
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCardImages(
  raw: unknown,
  fallbackUrl: string | null,
  fallbackAlt: string | null,
  name: string
): PublicProductCardImage[] {
  const images: PublicProductCardImage[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isRecord(entry)) continue;
      const url = asString(entry.url);
      if (!url) continue;
      const image: PublicProductCardImage = {
        url,
        alt: asString(entry.alt) || name,
      };
      if (typeof entry.position === "number" && Number.isFinite(entry.position)) {
        image.position = entry.position;
      }
      images.push(image);
    }
    images.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  if (images.length === 0 && fallbackUrl) {
    images.push({ url: fallbackUrl, alt: fallbackAlt || name });
  }
  return images.slice(0, MAX_PRODUCT_CARD_IMAGES);
}

function normalizeProductCard(raw: unknown): PublicProductCard | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const slug = asString(raw.slug);
  const name = asString(raw.name);
  if (!id || !slug || !name) return null;

  const price = asNullableNumber(raw.price);
  const compareAtPrice = asNullableNumber(raw.compareAtPrice);
  const onSale =
    typeof raw.onSale === "boolean"
      ? raw.onSale
      : price !== null && compareAtPrice !== null && compareAtPrice > price;
  const imageUrl = asString(raw.imageUrl);
  const imageAlt = asString(raw.imageAlt);
  const images = normalizeCardImages(raw.images, imageUrl, imageAlt, name);

  return {
    id,
    slug,
    name,
    imageUrl: images[0]?.url ?? imageUrl,
    imageAlt: images[0]?.alt ?? imageAlt,
    images,
    price,
    compareAtPrice,
    onSale,
    href: asString(raw.href) ?? productHref(slug),
    aeSalesCount: asString(raw.aeSalesCount),
    aeRating: (() => {
      const n = asNullableNumber(raw.aeRating);
      if (n === null || n <= 0 || n > 5) return null;
      return n;
    })(),
    aeReviewCount: (() => {
      const n = asNullableNumber(raw.aeReviewCount);
      if (n === null || n < 0) return null;
      return Math.floor(n);
    })(),
  };
}

const SLIDE_LAYOUTS = new Set<PromoSlideLayout>([
  "deals_banner",
  "welcome_deal",
  "split_products",
  "flash_row",
  "stack_showcase",
  "legacy",
]);

const SLIDE_THEMES = new Set<PromoSlideTheme>([
  "primary",
  "warm",
  "cool",
  "forest",
  "sunset",
  "slate",
]);

function asLayout(value: unknown, imageUrl: string | null): PromoSlideLayout | null {
  if (typeof value === "string" && SLIDE_LAYOUTS.has(value as PromoSlideLayout)) {
    return value as PromoSlideLayout;
  }
  return imageUrl ? "legacy" : null;
}

function asTheme(value: unknown): PromoSlideTheme {
  if (typeof value === "string" && SLIDE_THEMES.has(value as PromoSlideTheme)) {
    return value as PromoSlideTheme;
  }
  return "primary";
}

function normalizeSlideProduct(raw: unknown): PublicPromoSlideProduct | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const href = asString(raw.href);
  const name = asString(raw.name);
  if (!id || !href || !name) return null;
  const price =
    typeof raw.price === "number" && Number.isFinite(raw.price) ? raw.price : null;
  const compareAtPrice =
    typeof raw.compareAtPrice === "number" && Number.isFinite(raw.compareAtPrice)
      ? raw.compareAtPrice
      : null;
  const onSale =
    typeof raw.onSale === "boolean"
      ? raw.onSale
      : price !== null && compareAtPrice !== null && compareAtPrice > price;
  const product: PublicPromoSlideProduct = {
    id,
    href,
    name,
    imageUrl: asString(raw.imageUrl),
    imageAlt: asString(raw.imageAlt),
    price,
    compareAtPrice,
    onSale,
  };
  const discountLabel = asString(raw.discountLabel);
  if (discountLabel) product.discountLabel = discountLabel;
  return product;
}

function normalizeSlideOffer(raw: unknown): PublicPromoSlideOffer | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const title = asString(raw.title);
  if (!id || !title) return null;
  const offer: PublicPromoSlideOffer = { id, title };
  const subtitle = asString(raw.subtitle);
  if (subtitle) offer.subtitle = subtitle;
  const code = asString(raw.code);
  if (code) offer.code = code;
  const href = asString(raw.href);
  if (href) offer.href = href;
  return offer;
}

function normalizeSlide(raw: unknown): PublicPromoSlide | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (!id) return null;
  const imageUrl = asString(raw.imageUrl);
  const layout = asLayout(raw.layout, imageUrl);
  if (!layout) return null;

  const products = (Array.isArray(raw.products) ? raw.products : [])
    .map(normalizeSlideProduct)
    .filter((item): item is PublicPromoSlideProduct => item !== null);
  const offers = (Array.isArray(raw.offers) ? raw.offers : [])
    .map(normalizeSlideOffer)
    .filter((item): item is PublicPromoSlideOffer => item !== null);

  const slide: PublicPromoSlide = {
    id,
    layout,
    audience: raw.audience === "new_user" ? "new_user" : "all",
    theme: asTheme(raw.theme),
    products,
    offers,
  };

  const kicker = asString(raw.kicker);
  if (kicker) slide.kicker = kicker;
  const title = asString(raw.title);
  if (title) slide.title = title;
  const subtitle = asString(raw.subtitle);
  if (subtitle) slide.subtitle = subtitle;
  const ctaLabel = asString(raw.ctaLabel);
  if (ctaLabel) slide.ctaLabel = ctaLabel;
  const endsAt = asString(raw.endsAt);
  if (endsAt) slide.endsAt = endsAt;
  const graphicTitle = asString(raw.graphicTitle);
  if (graphicTitle) slide.graphicTitle = graphicTitle;
  const graphicSubtitle = asString(raw.graphicSubtitle);
  if (graphicSubtitle) slide.graphicSubtitle = graphicSubtitle;
  const slideHref = asString(raw.slideHref);
  if (slideHref) slide.slideHref = slideHref;
  const titleHref = asString(raw.titleHref);
  if (titleHref) slide.titleHref = titleHref;
  if (imageUrl) slide.imageUrl = imageUrl;
  const mobile = asString(raw.mobileImageUrl);
  if (mobile) slide.mobileImageUrl = mobile;
  const ctaHref = asString(raw.ctaHref);
  if (ctaHref) {
    slide.ctaHref = ctaHref;
    if (!slide.slideHref) slide.slideHref = ctaHref;
    if (!slide.titleHref) slide.titleHref = ctaHref;
  }
  const discountLabel = asString(raw.discountLabel);
  if (discountLabel) slide.discountLabel = discountLabel;

  if (layout === "legacy" && !slide.imageUrl) return null;
  if (
    layout !== "legacy" &&
    !slide.title &&
    !slide.subtitle &&
    !slide.kicker &&
    !slide.graphicTitle &&
    products.length === 0 &&
    offers.length === 0
  ) {
    return null;
  }
  return slide;
}

function normalizeBlock(raw: unknown): PublicHomepageBlock | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const blockType = asString(raw.blockType);
  const position = asNumber(raw.position);
  if (!id || !blockType) return null;

  if (blockType === "promo_slider") {
    const config = isRecord(raw.config) ? raw.config : {};
    const slides = (Array.isArray(config.slides) ? config.slides : [])
      .map(normalizeSlide)
      .filter((slide): slide is PublicPromoSlide => slide !== null);
    const block: PublicPromoSliderBlock = {
      id,
      blockType: "promo_slider",
      position,
      config: { type: "promo_slider", slides },
    };
    return block;
  }

  if (blockType === "product_grid") {
    const config = isRecord(raw.config) ? raw.config : {};
    const products = (Array.isArray(raw.products) ? raw.products : [])
      .map(normalizeProductCard)
      .filter((card): card is PublicProductCard => card !== null);
    const block: PublicProductGridBlock = {
      id,
      blockType: "product_grid",
      position,
      config: {
        type: "product_grid",
        source: config.source === "category" ? "category" : "featured",
        categoryId: asString(config.categoryId) ?? undefined,
        categoryName: asString(config.categoryName),
        categorySlug: asString(config.categorySlug),
        limit: asNumber(config.limit, 8),
      },
      products,
    };
    return block;
  }

  if (blockType === "category_cta") {
    const config = isRecord(raw.config) ? raw.config : {};
    const buttonsRaw = Array.isArray(config.buttons) ? config.buttons : [];
    const buttons = buttonsRaw.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const btnId = asString(entry.id);
      const label = asString(entry.label);
      const categoryId = asString(entry.categoryId);
      if (!btnId || !label || !categoryId) return [];
      return [
        {
          id: btnId,
          label,
          categoryId,
          href: asString(entry.href),
          categoryName: asString(entry.categoryName),
          categorySlug: asString(entry.categorySlug),
          categoryImage: asString(entry.categoryImage),
        },
      ];
    });
    const block: PublicCategoryCtaBlock = {
      id,
      blockType: "category_cta",
      position,
      config: {
        type: "category_cta",
        title: asString(config.title) ?? undefined,
        subtitle: asString(config.subtitle) ?? undefined,
        buttons,
      },
    };
    return block;
  }

  if (blockType === "product_feed") {
    const config = isRecord(raw.config) ? raw.config : {};
    const items = (Array.isArray(raw.items) ? raw.items : [])
      .map(normalizeProductCard)
      .filter((card): card is PublicProductCard => card !== null);
    const block: PublicProductFeedBlock = {
      id,
      blockType: "product_feed",
      position,
      config: {
        type: "product_feed",
        pageSize: asNumber(config.pageSize, 12),
      },
      items,
      nextCursor: asString(raw.nextCursor),
    };
    return block;
  }

  return null;
}

async function fetchHomepage(): Promise<
  HomepageResponse | HomepageErrorResponse | null
> {
  const apiBaseUrl = getApiBaseUrl();
  const url = apiBaseUrl
    ? `${apiBaseUrl}/api/store/homepage`
    : "/api/store/homepage";

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: {
        revalidate: HOMEPAGE_REVALIDATE_SECONDS,
        tags: ["store-homepage"],
      },
    });

    if (!response.ok) {
      console.warn(
        `getHomepage: API responded ${response.status} ${response.statusText}`
      );
      return null;
    }

    return (await response.json()) as
      | HomepageResponse
      | HomepageErrorResponse
      | null;
  } catch (error) {
    const cause =
      error instanceof Error && "cause" in error
        ? (error as Error & { cause?: { code?: string } }).cause
        : undefined;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? String(cause.code)
        : "";

    if (code === "ECONNREFUSED") {
      console.warn(
        "getHomepage: API unreachable during build/render — using empty homepage."
      );
    } else {
      console.warn("getHomepage: fetch failed — using empty homepage.", error);
    }
    return null;
  }
}

/**
 * Server-side fetch for the storefront homepage.
 * Never throws — empty blocks on any failure so the page still renders.
 */
export async function getHomepage(): Promise<PublicHomepageBlock[]> {
  const body = await fetchHomepage();

  if (!body || typeof body !== "object" || body.success !== true) {
    if (body) {
      const message =
        typeof body === "object" && "message" in body
          ? String(body.message ?? "unknown error")
          : "invalid payload";
      console.warn(`getHomepage: unsuccessful response (${message})`);
    }
    return [];
  }

  if (!Array.isArray(body.data?.blocks)) {
    console.warn("getHomepage: blocks missing or not an array");
    return [];
  }

  return body.data.blocks
    .map(normalizeBlock)
    .filter((block): block is PublicHomepageBlock => block !== null)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * Client-side infinite-scroll page fetch. Never throws.
 */
export async function fetchFeedPage(
  cursor: string | null,
  pageSize?: number
): Promise<{ items: PublicProductCard[]; nextCursor: string | null }> {
  const apiBaseUrl = getApiBaseUrl();
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (typeof pageSize === "number" && Number.isFinite(pageSize)) {
    params.set("pageSize", String(pageSize));
  }
  const query = params.toString();
  const path = query
    ? `/api/store/homepage/feed?${query}`
    : "/api/store/homepage/feed";
  const url = apiBaseUrl ? `${apiBaseUrl}${path}` : path;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      console.warn(`fetchFeedPage: API responded ${response.status}`);
      return { items: [], nextCursor: null };
    }
    const body = (await response.json()) as FeedResponse | HomepageErrorResponse;
    if (!body || typeof body !== "object" || body.success !== true) {
      return { items: [], nextCursor: null };
    }
    const items = (Array.isArray(body.data?.items) ? body.data.items : [])
      .map(normalizeProductCard)
      .filter((card): card is PublicProductCard => card !== null);
    return {
      items,
      nextCursor: asString(body.data?.nextCursor),
    };
  } catch (error) {
    console.warn("fetchFeedPage: fetch failed.", error);
    return { items: [], nextCursor: null };
  }
}
