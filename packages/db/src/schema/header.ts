import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Top-level storefront header collections (e.g. Fashion, Tech).
 * Soft cap of 5 visible collections is enforced in the admin API.
 */
export const headerCollections = sqliteTable(
  "header_collections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    /** Optional override URL; store falls back to `/c/{slug}`. */
    href: text("href"),
    description: text("description"),
    image: text("image"),
    position: integer("position").notNull().default(0),
    isVisible: integer("is_visible", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("header_collections_position_idx").on(table.position),
    index("header_collections_visible_idx").on(table.isVisible),
  ]
);

/**
 * Sub-links under a header collection (mega-menu / dropdown items).
 */
export const headerCollectionItems = sqliteTable(
  "header_collection_items",
  {
    id: text("id").primaryKey(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => headerCollections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Optional override URL; store falls back to `/c/{collectionSlug}/{slug}`. */
    href: text("href"),
    description: text("description"),
    image: text("image"),
    position: integer("position").notNull().default(0),
    isVisible: integer("is_visible", { mode: "boolean" })
      .notNull()
      .default(true),
    featured: integer("featured", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("header_collection_items_collection_id_idx").on(table.collectionId),
    index("header_collection_items_position_idx").on(table.position),
    uniqueIndex("header_collection_items_collection_slug_uidx").on(
      table.collectionId,
      table.slug
    ),
  ]
);

export type HeaderCollection = typeof headerCollections.$inferSelect;
export type HeaderCollectionItem = typeof headerCollectionItems.$inferSelect;
