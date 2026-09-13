import {
  integer,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { products, productSkus } from './products';
import { users } from './auth';

export const cartStatuses = ['active', 'merged', 'converted', 'abandoned'] as const;
export type CartStatus = (typeof cartStatuses)[number];

export const checkoutSources = ['cart', 'buy_now'] as const;
export type CheckoutSource = (typeof checkoutSources)[number];

export const checkoutStatuses = [
  'pending',
  'awaiting_payment',
  'completed',
  'expired',
  'cancelled',
] as const;
export type CheckoutStatus = (typeof checkoutStatuses)[number];

/**
 * Carts are deliberately user-owned in this application. Guest carts are not
 * exposed by the API, so every cart query can be scoped to the authenticated
 * user without accepting a client-supplied owner id.
 */
export const carts = sqliteTable(
  'carts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: cartStatuses }).notNull().default('active'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('carts_user_id_idx').on(table.userId),
    uniqueIndex('carts_user_id_uidx').on(table.userId),
    index('carts_status_updated_at_idx').on(table.status, table.updatedAt),
  ]
);

export const cartItems = sqliteTable(
  'cart_items',
  {
    id: text('id').primaryKey(),
    cartId: text('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    skuId: text('sku_id')
      .notNull()
      .references(() => productSkus.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    unitPriceSnapshot: integer('unit_price_snapshot').notNull(),
    compareAtPriceSnapshot: integer('compare_at_price_snapshot'),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    productSlugSnapshot: text('product_slug_snapshot').notNull(),
    variantLabelSnapshot: text('variant_label_snapshot'),
    imageSnapshot: text('image_snapshot'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('cart_items_cart_id_idx').on(table.cartId),
    index('cart_items_sku_id_idx').on(table.skuId),
    uniqueIndex('cart_items_cart_sku_uidx').on(table.cartId, table.skuId),
  ]
);

export const checkoutSessions = sqliteTable(
  'checkout_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source', { enum: checkoutSources }).notNull(),
    status: text('status', { enum: checkoutStatuses }).notNull().default('pending'),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('checkout_sessions_user_id_idx').on(table.userId),
    index('checkout_sessions_status_idx').on(table.status),
    index('checkout_sessions_expires_at_idx').on(table.expiresAt),
  ]
);

export const checkoutSessionItems = sqliteTable(
  'checkout_session_items',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => checkoutSessions.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    skuId: text('sku_id')
      .notNull()
      .references(() => productSkus.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    unitPriceSnapshot: integer('unit_price_snapshot').notNull(),
    compareAtPriceSnapshot: integer('compare_at_price_snapshot'),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    productSlugSnapshot: text('product_slug_snapshot').notNull(),
    variantLabelSnapshot: text('variant_label_snapshot'),
    imageSnapshot: text('image_snapshot'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('checkout_session_items_session_id_idx').on(table.sessionId),
    uniqueIndex('checkout_session_items_session_sku_uidx').on(
      table.sessionId,
      table.skuId
    ),
  ]
);