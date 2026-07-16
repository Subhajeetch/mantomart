// Shared localStorage helpers for Search Product list + My List drafts.

export const SAVED_PRODUCTS_KEY = 'admin:aliexpress:selected-products:v1';
export const PRODUCT_DRAFTS_KEY = 'admin:aliexpress:product-drafts:v1';

export type SearchProduct = {
  itemId: string;
  title: string;
  targetSalePrice: string;
  targetOriginalPrice: string;
  salePriceFormat: string;
  discount: string;
  itemMainPic: string;
  orders: string;
  evaluateRate: string;
  score: string;
  itemUrl: string;
  [key: string]: unknown;
};

export type SavedAliExpressProduct = {
  schemaVersion: 3;
  id: string;
  source: 'aliexpress';
  status: 'pending_review';
  addedAt: string;
  addedAtMs: number;
  searchContext: {
    query: string;
    pageIndex: number;
    url: string | null;
  };
  product: SearchProduct;
  normalized: {
    itemId: string;
    title: string;
    imageUrl: string | null;
    itemUrl: string | null;
    displayPrice: string;
    targetSalePrice: string | null;
    targetOriginalPrice: string | null;
    discount: string | null;
    orders: string | null;
    rating: number | null;
    positiveRate: number | null;
  };
};

export type ProductImageForm = {
  url: string;
  alt: string;
  variantKeys?: string[];
  position?: number;
  selected?: boolean;
};

export type ProductVideoForm = {
  url: string;
  poster?: string | null;
  alt?: string;
};

export type SkuDraft = {
  aeSkuId: string;
  aeSkuAttr: string;
  price: number; // cents
  compareAtPrice: number | null;
  aePrice: number | null;
  aeSalePrice: number | null;
  stock: number;
  sku: string | null;
  priceIncludesTax: boolean;
  selected: boolean;
  images: ProductImageForm[];
  properties: Array<{
    aePropertyId: string | null;
    propertyName: string;
    aeValueId: string | null;
    value: string;
    valueDefinitionName: string | null;
    image: string | null;
  }>;
  label: string;
};

export type ImportFormState = {
  name: string;
  description: string;
  /** Markdown source for mobile description (converted to HTML on publish). */
  mobileDetailMarkdown: string;
  productImages: ProductImageForm[];
  videos: ProductVideoForm[];
  mainVideo: string | null;
  skus: SkuDraft[];
  attributes: Array<{
    aeAttrNameId: string | null;
    attrName: string;
    aeAttrValueId: string | null;
    attrValue: string;
    attrValueUnit: string | null;
    position: number;
    selected?: boolean;
  }>;
  categoryIds: string[];
  hasSizeChart: boolean;
  sizeChartImage: string | null;
  sizeChartDescription: string | null;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  tags: string[];
  productNotes: string;
  published: boolean;
  featured: boolean;
  // AE source metadata
  aeProductId: string;
  aeCategoryId: string | null;
  aeRating: number | null;
  aeReviewCount: number | null;
  aeSalesCount: string | null;
  aeStatus: string | null;
};

export type ProductImportDraft = {
  schemaVersion: 1;
  listItemId: string;
  aeProductId: string;
  updatedAt: string;
  updatedAtMs: number;
  currentStep: number;
  titleSnapshot: string;
  imageSnapshot: string | null;
  form: ImportFormState;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSavedProduct(value: unknown): value is SavedAliExpressProduct {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.source === 'aliexpress' &&
    isRecord(value.product)
  );
}

function isDraft(value: unknown): value is ProductImportDraft {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.listItemId === 'string' &&
    typeof value.aeProductId === 'string' &&
    isRecord(value.form)
  );
}

export function readSavedProducts(): SavedAliExpressProduct[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(SAVED_PRODUCTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedProduct);
  } catch {
    return [];
  }
}

export function writeSavedProducts(products: SavedAliExpressProduct[]) {
  window.localStorage.setItem(SAVED_PRODUCTS_KEY, JSON.stringify(products));
}

export function removeSavedProduct(id: string): SavedAliExpressProduct[] {
  const next = readSavedProducts().filter((p) => p.id !== id);
  writeSavedProducts(next);
  return next;
}

export function readDrafts(): ProductImportDraft[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(PRODUCT_DRAFTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDraft);
  } catch {
    return [];
  }
}

export function writeDrafts(drafts: ProductImportDraft[]) {
  window.localStorage.setItem(PRODUCT_DRAFTS_KEY, JSON.stringify(drafts));
}

export function upsertDraft(draft: ProductImportDraft): ProductImportDraft[] {
  const existing = readDrafts();
  const next = [
    draft,
    ...existing.filter((d) => d.listItemId !== draft.listItemId),
  ];
  writeDrafts(next);
  return next;
}

export function removeDraft(listItemId: string): ProductImportDraft[] {
  const next = readDrafts().filter((d) => d.listItemId !== listItemId);
  writeDrafts(next);
  return next;
}

export function getDraft(listItemId: string): ProductImportDraft | null {
  return readDrafts().find((d) => d.listItemId === listItemId) ?? null;
}

/**
 * Title → URL slug.
 * e.g. "Men's Hat" → "mens-hat" (apostrophes stripped, not turned into hyphens)
 */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      // Drop possessives / quotes so "Men's" becomes "mens" not "men-s"
      .replace(/[''`´’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 160)
  );
}

export function dollarsToCents(
  value: string | number | null | undefined
): number {
  if (value === null || value === undefined || value === '') return 0;
  const n =
    typeof value === 'number'
      ? value
      : Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function applyMarkupCents(aeCents: number, markupPercent = 100): number {
  return Math.round(aeCents * (1 + markupPercent / 100));
}
