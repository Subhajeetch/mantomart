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
 * A cart is owned by exactly one identity: either an authenticated `users.id`
 * or a client-generated guest token (`guestId` persisted in localStorage).
 *
 * Guest carts carry a `guestId` and a `NULL` userId. When the guest signs in,
 * the API merges the guest cart into the user's cart and flips the guest row to
 * `merged` (so a stale client guest id can be replay-safe). The `userId` unique
 * index still guarantees only one row per user because SQLite allows any number
 * of NULLs in a UNIQUE index.
 */
export const carts = sqliteTable(
  'carts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    guestId: text('guest_id'),
    status: text('status', { enum: cartStatuses }).notNull().default('active'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    index('carts_user_id_idx').on(table.userId),
    uniqueIndex('carts_user_id_uidx').on(table.userId),
    index('carts_guest_id_idx').on(table.guestId),
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
    selected: integer('selected', { mode: 'boolean' }).notNull().default(true),
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
    addressId: text('address_id'),
    addressSnapshot: text('address_snapshot', { mode: 'json' }).$type<Record<string, unknown> | null>().default(null),
    shippingSelection: text('shipping_selection', { mode: 'json' }).$type<Array<{
      itemId: string;
      quoteId: string;
      serviceName: string;
      logisticsServiceName: string;
      amountCents: number;
      currency: string;
      minDays: number | null;
      maxDays: number | null;
    }> | null>().default(null),
    shippingTotal: integer('shipping_total').notNull().default(0),
    paypalOrderId: text('paypal_order_id'),
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

export const orderStatuses = [
  'ordered',
  'processing',
  'fulfilled',
  'cancelled',
  'refunded',
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export const paymentStatuses = ['pending', 'paid', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];

export type OrderItemSnapshot = {
  productId: string;
  skuId: string;
  aeProductId: string | null;
  aeSkuId: string | null;
  quantity: number;
  unitPriceCents: number;
  productName: string;
  productSlug: string;
  variantLabel: string | null;
  image: string | null;
};

export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    checkoutSessionId: text('checkout_session_id')
      .notNull()
      .references(() => checkoutSessions.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text('status', { enum: orderStatuses }).notNull().default('ordered'),
    paymentStatus: text('payment_status', { enum: paymentStatuses }).notNull().default('paid'),
    paymentMethod: text('payment_method').notNull(),
    paymentProviderOrderId: text('payment_provider_order_id').notNull(),
    paymentTransactionId: text('payment_transaction_id'),
    currency: text('currency').notNull().default('USD'),
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingTotalCents: integer('shipping_total_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email').notNull(),
    customerPhone: text('customer_phone').notNull(),
    addressSnapshot: text('address_snapshot', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    itemsSnapshot: text('items_snapshot', { mode: 'json' }).$type<OrderItemSnapshot[]>().notNull(),
    shippingSnapshot: text('shipping_snapshot', { mode: 'json' }).$type<Array<{
      itemId: string;
      quoteId: string;
      serviceName: string;
      amountCents: number;
      currency: string;
      minDays: number | null;
      maxDays: number | null;
    }>>().notNull(),
    isFulfilled: integer('is_fulfilled', { mode: 'boolean' }).notNull().default(false),
    fulfilledAt: integer('fulfilled_at', { mode: 'timestamp' }),
    aeOrderId: text('ae_order_id'),
    aeRawRes: text('ae_raw_res', { mode: 'json' }).$type<unknown>(),
    cancelReason: text('cancel_reason'),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp' }),
    lastAddressChangedAt: integer('last_address_changed_at', { mode: 'timestamp' }),
    addressChangeHistory: text('address_change_history', { mode: 'json' })
      .$type<Array<{ changedAt: string; previousAddress: Record<string, unknown>; newAddress: Record<string, unknown>; reason?: string }>>()
      .notNull()
      .default([]),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => [
    uniqueIndex('orders_checkout_session_uidx').on(table.checkoutSessionId),
    index('orders_user_id_created_at_idx').on(table.userId, table.createdAt),
    index('orders_status_created_at_idx').on(table.status, table.createdAt),
    index('orders_is_fulfilled_idx').on(table.isFulfilled),
    index('orders_ae_order_id_idx').on(table.aeOrderId),
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