import type { AliExpressProductDetailResponse } from './product-dialog';
import {
  applyMarkupCents,
  dollarsToCents,
  slugify,
  type ImportFormState,
  type ProductImageForm,
  type ProductVideoForm,
  type SavedAliExpressProduct,
  type SkuDraft,
} from './storage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function normalizeUrl(value: unknown): string | null {
  const raw = getString(value).trim();
  if (!raw) return null;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('/')
  ) {
    return raw;
  }
  return `https://${raw}`;
}

function getImageDedupeKey(url: string) {
  try {
    const parsed = new URL(url, 'https://mantomart.com');
    const pathname = parsed.pathname.replace(
      /\.(jpe?g|png|webp|gif)(?:_.+)$/i,
      '.$1'
    );
    const host = parsed.host.toLowerCase();
    return host ? `${host}${pathname}` : pathname;
  } catch {
    return url.replace(/#.*$/, '').replace(/\?.*$/, '');
  }
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return [value];
  return [];
}

function uniqueUrls(values: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const url = normalizeUrl(value);
    if (!url) continue;
    const key = getImageDedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(url);
  }
  return result;
}

export function dedupeProductImages(
  images: ProductImageForm[]
): ProductImageForm[] {
  const seen = new Set<string>();
  const result: ProductImageForm[] = [];

  for (const image of images) {
    const url = normalizeUrl(image.url);
    if (!url) continue;
    const key = getImageDedupeKey(url);
    const existing = result.find((item) => getImageDedupeKey(item.url) === key);

    if (seen.has(key)) {
      if (existing) {
        existing.variantKeys = [
          ...new Set([
            ...(existing.variantKeys ?? []),
            ...(image.variantKeys ?? []),
          ]),
        ];
        existing.alt = existing.alt || image.alt;
        existing.selected =
          existing.selected !== false || image.selected !== false;
      }
      continue;
    }

    seen.add(key);
    result.push({
      ...image,
      url,
      position: result.length,
    });
  }

  return result;
}

export function normalizeImportForm(form: ImportFormState): ImportFormState {
  const rawAttributes = Array.isArray(form.attributes) ? form.attributes : [];
  const rawImages = Array.isArray(form.productImages) ? form.productImages : [];
  const rawSkus = Array.isArray(form.skus) ? form.skus : [];
  const attributes = rawAttributes.reduce<ImportFormState['attributes']>(
    (result, attr) => {
      const next = {
        ...attr,
        attrName: attr.attrName?.trim() ?? '',
        attrValue: attr.attrValue?.trim() ?? '',
        attrValueUnit: attr.attrValueUnit?.trim() || null,
        position: result.length,
        selected: attr.selected !== false,
      };
      const key = [
        next.attrName.toLowerCase(),
        next.attrValue.toLowerCase(),
        next.attrValueUnit?.toLowerCase() ?? '',
      ].join('\u0000');
      const existing = result.find((item) => {
        const existingKey = [
          item.attrName.toLowerCase(),
          item.attrValue.toLowerCase(),
          item.attrValueUnit?.toLowerCase() ?? '',
        ].join('\u0000');
        return existingKey === key;
      });

      if (existing) {
        existing.selected = existing.selected !== false || next.selected;
        existing.aeAttrNameId = existing.aeAttrNameId ?? next.aeAttrNameId;
        existing.aeAttrValueId = existing.aeAttrValueId ?? next.aeAttrValueId;
        return result;
      }

      result.push(next);
      return result;
    },
    []
  );

  return {
    ...form,
    productImages: dedupeProductImages(rawImages),
    skus: rawSkus.map((sku) => ({
      ...sku,
      images: dedupeProductImages(Array.isArray(sku.images) ? sku.images : []),
    })),
    attributes,
  };
}

function splitImageUrls(value: unknown) {
  return getString(value)
    .split(';')
    .map((url) => url.trim())
    .filter(Boolean);
}

/** Same as product-dialog: pull <img src> from HTML description. */
function getHtmlImageUrls(html: unknown) {
  const raw = getString(html);
  if (!raw) return [];

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    return Array.from(doc.querySelectorAll('img'))
      .map((img) => img.getAttribute('src'))
      .filter(Boolean);
  }

  return Array.from(raw.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)).map(
    (match) => match[1]
  );
}

/** Same as product-dialog: mobile_detail JSON module image urls. */
function getMobileDetailImages(value: unknown) {
  const raw = getString(value);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.moduleList)) return [];

    return parsed.moduleList
      .filter(isRecord)
      .map((module) => (isRecord(module.data) ? module.data.url : null))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getSkuProperties(sku: Record<string, unknown>) {
  const propertyWrapper = sku.ae_sku_property_dtos;
  const rawProperties = isRecord(propertyWrapper)
    ? propertyWrapper.ae_sku_property_d_t_o
    : undefined;
  return toRecordArray(rawProperties);
}

export function buildInitialForm(
  listItem: SavedAliExpressProduct,
  detail: AliExpressProductDetailResponse | null,
  markupPercent = 100
): ImportFormState {
  const response = detail?.aliexpress_ds_product_get_response;
  const rawResult = response?.result;
  const result = isRecord(rawResult) ? rawResult : {};

  const baseInfo = isRecord(result.ae_item_base_info_dto)
    ? result.ae_item_base_info_dto
    : {};
  const multimediaInfo = isRecord(result.ae_multimedia_info_dto)
    ? result.ae_multimedia_info_dto
    : {};
  const skuWrapper = isRecord(result.ae_item_sku_info_dtos)
    ? result.ae_item_sku_info_dtos
    : {};
  const propertyWrapper = isRecord(result.ae_item_properties)
    ? result.ae_item_properties
    : {};
  const videoWrapper = isRecord(multimediaInfo.ae_video_dtos)
    ? multimediaInfo.ae_video_dtos
    : {};

  const aeProductId =
    getString(baseInfo.product_id) || listItem.normalized.itemId || listItem.id;

  const rawSkus = toRecordArray(skuWrapper.ae_item_sku_info_d_t_o);
  const skuImages = rawSkus.flatMap((sku) =>
    getSkuProperties(sku).map((property) => property.sku_image)
  );

  const videos: ProductVideoForm[] = [];
  for (const v of toRecordArray(videoWrapper.ae_video_d_t_o)) {
    const url = normalizeUrl(v.media_url);
    if (!url) continue;
    videos.push({
      url,
      poster: normalizeUrl(v.poster_url),
      alt: '',
    });
  }

  const videoPosters = videos.map((v) => v.poster).filter(Boolean);

  // Match product-dialog: gallery + SKU images + video posters + detail images
  const galleryUrls = uniqueUrls([
    listItem.normalized.imageUrl,
    listItem.product?.itemMainPic,
    ...splitImageUrls(multimediaInfo.image_urls),
    ...skuImages,
    ...videoPosters,
  ]);

  const detailUrls = uniqueUrls([
    ...getMobileDetailImages(baseInfo.mobile_detail),
    ...getHtmlImageUrls(baseInfo.detail),
  ]);

  // Combined unique list: gallery first, then detail images (size charts often here)
  const allImageUrls = uniqueUrls([...galleryUrls, ...detailUrls]);

  // Alt text starts empty; filled with step-1 title when user reaches variants step
  const productImages: ProductImageForm[] = allImageUrls.map((url, index) => ({
    url,
    alt: '',
    position: index,
    selected: true,
    variantKeys: [],
  }));

  const skus: SkuDraft[] = rawSkus.map((sku, index) => {
    const properties = getSkuProperties(sku).map((prop) => ({
      aePropertyId: getString(prop.sku_property_id) || null,
      propertyName: getString(prop.sku_property_name, 'Option'),
      aeValueId: getString(prop.property_value_id) || null,
      value: getString(prop.sku_property_value, '—'),
      valueDefinitionName:
        getString(prop.property_value_definition_name) || null,
      image: normalizeUrl(prop.sku_image),
    }));

    const label =
      properties.map((p) => `${p.propertyName}: ${p.value}`).join(' · ') ||
      `Variant ${index + 1}`;

    const aeSale = dollarsToCents(getString(sku.offer_sale_price));
    const aeOriginal = dollarsToCents(getString(sku.sku_price));
    const ourPrice = applyMarkupCents(aeSale || aeOriginal, markupPercent);
    const ourCompare = aeOriginal
      ? applyMarkupCents(aeOriginal, markupPercent)
      : null;

    const variantKeys = [
      getString(sku.sku_id),
      ...properties.map((p) => p.aeValueId).filter(Boolean),
      ...properties.map((p) => `${p.propertyName}:${p.value}`),
    ].filter(Boolean) as string[];

    const propImages: ProductImageForm[] = properties
      .filter((p) => p.image)
      .map((p, i) => ({
        url: p.image as string,
        alt: '',
        variantKeys,
        position: i,
        selected: true,
      }));

    const stock =
      Number.parseInt(getString(sku.sku_available_stock, '0'), 10) || 0;

    return {
      aeSkuId: getString(sku.sku_id) || `sku-${index}`,
      aeSkuAttr: getString(sku.sku_attr),
      price: ourPrice,
      compareAtPrice: ourCompare,
      aePrice: aeOriginal || null,
      aeSalePrice: aeSale || null,
      stock,
      sku: null,
      priceIncludesTax:
        sku.price_include_tax === true || sku.price_include_tax === 'true',
      // Out-of-stock variants start unselected
      selected: stock > 0,
      images: propImages,
      properties,
      label,
    };
  });

  // If AE returned no SKUs, create a default single variant from search price
  if (skus.length === 0) {
    const sale = dollarsToCents(listItem.normalized.targetSalePrice);
    const original = dollarsToCents(listItem.normalized.targetOriginalPrice);
    skus.push({
      aeSkuId: 'default',
      aeSkuAttr: '',
      price: applyMarkupCents(sale || original, markupPercent) || 999,
      compareAtPrice: original
        ? applyMarkupCents(original, markupPercent)
        : null,
      aePrice: original || null,
      aeSalePrice: sale || null,
      stock: 0,
      sku: null,
      priceIncludesTax: false,
      selected: false,
      images: productImages.slice(0, 1).map((img) => ({ ...img })),
      properties: [],
      label: 'Default',
    });
  }

  // Link product images to variants by matching property images
  for (const img of productImages) {
    const matchingSkus = skus.filter((s) =>
      s.images.some((si) => si.url === img.url)
    );
    if (matchingSkus.length > 0) {
      img.variantKeys = [
        ...new Set(
          matchingSkus.flatMap(
            (s) =>
              [
                s.aeSkuId,
                ...s.properties.map((p) => p.aeValueId).filter(Boolean),
              ] as string[]
          )
        ),
      ];
    }
  }

  const attributes = toRecordArray(propertyWrapper.ae_item_property).map(
    (attr, index) => ({
      aeAttrNameId: getString(attr.attr_name_id) || null,
      attrName: getString(attr.attr_name, 'Attribute'),
      aeAttrValueId: getString(attr.attr_value_id) || null,
      attrValue: getString(attr.attr_value),
      attrValueUnit: getString(attr.attr_value_unit) || null,
      position: index,
      selected: true,
    })
  );

  // Size chart heuristics: look for size-related images / attrs
  const sizeChartImage: string | null = null;
  let sizeChartDescription: string | null = null;
  const sizeAttr = attributes.find((a) =>
    /size\s*chart|measurement|sizing/i.test(a.attrName + ' ' + a.attrValue)
  );
  if (sizeAttr) {
    sizeChartDescription = `${sizeAttr.attrName}: ${sizeAttr.attrValue}`;
  }
  // Sometimes detail images include size charts — leave empty for admin to pick
  // Title / description / mobile description intentionally blank for the admin to write.

  return {
    name: '',
    description: '',
    mobileDetailMarkdown: '',
    productImages,
    videos,
    mainVideo: videos[0]?.url ?? null,
    skus,
    attributes,
    categoryIds: [],
    hasSizeChart: Boolean(sizeChartImage || sizeChartDescription),
    sizeChartImage,
    sizeChartDescription,
    slug: '',
    metaTitle: '',
    metaDescription: '',
    tags: [],
    productNotes: '',
    published: true,
    featured: false,
    aeProductId,
    aeCategoryId: getString(baseInfo.category_id) || null,
    aeRating:
      Number.parseFloat(getString(baseInfo.avg_evaluation_rating)) ||
      listItem.normalized.rating ||
      null,
    aeReviewCount:
      Number.parseInt(getString(baseInfo.evaluation_count), 10) || null,
    aeSalesCount:
      getString(baseInfo.sales_count) || listItem.normalized.orders || null,
    aeStatus: getString(baseInfo.product_status_type) || null,
  };
}

/** Apply step-1 title as fallback alt text without overwriting manual edits. */
export function applyTitleToImageAlts(form: ImportFormState): ImportFormState {
  const alt = form.name.trim().slice(0, 120);
  if (!alt) return form;

  return {
    ...form,
    productImages: form.productImages.map((img) => ({
      ...img,
      alt: img.alt.trim() || alt,
    })),
    videos: form.videos.map((v) => ({
      ...v,
      alt: v.alt?.trim() || alt,
    })),
    skus: form.skus.map((sku) => ({
      ...sku,
      images: sku.images.map((img) => ({
        ...img,
        alt: img.alt.trim() || alt,
      })),
    })),
  };
}

// ─── Variant grouping (bulk-edit helpers for large SKU matrices) ──────────────

/** Prefer grouping by visual options (color/style) over size/fit. */
const GROUP_PROPERTY_PRIORITY: Array<{ test: RegExp; score: number }> = [
  { test: /colou?r|colour|цвет|farbe|couleur/i, score: 100 },
  { test: /style|pattern|print|design|model|type/i, score: 80 },
  { test: /material|fabric|finish/i, score: 60 },
  { test: /size|尺寸|größe|taille|waist|length|fit/i, score: 20 },
];

export type SkuGroupDimension = {
  propertyName: string;
  uniqueValueCount: number;
  /** True when at least one SKU has an image on this property. */
  hasImages: boolean;
  /** Higher = better default grouping axis. */
  score: number;
};

export type SkuVariantGroup = {
  /** Stable key: propertyName + unit separator + value */
  key: string;
  propertyName: string;
  value: string;
  image: string | null;
  /** Indices into the original skus array. */
  skuIndices: number[];
};

export type VariantViewMode = 'list' | 'grouped';

/** Threshold above which grouped view is the default when grouping is possible. */
export const VARIANT_GROUP_THRESHOLD = 10;

function propertyPriorityScore(propertyName: string): number {
  for (const entry of GROUP_PROPERTY_PRIORITY) {
    if (entry.test.test(propertyName)) return entry.score;
  }
  return 40;
}

function getPropertyValue(
  sku: SkuDraft,
  propertyName: string
): string | null {
  const prop = sku.properties.find(
    (p) => p.propertyName.toLowerCase() === propertyName.toLowerCase()
  );
  if (!prop) return null;
  return prop.valueDefinitionName?.trim() || prop.value.trim() || null;
}

function getPropertyImage(
  sku: SkuDraft,
  propertyName: string
): string | null {
  const prop = sku.properties.find(
    (p) => p.propertyName.toLowerCase() === propertyName.toLowerCase()
  );
  return prop?.image ?? null;
}

/**
 * Discover property axes we can group by (Color, Size, …).
 * Ordered by usefulness for bulk price editing.
 */
export function getSkuGroupDimensions(skus: SkuDraft[]): SkuGroupDimension[] {
  const map = new Map<
    string,
    { values: Set<string>; hasImages: boolean; displayName: string }
  >();

  for (const sku of skus) {
    for (const prop of sku.properties) {
      const name = prop.propertyName.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const value = prop.valueDefinitionName?.trim() || prop.value.trim();
      if (!value) continue;

      let entry = map.get(key);
      if (!entry) {
        entry = { values: new Set(), hasImages: false, displayName: name };
        map.set(key, entry);
      }
      entry.values.add(value);
      if (prop.image) entry.hasImages = true;
    }
  }

  const dimensions: SkuGroupDimension[] = [];
  for (const entry of map.values()) {
    if (entry.values.size < 2) continue; // nothing to group
    const base = propertyPriorityScore(entry.displayName);
    const imageBonus = entry.hasImages ? 25 : 0;
    // Prefer axes that produce fewer, larger groups (better bulk edit)
    const avgGroupSize = skus.length / entry.values.size;
    const sizeBonus = Math.min(30, Math.round(avgGroupSize));
    dimensions.push({
      propertyName: entry.displayName,
      uniqueValueCount: entry.values.size,
      hasImages: entry.hasImages,
      score: base + imageBonus + sizeBonus,
    });
  }

  return dimensions.sort((a, b) => b.score - a.score || a.propertyName.localeCompare(b.propertyName));
}

/**
 * Pick the best default grouping property, or null if grouping isn't useful.
 */
export function pickDefaultGroupBy(skus: SkuDraft[]): string | null {
  const dims = getSkuGroupDimensions(skus);
  const best = dims[0];
  if (!best) return null;
  // Only auto-group when it actually collapses the list
  if (best.uniqueValueCount >= skus.length) return null;
  return best.propertyName;
}

/**
 * Group SKUs by a property axis. SKUs missing that property land in "Other".
 */
export function groupSkusByProperty(
  skus: SkuDraft[],
  propertyName: string
): SkuVariantGroup[] {
  const groups = new Map<string, SkuVariantGroup>();
  const order: string[] = [];

  skus.forEach((sku, index) => {
    const rawValue = getPropertyValue(sku, propertyName);
    const value = rawValue ?? 'Other';
    const key = `${propertyName.toLowerCase()}\u0000${value.toLowerCase()}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        propertyName,
        value,
        image: getPropertyImage(sku, propertyName) ?? sku.images[0]?.url ?? null,
        skuIndices: [],
      };
      groups.set(key, group);
      order.push(key);
    } else if (!group.image) {
      group.image =
        getPropertyImage(sku, propertyName) ?? sku.images[0]?.url ?? null;
    }
    group.skuIndices.push(index);
  });

  return order.map((k) => groups.get(k)!);
}

/**
 * Secondary option labels for a group (e.g. sizes when grouped by color).
 */
export function getSecondaryOptionLabel(
  sku: SkuDraft,
  groupPropertyName: string
): string {
  const others = sku.properties
    .filter(
      (p) =>
        p.propertyName.toLowerCase() !== groupPropertyName.toLowerCase()
    )
    .map((p) => p.valueDefinitionName?.trim() || p.value.trim())
    .filter(Boolean);
  if (others.length > 0) return others.join(' · ');
  return sku.label || 'Variant';
}

/** Shared price/compare/stock across a set of SKU indices, or null if mixed. */
export function getSharedSkuField(
  skus: SkuDraft[],
  indices: number[],
  field: 'price' | 'compareAtPrice' | 'stock'
): number | null | 'mixed' {
  if (indices.length === 0) return null;
  const firstIndex = indices[0];
  if (firstIndex === undefined) return null;
  const firstSku = skus[firstIndex];
  if (!firstSku) return null;
  const first = firstSku[field];
  for (let i = 1; i < indices.length; i++) {
    const idx = indices[i];
    if (idx === undefined) continue;
    const sku = skus[idx];
    if (!sku) continue;
    if (sku[field] !== first) return 'mixed';
  }
  return first ?? null;
}

export function canUseGroupedVariants(skus: SkuDraft[]): boolean {
  return pickDefaultGroupBy(skus) != null;
}

export function shouldDefaultToGroupedView(skus: SkuDraft[]): boolean {
  return skus.length > VARIANT_GROUP_THRESHOLD && canUseGroupedVariants(skus);
}

export const WIZARD_STEPS = [
  { id: 0, key: 'basics', label: 'Title & Description' },
  { id: 1, key: 'variants', label: 'Variants' },
  { id: 2, key: 'images', label: 'Images' },
  { id: 3, key: 'attributes', label: 'Attributes' },
  { id: 4, key: 'categories', label: 'Categories & Size' },
  { id: 5, key: 'seo', label: 'SEO & Tags' },
  { id: 6, key: 'publish', label: 'Publish' },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];

/** Selected variants must show at least this much off vs compare-at. */
export const MIN_VARIANT_DISCOUNT_PERCENT = 10;

/**
 * Percent off relative to compare-at price.
 * `null` when compare-at is missing/invalid so the discount cannot be shown.
 */
export function computeDiscountPercent(
  priceCents: number,
  compareAtCents: number | null | undefined
): number | null {
  if (
    compareAtCents == null ||
    !Number.isFinite(compareAtCents) ||
    compareAtCents <= 0
  ) {
    return null;
  }
  if (!Number.isFinite(priceCents) || priceCents < 0) return null;
  if (priceCents >= compareAtCents) return 0;
  return ((compareAtCents - priceCents) / compareAtCents) * 100;
}

/** True when compare-at yields at least `minPercent` off our price. */
export function meetsMinDiscount(
  priceCents: number,
  compareAtCents: number | null | undefined,
  minPercent: number = MIN_VARIANT_DISCOUNT_PERCENT
): boolean {
  const pct = computeDiscountPercent(priceCents, compareAtCents);
  return pct !== null && pct + 1e-9 >= minPercent;
}

export function formatDiscountPercent(percent: number | null): string | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  const rounded = Math.round(percent * 10) / 10;
  const display =
    Number.isInteger(rounded) || Math.abs(rounded - Math.round(rounded)) < 0.05
      ? String(Math.round(rounded))
      : rounded.toFixed(1);
  return `${display}% off`;
}

function validateSelectedVariants(form: ImportFormState): string | null {
  const selected = form.skus.filter((s) => s.selected && s.stock > 0);
  if (selected.length === 0) return 'Select at least one variant.';

  for (const sku of selected) {
    if (!Number.isFinite(sku.price) || sku.price < 0) {
      return `Invalid price for variant "${sku.label}".`;
    }

    if (sku.compareAtPrice == null || !Number.isFinite(sku.compareAtPrice)) {
      return `Set a Compare at price for "${sku.label}" (at least ${MIN_VARIANT_DISCOUNT_PERCENT}% off required).`;
    }

    if (sku.compareAtPrice <= 0) {
      return `Compare at price for "${sku.label}" must be greater than $0.`;
    }

    if (sku.price >= sku.compareAtPrice) {
      return `Our price for "${sku.label}" must be lower than Compare at to show a discount.`;
    }

    const discount = computeDiscountPercent(sku.price, sku.compareAtPrice);
    if (discount === null || discount < MIN_VARIANT_DISCOUNT_PERCENT) {
      const actual =
        discount === null ? '0' : (Math.round(discount * 10) / 10).toFixed(1);
      return `Variant "${sku.label}" is only ${actual}% off. Raise Compare at or lower Our price to at least ${MIN_VARIANT_DISCOUNT_PERCENT}% off.`;
    }
  }

  return null;
}

export function validateStep(
  step: number,
  form: ImportFormState
): string | null {
  if (step === 0) {
    if (!form.name.trim()) return 'Product title is required.';
    if (form.name.trim().length > 300) return 'Title is too long.';
  }
  if (step === 1) {
    return validateSelectedVariants(form);
  }
  if (step === 2) {
    const images = form.productImages.filter((i) => i.selected !== false);
    if (images.length === 0) return 'Select at least one product image.';
  }
  if (step === 3) {
    const selectedAttributes = form.attributes.filter(
      (attr) => attr.selected !== false
    );
    for (const attr of selectedAttributes) {
      if (!attr.attrName.trim() || !attr.attrValue.trim()) {
        return 'Selected attributes need both a name and a value.';
      }
    }
  }
  if (step === 4) {
    if (form.categoryIds.length === 0) {
      return 'Select or create at least one category.';
    }
  }
  if (step === 5) {
    const derivedSlug = slugify(form.name);
    if (!derivedSlug) {
      return 'Product title must produce a valid URL slug.';
    }
    if (!form.metaTitle.trim()) return 'Meta title is required.';
  }
  return null;
}

export async function markdownToHtml(md: string): Promise<string> {
  if (!md.trim()) return '';
  try {
    const { marked } = await import('marked');
    marked.setOptions({ gfm: true, breaks: true });
    const html = await marked.parse(md);
    return typeof html === 'string' ? html : String(html);
  } catch {
    // Fallback: escape and wrap paragraphs
    const escaped = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, '<br />')}</p>`)
      .join('\n');
  }
}

export function buildPublishPayload(form: ImportFormState) {
  const selectedSkus = form.skus.filter((s) => s.selected && s.stock > 0);
  const selectedImages = dedupeProductImages(form.productImages)
    .filter((i) => i.selected !== false)
    .map((img, index) => ({
      url: img.url,
      alt: img.alt || form.name.slice(0, 120),
      variantKeys: img.variantKeys,
      position: img.position ?? index,
    }));

  // Slug always derived from the product title.
  const slug = slugify(form.name.trim());

  return {
    name: form.name.trim(),
    slug,
    description: form.description,
    mobileDetailMarkdown: form.mobileDetailMarkdown,
    isAEProduct: true,
    aeProductId: form.aeProductId,
    aeCategoryId: form.aeCategoryId,
    aeRating: form.aeRating,
    aeReviewCount: form.aeReviewCount,
    aeSalesCount: form.aeSalesCount,
    aeStatus: form.aeStatus,
    images: selectedImages,
    videos: form.videos,
    mainVideo: form.mainVideo,
    categoryIds: form.categoryIds,
    hasSizeChart: form.hasSizeChart,
    sizeChartImage: form.sizeChartImage,
    sizeChartDescription: form.sizeChartDescription,
    metaTitle: form.metaTitle.trim(),
    metaDescription: form.metaDescription.trim() || null,
    tags: form.tags,
    productNotes: form.productNotes.trim() || null,
    published: form.published,
    featured: form.featured,
    skus: selectedSkus.map((sku) => ({
      aeSkuId: sku.aeSkuId === 'default' ? null : sku.aeSkuId,
      aeSkuAttr: sku.aeSkuAttr || null,
      price: sku.price,
      compareAtPrice: sku.compareAtPrice,
      aePrice: sku.aePrice,
      aeSalePrice: sku.aeSalePrice,
      stock: sku.stock,
      sku: sku.sku,
      priceIncludesTax: sku.priceIncludesTax,
      images: dedupeProductImages(sku.images)
        .filter((i) => i.selected !== false)
        .map((img, index) => ({
          url: img.url,
          alt: img.alt || `${form.name} — ${sku.label}`.slice(0, 120),
          variantKeys: img.variantKeys ?? [sku.aeSkuId],
          position: img.position ?? index,
        })),
      properties: sku.properties.map((p) => ({
        aePropertyId: p.aePropertyId,
        propertyName: p.propertyName,
        aeValueId: p.aeValueId,
        value: p.value,
        valueDefinitionName: p.valueDefinitionName,
        image: p.image,
      })),
    })),
    attributes: normalizeImportForm(form)
      .attributes.filter((attr) => attr.selected !== false)
      .map((attr, index) => ({
        aeAttrNameId: attr.aeAttrNameId,
        attrName: attr.attrName.trim(),
        aeAttrValueId: attr.aeAttrValueId,
        attrValue: attr.attrValue.trim(),
        attrValueUnit: attr.attrValueUnit?.trim() || null,
        position: index,
      })),
  };
}
