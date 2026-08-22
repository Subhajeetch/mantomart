import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const HOMEPAGE_BLOCK_TYPES = [
  "promo_slider",
  "product_grid",
  "category_cta",
  "product_feed",
] as const;

export type HomepageBlockType = (typeof HOMEPAGE_BLOCK_TYPES)[number];

export const PROMO_SLIDE_LAYOUTS = [
  "deals_banner",
  "welcome_deal",
  "split_products",
  "flash_row",
  "stack_showcase",
] as const;

export type PromoSlideLayout = (typeof PROMO_SLIDE_LAYOUTS)[number];

/** Stored for existing image-based slides; not offered when creating new ones. */
export type PromoSlideLayoutOrLegacy = PromoSlideLayout | "legacy";

export const PROMO_SLIDE_THEMES = [
  "primary",
  "warm",
  "cool",
  "forest",
  "sunset",
  "slate",
] as const;

export type PromoSlideTheme = (typeof PROMO_SLIDE_THEMES)[number];

export const PROMO_LINK_KINDS = ["product", "category", "custom"] as const;

export type PromoLinkKind = (typeof PROMO_LINK_KINDS)[number];

export type PromoSlideAudience = "all" | "new_user";

/**
 * Click target for a slide region (whole slide, title/CTA, product card, offer).
 * Product/category ids are resolved to `/product/{slug}` and `/category/{slug}`
 * on the public homepage. Snapshot name/slug fields are admin-only convenience.
 */
export type PromoLinkConfig = {
  kind: PromoLinkKind;
  productId?: string;
  productName?: string;
  productSlug?: string;
  categoryId?: string;
  categoryName?: string;
  categorySlug?: string;
  href?: string;
};

export type PromoSlideProductSlot = {
  id: string;
  productId: string;
  name?: string;
  slug?: string;
  imageUrl?: string;
  imageAlt?: string;
  price?: number;
  compareAtPrice?: number;
  discountLabel?: string;
  salePriceCents?: number;
  compareAtOverrideCents?: number;
  link?: PromoLinkConfig;
};

export type PromoSlideOffer = {
  id: string;
  title: string;
  subtitle?: string;
  code?: string;
  link?: PromoLinkConfig;
};

export type PromoSlideConfigItem = {
  id: string;
  layout: PromoSlideLayoutOrLegacy;
  audience: PromoSlideAudience;
  theme?: PromoSlideTheme;
  kicker?: string;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  endsAt?: string;
  graphicTitle?: string;
  graphicSubtitle?: string;
  slideLink?: PromoLinkConfig;
  titleLink?: PromoLinkConfig;
  products?: PromoSlideProductSlot[];
  offers?: PromoSlideOffer[];
  /** Legacy image slides only. New slides never persist these. */
  imageUrl?: string;
  mobileImageUrl?: string;
  ctaHref?: string;
  discountLabel?: string;
};

export type PromoSliderConfig = {
  type: "promo_slider";
  slides: PromoSlideConfigItem[];
};

export const PROMO_SLIDE_LAYOUT_META: Record<
  PromoSlideLayout,
  { productSlots: number; offerSlots: number; hasGraphic: boolean }
> = {
  deals_banner: { productSlots: 1, offerSlots: 3, hasGraphic: true },
  welcome_deal: { productSlots: 3, offerSlots: 0, hasGraphic: false },
  split_products: { productSlots: 4, offerSlots: 0, hasGraphic: false },
  flash_row: { productSlots: 4, offerSlots: 0, hasGraphic: false },
  stack_showcase: { productSlots: 3, offerSlots: 0, hasGraphic: false },
};

export type ProductGridConfig = {
  type: "product_grid";
  source: "category" | "featured";
  categoryId?: string;
  limit: number;
};

export type CategoryCtaButtonConfig = {
  id: string;
  label: string;
  categoryId: string;
  href?: string;
};

export type CategoryCtaConfig = {
  type: "category_cta";
  title?: string;
  subtitle?: string;
  buttons: CategoryCtaButtonConfig[];
};

export type ProductFeedConfig = {
  type: "product_feed";
  pageSize: number;
};

export type HomepageBlockConfig =
  | PromoSliderConfig
  | ProductGridConfig
  | CategoryCtaConfig
  | ProductFeedConfig;

/**
 * Ordered storefront homepage sections (Shopify-style blocks).
 *
 * Invariant (enforced in API, not DB): at most one `product_feed` row,
 * and it must be last by (position, id).
 */
export const homepageBlocks = sqliteTable(
  "homepage_blocks",
  {
    id: text("id").primaryKey(),

    blockType: text("block_type", {
      enum: HOMEPAGE_BLOCK_TYPES,
    }).notNull(),

    config: text("config", { mode: "json" })
      .$type<HomepageBlockConfig>()
      .notNull(),

    position: integer("position").notNull().default(0),

    isVisible: integer("is_visible", { mode: "boolean" })
      .notNull()
      .default(true),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),

    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("homepage_blocks_position_idx").on(table.position),
    index("homepage_blocks_visible_idx").on(table.isVisible),
    index("homepage_blocks_type_idx").on(table.blockType),
  ]
);

export type HomepageBlock = typeof homepageBlocks.$inferSelect;
export type NewHomepageBlock = typeof homepageBlocks.$inferInsert;

export function isHomepageBlockType(
  value: unknown
): value is HomepageBlockType {
  return (
    value === "promo_slider" ||
    value === "product_grid" ||
    value === "category_cta" ||
    value === "product_feed"
  );
}

export function isPromoSlideLayout(value: unknown): value is PromoSlideLayout {
  return (
    value === "deals_banner" ||
    value === "welcome_deal" ||
    value === "split_products" ||
    value === "flash_row" ||
    value === "stack_showcase"
  );
}

export function isPromoSlideTheme(value: unknown): value is PromoSlideTheme {
  return (
    value === "primary" ||
    value === "warm" ||
    value === "cool" ||
    value === "forest" ||
    value === "sunset" ||
    value === "slate"
  );
}

export function isPromoLinkKind(value: unknown): value is PromoLinkKind {
  return value === "product" || value === "category" || value === "custom";
}
