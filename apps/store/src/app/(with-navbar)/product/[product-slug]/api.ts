import { asString, isRecord } from '@/components/homepage/format';
import { normalizeProductCard } from '@/components/homepage/api';
import type { PublicProductCard } from '@/components/homepage/types';
import type { ProductDefaultPrice } from '@/components/homepage/types';

import type {
  MoreForYouPage,
  MoreForYouResponse,
  ProductErrorResponse,
  ProductResponse,
  PublicAttribute,
  PublicCategoryRef,
  PublicGalleryItem,
  PublicOptionGroup,
  PublicOptionValue,
  PublicProduct,
  PublicReview,
  PublicReviewFilter,
  PublicReviewPage,
  PublicReviewPhoto,
  PublicSku,
} from './types';

const PRODUCT_REVALIDATE_SECONDS = 6 * 60 * 60;
const REVIEW_PAGE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REVIEW_PAYLOAD_VERSION = '5';
const reviewPageCache = new Map<
  string,
  { page: PublicReviewPage; expiresAt: number }
>();
const pendingReviewPages = new Map<string, Promise<PublicReviewPage>>();

function getApiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
  return baseUrl.replace(/\/$/, '');
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const text = asString(entry);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalizeCategory(raw: unknown): PublicCategoryRef | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const name = asString(raw.name);
  const slug = asString(raw.slug);
  if (!id || !name || !slug) return null;
  const href = asString(raw.href) || `/category/${slug}`;
  return { id, name, slug, href };
}

function normalizeReview(
  raw: unknown,
  maxImageUrls = 5
): PublicReview | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const reviewerName = asString(raw.reviewerName);
  const rating = asNullableNumber(raw.rating);
  const reviewDate = asString(raw.reviewDate);
  if (
    !id ||
    !reviewerName ||
    rating === null ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5 ||
    !reviewDate ||
    !Number.isFinite(Date.parse(reviewDate))
  ) {
    return null;
  }
  return {
    id,
    reviewerName,
    rating,
    comment: asString(raw.comment) ?? '',
    imageUrls: asStringArray(raw.imageUrls).slice(0, maxImageUrls),
    reviewDate,
  };
}

function normalizeReviewPhoto(raw: unknown): PublicReviewPhoto | null {
  if (!isRecord(raw)) return null;
  const url = asString(raw.url);
  const reviewId = asString(raw.reviewId);
  const reviewerName = asString(raw.reviewerName);
  const rating = asNullableNumber(raw.rating);
  const reviewDate = asString(raw.reviewDate);
  if (
    !url ||
    !reviewId ||
    !reviewerName ||
    rating === null ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5 ||
    !reviewDate ||
    !Number.isFinite(Date.parse(reviewDate))
  ) {
    return null;
  }
  return {
    url,
    reviewId,
    reviewerName,
    rating,
    comment: asString(raw.comment) ?? '',
    reviewDate,
  };
}

function normalizeGalleryItem(raw: unknown): PublicGalleryItem | null {
  if (!isRecord(raw)) return null;
  const type = asString(raw.type);
  const url = asString(raw.url);
  if (!url) return null;
  if (type === 'video') {
    return {
      type: 'video',
      url,
      poster: asString(raw.poster),
      alt: asString(raw.alt) || 'Product video',
    };
  }
  if (type !== 'image' && type !== null) return null;
  const variantKeys = asStringArray(raw.variantKeys);
  return {
    type: 'image',
    url,
    alt: asString(raw.alt) || '',
    forVariant: asString(raw.forVariant),
    variantKeys,
  };
}

function normalizeOptionValue(raw: unknown): PublicOptionValue | null {
  if (!isRecord(raw)) return null;
  const value = asString(raw.value);
  if (!value) return null;
  return {
    value,
    image: asString(raw.image),
    inStock: raw.inStock !== false,
  };
}

function normalizeOptionGroup(raw: unknown): PublicOptionGroup | null {
  if (!isRecord(raw)) return null;
  const name = asString(raw.name);
  if (!name) return null;
  const values = (Array.isArray(raw.values) ? raw.values : [])
    .map(normalizeOptionValue)
    .filter((item): item is PublicOptionValue => item !== null);
  if (values.length === 0) return null;
  return {
    name,
    values,
    hasImages:
      raw.hasImages === true || values.some((item) => Boolean(item.image)),
  };
}

function normalizeSku(raw: unknown): PublicSku | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const price = asNullableNumber(raw.price);
  if (!id || price === null || price < 0) return null;
  const optionsRaw = isRecord(raw.options) ? raw.options : {};
  const options: Record<string, string> = {};
  for (const [key, value] of Object.entries(optionsRaw)) {
    const name = key.trim();
    const optionValue = asString(value);
    if (!name || !optionValue) continue;
    options[name] = optionValue;
  }
  const stock = asNullableNumber(raw.stock);
  return {
    id,
    price,
    compareAtPrice: asNullableNumber(raw.compareAtPrice),
    stock: stock === null ? 0 : Math.max(0, Math.floor(stock)),
    options,
  };
}

function normalizeAttribute(raw: unknown): PublicAttribute | null {
  if (!isRecord(raw)) return null;
  const name = asString(raw.name);
  const value = asString(raw.value);
  if (!name || !value) return null;
  return {
    name,
    value,
    unit: asString(raw.unit),
  };
}

function normalizeProduct(raw: unknown): PublicProduct | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const slug = asString(raw.slug);
  const name = asString(raw.name);
  if (!id || !slug || !name) return null;

  const gallery = (Array.isArray(raw.gallery) ? raw.gallery : [])
    .map(normalizeGalleryItem)
    .filter((item): item is PublicGalleryItem => item !== null);
  const optionGroups = (Array.isArray(raw.optionGroups) ? raw.optionGroups : [])
    .map(normalizeOptionGroup)
    .filter((item): item is PublicOptionGroup => item !== null);
  const skus = (Array.isArray(raw.skus) ? raw.skus : [])
    .map(normalizeSku)
    .filter((item): item is PublicSku => item !== null);
  const attributes = (Array.isArray(raw.attributes) ? raw.attributes : [])
    .map(normalizeAttribute)
    .filter((item): item is PublicAttribute => item !== null);
  const breadcrumbs = (Array.isArray(raw.breadcrumbs) ? raw.breadcrumbs : [])
    .map(normalizeCategory)
    .filter((item): item is PublicCategoryRef => item !== null);
  const reviews = (Array.isArray(raw.reviews) ? raw.reviews : [])
    .map(normalizeReview)
    .filter((item): item is PublicReview => item !== null);
  const reviewImgsSnapShot = (Array.isArray(raw.reviewImgsSnapShot)
    ? raw.reviewImgsSnapShot
    : []
  )
    .map(normalizeReviewPhoto)
    .filter((item): item is PublicReviewPhoto => item !== null)
    .slice(0, 5);

  const rating = asNullableNumber(raw.aeRating);
  const aeReviewCount = asNullableNumber(raw.aeReviewCount);
  const reviewCount = asNullableNumber(raw.reviewCount);
  const averageReview = asNullableNumber(raw.averageReview);

  return {
    id,
    slug,
    name,
    defaultPrice: normalizeDefaultPrice(raw.defaultPrice),
    description: asString(raw.description),
    mobileDetail: asString(raw.mobileDetail),
    hasSizeChart: raw.hasSizeChart === true,
    sizeChartImage: asString(raw.sizeChartImage),
    sizeChartDescription: asString(raw.sizeChartDescription),
    aeRating: rating !== null && rating > 0 && rating <= 5 ? rating : null,
    aeReviewCount:
      aeReviewCount !== null && aeReviewCount >= 0
        ? Math.floor(aeReviewCount)
        : null,
    reviewCount:
      reviewCount !== null && reviewCount >= 0 ? Math.floor(reviewCount) : 0,
    averageReview:
      averageReview !== null && averageReview > 0 && averageReview <= 5
        ? averageReview
        : null,
    reviewsWithImgs: Math.max(
      0,
      Math.floor(asNullableNumber(raw.reviewsWithImgs) ?? 0)
    ),
    reviewsWithComs: Math.max(
      0,
      Math.floor(asNullableNumber(raw.reviewsWithComs) ?? 0)
    ),
    totalNumOfImgs: Math.max(
      0,
      Math.floor(asNullableNumber(raw.totalNumOfImgs) ?? 0)
    ),
    reviewImgsSnapShot,
    reviews,
    aeSalesCount: asString(raw.aeSalesCount),
    tags: asStringArray(raw.tags),
    metaTitle: asString(raw.metaTitle),
    metaDescription: asString(raw.metaDescription),
    gallery,
    optionGroups,
    skus,
    attributes,
    category: normalizeCategory(raw.category),
    breadcrumbs,
  };
}

export async function fetchProductReviewPage(
  slug: string,
  filter: PublicReviewFilter,
  offset: number
): Promise<PublicReviewPage> {
  const cacheKey = `${slug}:${filter}:${offset}`;
  const cached = reviewPageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.page;
  if (cached) reviewPageCache.delete(cacheKey);

  const pending = pendingReviewPages.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const params = new URLSearchParams({
      filter,
      offset: String(offset),
      version: REVIEW_PAYLOAD_VERSION,
    });
    let response: Response;
    try {
      response = await fetch(
        `/api/store/product/${encodeURIComponent(slug)}/reviews?${params}`,
        {
          headers: { Accept: 'application/json' },
          cache: 'force-cache',
        }
      );
    } catch (error) {
      throw new Error(
        'Reviews could not be reached. Check your connection and try again.',
        { cause: error }
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('The review service returned an invalid response.');
    }
    if (!response.ok) {
      const message =
        isRecord(body) && typeof body.error === 'string'
          ? body.error
          : 'Reviews could not be loaded. Please try again.';
      throw new Error(message);
    }
    if (
      !isRecord(body) ||
      body.success !== true ||
      !isRecord(body.data) ||
      !Array.isArray(body.data.reviews) ||
      typeof body.data.totalCount !== 'number' ||
      typeof body.data.hasMore !== 'boolean'
    ) {
      throw new Error('The review service returned an invalid response.');
    }

    const page: PublicReviewPage = {
      reviews: body.data.reviews
        .map((review) => normalizeReview(review, Number.MAX_SAFE_INTEGER))
        .filter((review): review is PublicReview => review !== null),
      totalCount: Math.max(0, Math.floor(body.data.totalCount)),
      hasMore: body.data.hasMore,
    };
    reviewPageCache.set(cacheKey, {
      page,
      expiresAt: Date.now() + REVIEW_PAGE_CACHE_TTL_MS,
    });
    return page;
  })();
  pendingReviewPages.set(cacheKey, request);
  try {
    return await request;
  } finally {
    pendingReviewPages.delete(cacheKey);
  }
}

function normalizeDefaultPrice(raw: unknown): ProductDefaultPrice | null {
  if (!isRecord(raw)) return null;
  const range = (value: unknown) =>
    isRecord(value)
      ? { from: asNullableNumber(value.from), to: asNullableNumber(value.to) }
      : { from: null, to: null };
  return {
    normalPrice: range(raw.normalPrice),
    comparedPrice: range(raw.comparedPrice),
  };
}

async function fetchProduct(
  slug: string
): Promise<ProductResponse | ProductErrorResponse | null> {
  const apiBaseUrl = getApiBaseUrl();
  const path = `/api/store/product/${encodeURIComponent(slug)}?reviewVersion=${REVIEW_PAYLOAD_VERSION}`;
  const url = apiBaseUrl ? `${apiBaseUrl}${path}` : path;

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: {
        revalidate: PRODUCT_REVALIDATE_SECONDS,
        tags: [`store-product-${slug}`],
      },
    });
    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok) {
      throw new Error(
        `Product service returned HTTP ${response.status} ${response.statusText}.`
      );
    }
    return (await response.json()) as ProductResponse | ProductErrorResponse;
  } catch (error) {
    console.warn('getProduct: fetch failed.', error);
    throw new Error('Product details could not be loaded.', { cause: error });
  }
}

/**
 * Server-side fetch for a published product. Returns null for a 404 and
 * throws when the API is unavailable or returns invalid data.
 */
export async function getProduct(slug: string): Promise<PublicProduct | null> {
  const cleaned = slug.trim().toLowerCase();
  if (!cleaned) return null;
  const body = await fetchProduct(cleaned);
  if (body === null) return null;
  if (typeof body !== 'object') {
    throw new Error('Product service returned an invalid response.');
  }
  if (body.success !== true) {
    throw new Error(body.message || body.error || 'Product details are unavailable.');
  }
  const product = normalizeProduct(body.data);
  if (!product) throw new Error('Product service returned invalid product data.');
  return product;
}

async function fetchMore(
  slug: string,
  cursor: string | null,
  pageSize?: number
): Promise<MoreForYouResponse | ProductErrorResponse | null> {
  const apiBaseUrl = getApiBaseUrl();
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (typeof pageSize === 'number' && Number.isFinite(pageSize)) {
    params.set('pageSize', String(pageSize));
  }
  const query = params.toString();
  const path = query
    ? `/api/store/product/${encodeURIComponent(slug)}/more?${query}`
    : `/api/store/product/${encodeURIComponent(slug)}/more`;
  const url = apiBaseUrl ? `${apiBaseUrl}${path}` : path;

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: {
        revalidate: PRODUCT_REVALIDATE_SECONDS,
        tags: [
          `store-product-more-${slug}-${cursor ?? 'initial'}-${pageSize ?? 'default'}`,
        ],
      },
    });
    if (!response.ok) {
      console.warn(`fetchMoreForYou: API responded ${response.status}`);
      return null;
    }
    return (await response.json()) as MoreForYouResponse | ProductErrorResponse;
  } catch (error) {
    console.warn('fetchMoreForYou: fetch failed.', error);
    return null;
  }
}

export async function getMoreForYou(
  slug: string,
  cursor: string | null = null,
  pageSize?: number
): Promise<MoreForYouPage> {
  const cleaned = slug.trim().toLowerCase();
  if (!cleaned) return { items: [], nextCursor: null };
  const body = await fetchMore(cleaned, cursor, pageSize);
  if (!body || typeof body !== 'object' || body.success !== true) {
    return { items: [], nextCursor: null };
  }
  const items = (Array.isArray(body.data?.items) ? body.data.items : [])
    .map(normalizeProductCard)
    .filter((card): card is PublicProductCard => card !== null);
  return {
    items,
    nextCursor: asString(body.data?.nextCursor),
  };
}

export async function fetchMoreForYou(
  slug: string,
  cursor: string | null,
  pageSize?: number
): Promise<MoreForYouPage> {
  return getMoreForYou(slug, cursor, pageSize);
}
