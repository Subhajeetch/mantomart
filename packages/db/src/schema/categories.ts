import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),        // "mens-shirts"
  name: text("name").notNull(),                 // "Men's Shirts"
  description: text("description"),
  image: text("image"),
  parentId: text("parent_id"),                  // null = root category
  position: integer("position").notNull().default(0), // for ordering
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});