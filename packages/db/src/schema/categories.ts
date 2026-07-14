import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Hierarchical product categories (max depth enforced in API = 4).
 * parentId null = root category.
 */
export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(), // "mens-shirts"
    name: text("name").notNull(), // "Men's Shirts"
    description: text("description"),
    image: text("image"),
    parentId: text("parent_id"), // null = root; self-ref enforced in app layer
    position: integer("position").notNull().default(0), // sibling ordering
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("categories_parent_id_idx").on(table.parentId),
    index("categories_position_idx").on(table.position),
  ]
);
