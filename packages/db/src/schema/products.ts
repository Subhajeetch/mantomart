import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { categories } from './categories';
import { users } from './auth';

// ─── Media types (JSON columns) ───────────────────────────────────────────────
// Product gallery images carry an optional forVariant label so the storefront
// can compose alt text as `productName + forVariant` (typically a colour name,
// never a size like S/M/L). variantKeys let the gallery filter when a variant
// is selected. SKU rows also store their own images array for variant media.

export type ProductImage = {
  /** Absolute or protocol-relative image URL */
  url: string;
  /**
   * Colour / visual-variant label used to compose image alt text as
   * `productName + forVariant` (e.g. "Silk Scarf Red").
   * Store only the colour (or other visual option) — not size values such as
   * S, M, L, XXL. Omit when the image is not tied to a colour variant; alt
   * then falls back to the product name alone.
   */
  forVariant?: string;
  /**
   * Optional keys that link this image to one or more variants.
   * Typical values: ae property value id, "propertyName:value", or aeSkuId.
   */
  variantKeys?: string[];
  /** Display order (ascending). */
  position?: number;
  /** isOptimised — smaller card-sized copy hosted alongside the full image. */
  isOp?: boolean;
};

/**
 * Images loaded from JSON may still carry a legacy `alt` field from products
 * saved before `forVariant`. Never write `alt` on new/updated images.
 */
export type ProductImageRecord = ProductImage & {
  alt?: string;
};

/**
 * Compose the HTML `alt` attribute for a product image.
 * Prefer `productName + forVariant`. Fall back to a legacy stored `alt`
 * (pre-forVariant products) then the product name alone.
 */
export function composeProductImageAlt(
  productName: string,
  image: ProductImageRecord | null | undefined
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

export type ProductPriceRange = {
  /** Lowest and highest value across all product SKUs, in cents. */
  from: number | null;
  to: number | null;
};

/**
 * Cached product-level pricing for list and card views.
 *
 * This is deliberately stored on the product so lightweight product queries do
 * not need to load the potentially large product_skus rows. The range is
 * refreshed whenever SKU data is written and can be backfilled by admins.
 */
export type ProductDefaultPrice = {
  normalPrice: ProductPriceRange;
  comparedPrice: ProductPriceRange;
};

export type ProductSkuPriceInput = {
  price: number;
  compareAtPrice: number | null;
};

export function calculateProductDefaultPrice(
  skus: readonly ProductSkuPriceInput[]
): ProductDefaultPrice | null {
  const normalPrices = skus
    .map((sku) => sku.price)
    .filter((price) => Number.isFinite(price));
  if (normalPrices.length === 0) return null;

  const comparedPrices = skus
    .map((sku) => sku.compareAtPrice)
    .filter(
      (price): price is number => price !== null && Number.isFinite(price)
    );

  return {
    normalPrice: {
      from: Math.min(...normalPrices),
      to: Math.max(...normalPrices),
    },
    comparedPrice: {
      from: comparedPrices.length > 0 ? Math.min(...comparedPrices) : null,
      to: comparedPrices.length > 0 ? Math.max(...comparedPrices) : null,
    },
  };
}

// ─── Products ─────────────────────────────────────────────────────────────────

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),

    // core info (ae: ae_item_base_info_dto)
    name: text('name').notNull(),
    description: text('description'),
    /** HTML body (converted from markdown in the admin import wizard). */
    mobileDetail: text('mobile_detail'),
    hasSizeChart: integer('has_size_chart', { mode: 'boolean' })
      .notNull()
      .default(false),
    sizeChartImage: text('size_chart_image'),
    sizeChartDescription: text('size_chart_description'),

    /**
     * Cached SKU price ranges for lightweight product cards and lists.
     * Values are cents; `from` is the lowest SKU value and `to` is the highest.
     * Keep this synchronized whenever product SKUs are created or replaced.
     */
    defaultPrice: text('default_price', { mode: 'json' })
      .$type<ProductDefaultPrice | null>()
      .default(null),

    // ── AliExpress source info ──
    isAEProduct: integer('is_ae_product', { mode: 'boolean' })
      .notNull()
      .default(false),
    aeProductId: text('ae_product_id').unique(), // ae: product_id
    aeCategoryId: text('ae_category_id'), // ae: category_id
    aeRating: real('ae_rating'), // ae: avg_evaluation_rating
    aeReviewCount: integer('ae_review_count'), // ae: evaluation_count
    aeSalesCount: text('ae_sales_count'), // ae: sales_count (can be "1000+")
    aeStatus: text('ae_status'), // ae: product_status_type "onSelling"
    aeLastSynced: integer('ae_last_synced', { mode: 'timestamp' }),

    // ── Media ──
    images: text('images', { mode: 'json' })
      .$type<ProductImage[]>()
      .default([]),
    videos: text('videos', { mode: 'json' })
      .$type<ProductVideo[]>()
      .default([]),
    mainVideo: text('main_video'),

    // ── Organisation ──
    // Optional primary category (legacy / AE import convenience).
    // Multi-category assignments live in `product_categories`.
    categoryId: text('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    published: integer('published', { mode: 'boolean' })
      .notNull()
      .default(false),
    featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
    position: integer('position').notNull().default(0),

    // ── SEO ──
    metaTitle: text('meta_title'),
    metaDescription: text('meta_description'),
    tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),

    // analytics
    /**
     * Times this product has been ordered.
     * UPDATE this while completing an order on the API.
     * ALSO increment `admin_stats.orders_count` for `product_added_by`
     * (see `applyAdminStatsDelta` in apps/api/src/utils/adminStats.ts).
     */
    orderCount: integer('order_count').notNull().default(0),
    /**
     * Gross revenue in cents from completed orders of this product.
     * UPDATE this while completing an order on the API.
     * ALSO add the same cents to `admin_stats.revenue_cents` for `product_added_by`.
     */
    totalRevenue: integer('total_revenue').notNull().default(0),
    /**
     * Cumulative estimated profit from completed orders (cents).
     * UPDATE this while completing an order on the API — not set at product create time.
     * ALSO add the same cents to `admin_stats.profit_cents` for `product_added_by`.
     */
    revenueInProfit: integer('revenue_in_profit').notNull().default(0),

    // for admins
    productAddedBy: text('product_added_by').references(() => users.id),
    productNotes: text('product_notes'),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('products_category_id_idx').on(table.categoryId),
    index('products_product_added_by_idx').on(table.productAddedBy),
    index('products_published_position_id_idx').on(
      table.published,
      table.position,
      table.id
    ),
    index('products_published_featured_position_id_idx').on(
      table.published,
      table.featured,
      table.position,
      table.id
    ),
  ]
);

// ─── Product ↔ Category (many-to-many) ────────────────────────────────────────
// A product can belong to multiple categories (e.g. Fashion + Fashion>Women>Jewellery).
// Deleting a category cascades these rows; sole-category protection is enforced in API.

export const productCategories = sqliteTable(
  'product_categories',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    uniqueIndex('product_categories_product_category_uidx').on(
      table.productId,
      table.categoryId
    ),
    index('product_categories_category_id_idx').on(table.categoryId),
    index('product_categories_product_id_idx').on(table.productId),
  ]
);

// ─── Product SKUs ─────────────────────────────────────────────────────────────
// Each row = one variant. e.g. Size:L + Color:Beige is one SKU.
// ae: ae_item_sku_info_dtos.ae_item_sku_info_d_t_o[]

export const productSkus = sqliteTable(
  'product_skus',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),

    aeSkuId: text('ae_sku_id'), // ae: sku_id
    aeSkuAttr: text('ae_sku_attr'), // ae: sku_attr "5:361385;14:771#036"

    // Our price for this specific variant (cents)
    price: integer('price').notNull(),
    compareAtPrice: integer('compare_at_price'),

    // AE source prices — kept for reference/markup calculation
    aePrice: integer('ae_price'), // ae: sku_price (cents)
    aeSalePrice: integer('ae_sale_price'), // ae: offer_sale_price (cents)

    /**
     * Estimated profit for this variant in cents.
     * Computed server-side as: our price − AE actual price − $1.50 (processor/tax buffer).
     * Null when AE cost is unknown (manual products without AE prices).
     */
    estProfit: integer('est_profit'),

    stock: integer('stock').notNull().default(0), // ae: sku_available_stock
    sku: text('sku'), // our internal SKU code
    priceIncludesTax: integer('price_includes_tax', {
      mode: 'boolean',
    }).default(false),

    /**
     * Images belonging to this variant.
     * Alt text is composed as `productName + forVariant` (see ProductImage).
     * Used on the storefront when a shopper selects this SKU.
     */
    images: text('images', { mode: 'json' })
      .$type<ProductImage[]>()
      .default([]),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('product_skus_product_id_idx').on(table.productId),
    index('product_skus_product_id_price_id_idx').on(
      table.productId,
      table.price,
      table.id
    ),
  ]
);

// ─── SKU Properties ───────────────────────────────────────────────────────────
// Each SKU has multiple properties. e.g. one row for Size:L, one row for Color:Beige
// ae: ae_sku_property_dtos.ae_sku_property_d_t_o[]

export const skuProperties = sqliteTable(
  'sku_properties',
  {
    id: text('id').primaryKey(),
    skuId: text('sku_id')
      .notNull()
      .references(() => productSkus.id, { onDelete: 'cascade' }),

    aePropertyId: text('ae_property_id'), // ae: sku_property_id  e.g. 5
    propertyName: text('property_name').notNull(), // ae: sku_property_name e.g. "Size"
    aeValueId: text('ae_value_id'), // ae: property_value_id e.g. 361385
    value: text('value').notNull(), // ae: sku_property_value e.g. "L"
    // ae: property_value_definition_name e.g. "036" (colour code)
    valueDefinitionName: text('value_definition_name'),
    // ae: sku_image — only present on the property that has an image (usually colour)
    image: text('image'),
  },
  (table) => [index('sku_properties_sku_id_idx').on(table.skuId)]
);

// ─── Product Attributes ───────────────────────────────────────────────────────
// Generic key-value product specs like Brand, Material, Style, etc.
// ae: ae_item_properties.ae_item_property[]

export const productAttributes = sqliteTable(
  'product_attributes',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),

    aeAttrNameId: text('ae_attr_name_id'), // ae: attr_name_id
    attrName: text('attr_name').notNull(), // ae: attr_name  e.g. "Material"
    aeAttrValueId: text('ae_attr_value_id'), // ae: attr_value_id
    attrValue: text('attr_value').notNull(), // ae: attr_value e.g. "COTTON"
    attrValueUnit: text('attr_value_unit'), // ae: attr_value_unit e.g. "piece"
    position: integer('position').notNull().default(0),
  },
  (table) => [
    index('product_attributes_product_id_idx').on(table.productId),
    index('product_attributes_product_id_position_idx').on(
      table.productId,
      table.position,
      table.attrName
    ),
  ]
);
