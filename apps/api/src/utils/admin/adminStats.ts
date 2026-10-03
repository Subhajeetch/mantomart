/**
 * Incremental admin-stats counter helpers.
 *
 * The leaderboard table is denormalized. Call these from product / order
 * write paths so rankings stay current without a full rebuild.
 *
 * Product create / delete already call the Safe wrappers below.
 *
 * UPDATE this while completing an order on the API (orders do not exist yet):
 *
 *   await applyAdminStatsDeltaSafe(db, product.productAddedBy, {
 *     ordersCount: 1,
 *     revenueCents: lineTotalCents,
 *     profitCents: lineProfitCents,
 *     productsWithOrders: product.orderCount === 0 ? 1 : 0,
 *     lastOrderAt: new Date(),
 *   });
 *
 * After a bulk import that predates this table, run POST /api/admin-stats/sync.
 */

import { eq, sql } from 'drizzle-orm';
import { adminStats, type Database } from '@repo/db';

const MAX_USER_ID_LENGTH = 128;

export type AdminStatsDelta = {
  productsAdded?: number;
  ordersCount?: number;
  productsWithOrders?: number;
  revenueCents?: number;
  profitCents?: number;
  lastProductAddedAt?: Date | null;
  lastOrderAt?: Date | null;
};

export type ApplyAdminStatsDeltaResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; error: string };

function isValidUserId(id: string | null | undefined): id is string {
  if (!id) return false;
  if (id.length === 0 || id.length > MAX_USER_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}

function isNonPositive(n: number): boolean {
  return n <= 0;
}

/**
 * Apply a signed delta to one admin's stats row. Creates the row if needed.
 *
 * Never throws on bad input — returns `{ ok: false }`. Callers that must not
 * fail the parent write (product create, order complete) should use
 * `applyAdminStatsDeltaSafe`.
 */
export async function applyAdminStatsDelta(
  db: Database,
  userId: string | null | undefined,
  delta: AdminStatsDelta
): Promise<ApplyAdminStatsDeltaResult> {
  if (!isValidUserId(userId)) {
    return { ok: true, skipped: true };
  }

  const productsAdded = toInt(delta.productsAdded);
  const ordersCount = toInt(delta.ordersCount);
  const productsWithOrders = toInt(delta.productsWithOrders);
  const revenueCents = toInt(delta.revenueCents);
  const profitCents = toInt(delta.profitCents);

  const hasNumericDelta =
    productsAdded !== 0 ||
    ordersCount !== 0 ||
    productsWithOrders !== 0 ||
    revenueCents !== 0 ||
    profitCents !== 0;
  const hasTimestamp =
    delta.lastProductAddedAt instanceof Date ||
    delta.lastOrderAt instanceof Date;

  if (!hasNumericDelta && !hasTimestamp) {
    return { ok: true, skipped: true };
  }

  const isPureDecrement =
    isNonPositive(productsAdded) &&
    isNonPositive(ordersCount) &&
    isNonPositive(productsWithOrders) &&
    isNonPositive(revenueCents) &&
    isNonPositive(profitCents) &&
    !hasTimestamp;

  if (isPureDecrement) {
    const [existing] = await db
      .select({ userId: adminStats.userId })
      .from(adminStats)
      .where(eq(adminStats.userId, userId))
      .limit(1);
    if (!existing) {
      return { ok: true, skipped: true };
    }
  }

  const now = new Date();

  const set: Record<string, unknown> = {
    productsAdded: sql`MAX(0, ${adminStats.productsAdded} + ${productsAdded})`,
    ordersCount: sql`MAX(0, ${adminStats.ordersCount} + ${ordersCount})`,
    productsWithOrders: sql`MAX(0, ${adminStats.productsWithOrders} + ${productsWithOrders})`,
    revenueCents: sql`MAX(0, ${adminStats.revenueCents} + ${revenueCents})`,
    profitCents: sql`MAX(0, ${adminStats.profitCents} + ${profitCents})`,
    updatedAt: now,
  };

  if (delta.lastProductAddedAt instanceof Date) {
    set.lastProductAddedAt = delta.lastProductAddedAt;
  }
  if (delta.lastOrderAt instanceof Date) {
    set.lastOrderAt = delta.lastOrderAt;
  }

  await db
    .insert(adminStats)
    .values({
      userId,
      productsAdded: Math.max(0, productsAdded),
      ordersCount: Math.max(0, ordersCount),
      productsWithOrders: Math.max(0, productsWithOrders),
      revenueCents: Math.max(0, revenueCents),
      profitCents: Math.max(0, profitCents),
      lastProductAddedAt:
        delta.lastProductAddedAt instanceof Date
          ? delta.lastProductAddedAt
          : null,
      lastOrderAt: delta.lastOrderAt instanceof Date ? delta.lastOrderAt : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: adminStats.userId,
      set,
    });

  return { ok: true };
}

/**
 * Fail-soft wrapper. Stats drift is recoverable via sync; never fail the
 * parent product/order write because a counter upsert failed.
 */
export async function applyAdminStatsDeltaSafe(
  db: Database,
  userId: string | null | undefined,
  delta: AdminStatsDelta
): Promise<ApplyAdminStatsDeltaResult> {
  try {
    return await applyAdminStatsDelta(db, userId, delta);
  } catch (error) {
    console.error('admin stats increment failed', {
      userId,
      delta,
      error,
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown stats error',
    };
  }
}

/** Convenience: +1 product for the creating admin. */
export function incrementAdminProductsAdded(
  db: Database,
  userId: string | null | undefined,
  at: Date = new Date()
) {
  return applyAdminStatsDeltaSafe(db, userId, {
    productsAdded: 1,
    lastProductAddedAt: at,
  });
}

/**
 * Convenience: reverse a product's contribution when it is deleted.
 * Pass the product's stored counters so order/revenue stay consistent.
 */
export function decrementAdminProductContribution(
  db: Database,
  userId: string | null | undefined,
  product: {
    orderCount?: number | null;
    totalRevenue?: number | null;
    revenueInProfit?: number | null;
  }
) {
  const orderCount = Math.max(0, toInt(product.orderCount));
  return applyAdminStatsDeltaSafe(db, userId, {
    productsAdded: -1,
    ordersCount: -orderCount,
    productsWithOrders: orderCount > 0 ? -1 : 0,
    revenueCents: -Math.max(0, toInt(product.totalRevenue)),
    profitCents: -Math.max(0, toInt(product.revenueInProfit)),
  });
}
