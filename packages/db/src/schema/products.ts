import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { categories } from "./categories";

// ─── Products ─────────────────────────────────────────────────────────────────

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),

  //core info (ae: ae_item_base_info_dto)
  name: text("name").notNull(),
  description: text("description"),
  mobileDetail: text("mobile_detail"),
  hasSizeChart: integer("has_size_chart", { mode: "boolean" }).notNull().default(false),
  sizeChartImage: text("size_chart_image"),
  sizeChartDescription: text("size_chart_description"),

  // ── Our pricing (what we charge the customer) ──
  // Always stored in cents. We mark up from AE price.
  price: integer("price").notNull(),
  compareAtPrice: integer("compare_at_price"),         // strikethrough "was" price

  // ── AliExpress source info ──
  isAEProduct: integer("is_ae_product", { mode: "boolean" }).notNull().default(false),
  aeProductId: text("ae_product_id").unique(),         // ae: product_id
  aeCategoryId: text("ae_category_id"),                // ae: category_id
  aeRating: real("ae_rating"),                         // ae: avg_evaluation_rating
  aeReviewCount: integer("ae_review_count"),           // ae: evaluation_count
  aeSalesCount: text("ae_sales_count"),                // ae: sales_count (can be "1000+")
  aeStatus: text("ae_status"),                         // ae: product_status_type "onSelling"
  aeHasWholesale: integer("ae_has_wholesale", { mode: "boolean" }).default(false),
  aeCurrencyCode: text("ae_currency_code"),            // ae: currency_code (source currency)
  aeLastSynced: integer("ae_last_synced", { mode: "timestamp" }),

  // ── Media ──
  // ae: image_urls is semicolon-separated — we split and store as JSON array
  images: text("images", { mode: "json" }).$type<string[]>().default([]),
  videoUrl: text("video_url"),
  videoPosterUrl: text("video_poster_url"),

  // ── Organisation ──
  categoryId: text("category_id").references(() => categories.id),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  position: integer("position").notNull().default(0),

  // ── SEO ──
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  tags: text("tags", { mode: "json" }).$type<string[]>().default([]),

  // analytics
  orderCount: integer("order_count").notNull().default(0),
  totalRevenue: integer("total_revenue").notNull().default(0), // in cents
  

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ─── Product SKUs ─────────────────────────────────────────────────────────────
// Each row = one variant. e.g. Size:L + Color:Beige is one SKU.
// ae: ae_item_sku_info_dtos.ae_item_sku_info_d_t_o[]

export const productSkus = sqliteTable("product_skus", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),

  aeSkuId: text("ae_sku_id"),                          // ae: sku_id
  aeSkuAttr: text("ae_sku_attr"),                      // ae: sku_attr "5:361385;14:771#036"

  // Our price for this specific variant (cents)
  price: integer("price").notNull(),
  compareAtPrice: integer("compare_at_price"),

  // AE source prices — kept for reference/markup calculation
  aePrice: integer("ae_price"),                        // ae: sku_price (cents)
  aeSalePrice: integer("ae_sale_price"),               // ae: offer_sale_price (cents)

  stock: integer("stock").notNull().default(0),        // ae: sku_available_stock
  sku: text("sku"),                                    // our internal SKU code
  priceIncludesTax: integer("price_includes_tax", { mode: "boolean" }).default(false),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── SKU Properties ───────────────────────────────────────────────────────────
// Each SKU has multiple properties. e.g. one row for Size:L, one row for Color:Beige
// ae: ae_sku_property_dtos.ae_sku_property_d_t_o[]

export const skuProperties = sqliteTable("sku_properties", {
  id: text("id").primaryKey(),
  skuId: text("sku_id")
    .notNull()
    .references(() => productSkus.id, { onDelete: "cascade" }),

  aePropertyId: text("ae_property_id"),                // ae: sku_property_id  e.g. 5
  propertyName: text("property_name").notNull(),        // ae: sku_property_name e.g. "Size"
  aeValueId: text("ae_value_id"),                      // ae: property_value_id e.g. 361385
  value: text("value").notNull(),                      // ae: sku_property_value e.g. "L"
  // ae: property_value_definition_name e.g. "036" (colour code)
  valueDefinitionName: text("value_definition_name"),
  // ae: sku_image — only present on the property that has an image (usually colour)
  image: text("image"),
});

// ─── Product Attributes ───────────────────────────────────────────────────────
// Generic key-value product specs like Brand, Material, Style, etc.
// ae: ae_item_properties.ae_item_property[]

export const productAttributes = sqliteTable("product_attributes", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),

  aeAttrNameId: text("ae_attr_name_id"),               // ae: attr_name_id
  attrName: text("attr_name").notNull(),               // ae: attr_name  e.g. "Material"
  aeAttrValueId: text("ae_attr_value_id"),             // ae: attr_value_id
  attrValue: text("attr_value").notNull(),             // ae: attr_value e.g. "COTTON"
  attrValueUnit: text("attr_value_unit"),              // ae: attr_value_unit e.g. "piece"
  position: integer("position").notNull().default(0),
});