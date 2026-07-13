import type {
  products,
  productSkus,
  skuProperties,
  productAttributes,
} from "./schema/products";
import type { categories } from "./schema/categories";
import type { auditLogs } from "./schema/audit-logs";

// ─── Inferred row types ───────────────────────────────────────────────────────

export type Product        = typeof products.$inferSelect;
export type NewProduct     = typeof products.$inferInsert;

export type ProductSku     = typeof productSkus.$inferSelect;
export type NewProductSku  = typeof productSkus.$inferInsert;

export type SkuProperty    = typeof skuProperties.$inferSelect;
export type NewSkuProperty = typeof skuProperties.$inferInsert;

export type ProductAttribute    = typeof productAttributes.$inferSelect;
export type NewProductAttribute = typeof productAttributes.$inferInsert;

export type Category    = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export type AuditLog    = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

// ─── Composite types (with relations) ────────────────────────────────────────
// Use these when you query with .with() in drizzle

export type SkuWithProperties = ProductSku & {
  properties: SkuProperty[];
};

export type ProductWithRelations = Product & {
  category: Category | null;
  skus: SkuWithProperties[];
  attributes: ProductAttribute[];
};