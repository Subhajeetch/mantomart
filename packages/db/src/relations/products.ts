import { relations } from "drizzle-orm";
import {
  products,
  productSkus,
  skuProperties,
  productAttributes,
  productCategories,
} from "../schema/products";
import { categories } from "../schema/categories";

export const productsRelations = relations(products, ({ one, many }) => ({
  // Optional primary category (legacy / convenience)
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  // Many-to-many category assignments
  productCategories: many(productCategories),
  // One product has many SKUs
  skus: many(productSkus),
  // One product has many attributes (Brand, Material, etc.)
  attributes: many(productAttributes),
}));

export const productCategoriesRelations = relations(
  productCategories,
  ({ one }) => ({
    product: one(products, {
      fields: [productCategories.productId],
      references: [products.id],
    }),
    category: one(categories, {
      fields: [productCategories.categoryId],
      references: [categories.id],
    }),
  })
);

export const productSkusRelations = relations(productSkus, ({ one, many }) => ({
  // Each SKU belongs to one product
  product: one(products, {
    fields: [productSkus.productId],
    references: [products.id],
  }),
  // Each SKU has many properties (Size:L, Color:Beige)
  properties: many(skuProperties),
}));

export const skuPropertiesRelations = relations(skuProperties, ({ one }) => ({
  sku: one(productSkus, {
    fields: [skuProperties.skuId],
    references: [productSkus.id],
  }),
}));

export const productAttributesRelations = relations(
  productAttributes,
  ({ one }) => ({
    product: one(products, {
      fields: [productAttributes.productId],
      references: [products.id],
    }),
  })
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "subcategories",
  }),
  children: many(categories, { relationName: "subcategories" }),
  // Legacy primary-category products
  products: many(products),
  // Many-to-many join rows
  productCategories: many(productCategories),
}));
