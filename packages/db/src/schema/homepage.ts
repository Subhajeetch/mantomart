import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const HOMEPAGE_BLOCK_TYPES = [
  "promo_slider",
  "product_grid",
  "category_cta",
  "product_feed",
] as const;

export type HomepageBlockType = (typeof HOMEPAGE_BLOCK_TYPES)[number];

export type PromoSlideAudience = "all" | "new_user";

export type PromoSlideConfigItem = {
  id: string;
  imageUrl: string;
  mobileImageUrl?: string;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
  audience: PromoSlideAudience;
  discountLabel?: string;
};

export type PromoSliderConfig = {
  type: "promo_slider";
  slides: PromoSlideConfigItem[];
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
