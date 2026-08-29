'use client';

export type ProductImage = {
  url: string;
  /**
   * Colour / visual-variant label used to compose image alt text as
   * `productName + forVariant`. Size values (S, M, L, XXL) are not stored here.
   */
  forVariant?: string;
  variantKeys?: string[];
  position?: number;
  /** isOptimised — smaller card-sized copy hosted alongside the full image. */
  isOp?: boolean;
  /** Legacy field from products saved before `forVariant`. Not written anymore. */
  alt?: string;
};

/**
 * Compose the HTML `alt` attribute for a product image.
 * Prefer `productName + forVariant`. Fall back to a legacy stored `alt`
 * then the product name alone. Keep in sync with `@repo/db` composeProductImageAlt.
 */
export function composeProductImageAlt(
  productName: string,
  image: Pick<ProductImage, 'forVariant' | 'alt'> | null | undefined
): string {
  const name = (productName ?? '').trim();
  const variant = image?.forVariant?.trim();
  if (variant) {
    return name ? `${name} ${variant}` : variant;
  }
  const legacy = typeof image?.alt === 'string' ? image.alt.trim() : '';
  if (legacy) return legacy;
  return name;
}

export type ProductVideo = {
  url: string;
  poster?: string | null;
  alt?: string;
};

export type ProductCategory = {
  id: string;
  slug: string;
  name: string;
  parentId?: string | null;
  productId?: string;
};

export type AdminPreview = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role?: string;
};

export type SkuProperty = {
  id?: string;
  skuId?: string;
  aePropertyId: string | null;
  propertyName: string;
  aeValueId: string | null;
  value: string;
  valueDefinitionName: string | null;
  image: string | null;
};

export type ProductSku = {
  id?: string;
  productId?: string;
  aeSkuId: string | null;
  aeSkuAttr: string | null;
  price: number;
  compareAtPrice: number | null;
  aePrice: number | null;
  aeSalePrice: number | null;
  /** Estimated profit in cents (server-computed). Optional on drafts before save. */
  estProfit?: number | null;
  stock: number;
  sku: string | null;
  priceIncludesTax: boolean;
  images: ProductImage[];
  createdAt?: string | number | Date;
  properties: SkuProperty[];
};

export type ProductAttribute = {
  id?: string;
  productId?: string;
  aeAttrNameId: string | null;
  attrName: string;
  aeAttrValueId: string | null;
  attrValue: string;
  attrValueUnit: string | null;
  position: number;
};

/** Lightweight list item for the manage products grid. */
export type ProductSummary = {
  id: string;
  name: string;
  images: ProductImage[];
  published: boolean;
  minPrice: number | null;
  maxPrice: number | null;
  minCompareAtPrice?: number | null;
  maxCompareAtPrice?: number | null;
  minEstProfit?: number | null;
  maxEstProfit?: number | null;
};

/** Full product payload for view / edit flows. */
export type ProductDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  images: ProductImage[];
  tags: string[];
  isAEProduct: boolean;
  aeProductId: string | null;
  aeRating: number | null;
  aeReviewCount: number | null;
  aeSalesCount: string | null;
  published: boolean;
  featured: boolean;
  orderCount: number;
  totalRevenue: number;
  /** Cumulative estimated profit from orders (cents). Optional until migration/API ships. */
  revenueInProfit?: number;
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
  mobileDetail: string | null;
  hasSizeChart: boolean;
  sizeChartImage: string | null;
  sizeChartDescription: string | null;
  aeCategoryId: string | null;
  aeStatus: string | null;
  aeLastSynced: string | number | Date | null;
  videos: ProductVideo[];
  mainVideo: string | null;
  categoryId: string | null;
  position: number;
  metaTitle: string | null;
  metaDescription: string | null;
  productAddedBy: string | null;
  productNotes: string | null;
  categories: ProductCategory[];
  categoryIds: string[];
  skus: ProductSku[];
  attributes: ProductAttribute[];
  addedBy: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  } | null;
};

export type ProductListMeta = {
  currentUserId: string;
  currentUserRole: string;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  addedByOptions: AdminPreview[];
};

export type ProductDetailMeta = Omit<
  ProductListMeta,
  'total' | 'page' | 'pageSize' | 'totalPages' | 'addedByOptions'
> & {
  addedByOptions?: AdminPreview[];
};

export type CategoryNode = {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  depth: number;
  children: CategoryNode[];
};

export type ProductPayload = {
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
  skus: ProductSku[];
  attributes: ProductAttribute[];
};

export type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function getProductsApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  return origin ? `${origin}/api/products/manage` : '/api/products/manage';
}

export function getCategoriesApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  return origin ? `${origin}/api/categories` : '/api/categories';
}

export async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getProductsApiBase();
  const url = path.startsWith('http')
    ? path
    : !path || path === '/'
      ? base
      : path.startsWith('?')
        ? `${base}${path}`
        : `${base}/${path.replace(/^\/+/, '')}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Unable to reach the server. Please try again.', 0);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      response.ok
        ? 'Server returned an invalid response.'
        : `Request failed with status ${response.status}.`,
      response.status
    );
  }

  const possibleError = data as ApiErrorBody;
  if (!response.ok || possibleError.success === false) {
    throw new ApiError(
      possibleError.error ||
        possibleError.message ||
        `Request failed with status ${response.status}.`,
      response.status,
      possibleError.code
    );
  }

  return data as T;
}

export async function requestCategories<T>(
  path = '/tree',
  options: RequestInit = {}
): Promise<T> {
  const base = getCategoriesApiBase();
  const url = path.startsWith('http')
    ? path
    : !path || path === '/'
      ? base
      : path.startsWith('?')
        ? `${base}${path}`
        : `${base}${path.startsWith('/') ? path : `/${path}`}`;

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    cache: 'no-store',
  });

  const data = (await response.json().catch(() => null)) as ApiErrorBody | T | null;
  if (!response.ok || (data as ApiErrorBody | null)?.success === false) {
    const error = data as ApiErrorBody | null;
    throw new ApiError(
      error?.error || error?.message || 'Failed to load categories.',
      response.status,
      error?.code
    );
  }

  return data as T;
}

export function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return 'Not set';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function formatDateTime(value: string | number | Date | null | undefined) {
  if (!value) return 'Never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatPriceRange(product: {
  minPrice: number | null;
  maxPrice: number | null;
}) {
  if (product.minPrice === null || product.minPrice === undefined) return 'No price';
  if (product.maxPrice !== null && product.maxPrice !== undefined && product.maxPrice !== product.minPrice) {
    return `${formatMoney(product.minPrice)} - ${formatMoney(product.maxPrice)}`;
  }
  return formatMoney(product.minPrice);
}

/** Format a min/max cents range the same way as selling price. */
export function formatCentsRange(
  min: number | null | undefined,
  max: number | null | undefined
): string | null {
  if (min === null || min === undefined) return null;
  if (max !== null && max !== undefined && max !== min) {
    return `${formatMoney(min)} - ${formatMoney(max)}`;
  }
  return formatMoney(min);
}

export function formatEstProfitRange(product: {
  minEstProfit?: number | null;
  maxEstProfit?: number | null;
}): string | null {
  return formatCentsRange(
    product.minEstProfit ?? null,
    product.maxEstProfit ?? null
  );
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 180);
}

export function flattenCategories(
  nodes: CategoryNode[],
  prefix = ''
): Array<{ id: string; label: string; depth: number; name: string }> {
  const result: Array<{ id: string; label: string; depth: number; name: string }> = [];
  for (const node of nodes) {
    const label = prefix ? `${prefix} > ${node.name}` : node.name;
    result.push({ id: node.id, label, depth: node.depth, name: node.name });
    if (node.children?.length) {
      result.push(...flattenCategories(node.children, label));
    }
  }
  return result;
}

export function normalizeProductPayload(product: ProductDetail): ProductPayload {
  return {
    name: product.name,
    slug: product.slug,
    description: product.description,
    mobileDetail: product.mobileDetail,
    hasSizeChart: product.hasSizeChart,
    sizeChartImage: product.sizeChartImage,
    sizeChartDescription: product.sizeChartDescription,
    isAEProduct: product.isAEProduct,
    aeProductId: product.aeProductId,
    aeCategoryId: product.aeCategoryId,
    aeRating: product.aeRating,
    aeReviewCount: product.aeReviewCount,
    aeSalesCount: product.aeSalesCount,
    aeStatus: product.aeStatus,
    images: product.images ?? [],
    videos: product.videos ?? [],
    mainVideo: product.mainVideo,
    categoryIds: product.categoryIds ?? product.categories.map((c) => c.id),
    published: product.published,
    featured: product.featured,
    position: product.position,
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
    tags: product.tags ?? [],
    productNotes: product.productNotes,
    skus: product.skus.map((sku) => ({
      ...sku,
      sku: sku.sku ?? '',
      images: sku.images ?? [],
      properties: sku.properties ?? [],
    })),
    attributes: product.attributes ?? [],
  };
}
