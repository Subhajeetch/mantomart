import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  check,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * Denormalized per-admin contribution leaderboard.
 *
 * One row per contributor (current staff, or anyone who has ever added a
 * product). Rankings are computed at read time — never stored.
 *
 * Counters are maintained incrementally from product / order APIs so the
 * stats page stays a cheap indexed read. `POST /api/admin-stats/sync`
 * rebuilds every row from the source-of-truth tables (needed for products
 * that were imported before this table existed, and as a self-heal).
 *
 * Money columns are integer cents, matching `products.total_revenue`.
 */
export const adminStats = sqliteTable(
  "admin_stats",
  {
    /** Same id as `users.id`. Cascade-delete if the user is hard-deleted. */
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),

    /**
     * Products this admin imported / created.
     *
     * UPDATE this when creating a product on the API (increment +1).
     * UPDATE this when deleting a product on the API (decrement, never below 0).
     * See `applyAdminStatsDelta` in apps/api/src/utils/adminStats.ts.
     */
    productsAdded: integer("products_added").notNull().default(0),

    /**
     * Sum of `products.order_count` for products this admin added
     * (how many times their products were ordered).
     *
     * UPDATE this while completing an order on the API:
     *   increment by 1 per line/product that belongs to this admin
     *   (same rule as `products.order_count`).
     * See `applyAdminStatsDelta` in apps/api/src/utils/adminStats.ts.
     */
    ordersCount: integer("orders_count").notNull().default(0),

    /**
     * Distinct products of this admin that have received at least one order.
     *
     * UPDATE this while completing an order on the API:
     *   increment by 1 only when that product's `order_count` goes from 0 → 1.
     */
    productsWithOrders: integer("products_with_orders").notNull().default(0),

    /**
     * Gross revenue in cents from completed orders of this admin's products.
     * Mirrors `sum(products.total_revenue)` grouped by `product_added_by`.
     *
     * UPDATE this while completing an order on the API:
     *   add the line total (cents) attributed to this admin's product.
     */
    revenueCents: integer("revenue_cents").notNull().default(0),

    /**
     * Estimated profit in cents from completed orders of this admin's products.
     * Mirrors `sum(products.revenue_in_profit)` grouped by `product_added_by`.
     *
     * UPDATE this while completing an order on the API:
     *   add the estimated profit (cents) for the line.
     */
    profitCents: integer("profit_cents").notNull().default(0),

    /**
     * When this admin last added a product. Null if they have never added one
     * (staff row created by sync with zero products).
     *
     * UPDATE this when creating a product on the API.
     */
    lastProductAddedAt: integer("last_product_added_at", {
      mode: "timestamp",
    }),

    /**
     * When an order last completed against one of this admin's products.
     *
     * UPDATE this while completing an order on the API.
     */
    lastOrderAt: integer("last_order_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    check(
      "admin_stats_products_added_nonneg",
      sql`${table.productsAdded} >= 0`
    ),
    check("admin_stats_orders_count_nonneg", sql`${table.ordersCount} >= 0`),
    check(
      "admin_stats_products_with_orders_nonneg",
      sql`${table.productsWithOrders} >= 0`
    ),
    check("admin_stats_revenue_cents_nonneg", sql`${table.revenueCents} >= 0`),
    check("admin_stats_profit_cents_nonneg", sql`${table.profitCents} >= 0`),
    index("admin_stats_products_added_idx").on(table.productsAdded),
    index("admin_stats_orders_count_idx").on(table.ordersCount),
    index("admin_stats_revenue_cents_idx").on(table.revenueCents),
  ]
);

/** Singleton primary key for `admin_stats_sync`. Never create a second row. */
export const ADMIN_STATS_SYNC_ID = "global" as const;

export const ADMIN_STATS_SYNC_STATUSES = [
  "idle",
  "running",
  "success",
  "failed",
] as const;

export type AdminStatsSyncStatus =
  (typeof ADMIN_STATS_SYNC_STATUSES)[number];

/**
 * Singleton job row for the full stats rebuild.
 *
 * Used as an advisory lock (status = "running") so two admins cannot
 * rebuild at the same time, and as the "last synced" display on the UI.
 */
export const adminStatsSync = sqliteTable("admin_stats_sync", {
  id: text("id").primaryKey(),

  status: text("status", {
    enum: ["idle", "running", "success", "failed"],
  })
    .notNull()
    .default("idle"),

  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp" }),

  triggeredBy: text("triggered_by"),
  triggeredByName: text("triggered_by_name"),

  /** Last error message when status = "failed". */
  error: text("error"),

  adminsUpdated: integer("admins_updated").notNull().default(0),
  /** Products scanned during the last successful/failed rebuild. */
  productsScanned: integer("products_scanned").notNull().default(0),
  /**
   * Orders scanned during the last rebuild.
   * Stays 0 until an orders table exists — sync currently derives order
   * totals from `products.order_count` / `products.total_revenue`.
   *
   * UPDATE this when an orders table is added and sync starts scanning it.
   */
  ordersScanned: integer("orders_scanned").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),

  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
