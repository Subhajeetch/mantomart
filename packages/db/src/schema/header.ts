import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core";

import { categories } from "./categories";

/**
 * Recursive header menu tree.
 *
 * Examples:
 *
 * Fashion (root)
 * ├── Men
 * │   ├── Tops
 * │   └── Jeans
 * └── Women
 *     ├── Dresses
 *     └── Shoes
 */
export const headerMenuNodes = sqliteTable(
  "header_menu_nodes",
  {
    id: text("id").primaryKey(),

    /**
     * Null = top-level header item
     */
    parentId: text("parent_id").references(
      (): any => headerMenuNodes.id,
      { onDelete: "cascade" }
    ),

    /**
     * Optional category this node points to.
     * If null, it's just a grouping node.
     */
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),

    /**
     * Used when the menu item is NOT a category.
     */
    customUrl: text("custom_url"),

    /**
     * Optional override.
     *
     * If null:
     *  - uses category.name
     */
    title: text("title"),

    /**
     * mega
     * dropdown
     * simple
     */
    layout: text("layout").notNull().default("mega"),
    featured: integer("featured", { mode: "boolean" })
      .notNull()
      .default(false),

    position: integer("position").notNull().default(0),

    isVisible: integer("is_visible", { mode: "boolean" })
      .notNull()
      .default(true),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),

    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("header_menu_parent_idx").on(table.parentId),
    index("header_menu_category_idx").on(table.categoryId),
    index("header_menu_position_idx").on(table.position),
    index("header_menu_visible_idx").on(table.isVisible),
  ]
);

export type HeaderMenuNode = typeof headerMenuNodes.$inferSelect;
export type NewHeaderMenuNode = typeof headerMenuNodes.$inferInsert;