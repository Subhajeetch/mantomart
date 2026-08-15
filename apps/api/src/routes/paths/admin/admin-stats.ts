import { Hono } from 'hono';
import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  max,
  or,
  sql,
} from 'drizzle-orm';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  ADMIN_STATS_SYNC_ID,
  adminStats,
  adminStatsSync,
  products,
  users,
  type Database,
} from '@repo/db';
import { errorJson, type AppEnv, type AppContext } from '@/utils/errorJson';
import {
  requireAdminMiddleware,
  requireAnyPermission,
  requirePermission,
  getActor,
  getDb,
} from '@/middleware/permission';
import { adminHasPermission } from '@/utils/permissions';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  logAuditFromContext,
} from '@/utils/auditLog';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ID_LENGTH = 128;
const MAX_SEARCH_LENGTH = 100;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 100;
const SYNC_STALE_MS = 2 * 60 * 1000;
const SYNC_COOLDOWN_MS = 5_000;
const D1_BATCH_SIZE = 40;

const SORTS = ['products', 'orders', 'revenue'] as const;
type SortKey = (typeof SORTS)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}

function clampNonNeg(value: unknown): number {
  return Math.max(0, toInt(value));
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sanitizeSort(value: unknown): SortKey {
  if (typeof value === 'string' && (SORTS as readonly string[]).includes(value)) {
    return value as SortKey;
  }
  return 'products';
}

function sanitizeSearch(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const search = value.trim();
  return search.length > 0 && search.length <= MAX_SEARCH_LENGTH
    ? search
    : null;
}

function parsePage(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

async function readOptionalJsonObject(
  c: AppContext
): Promise<Record<string, unknown>> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) return {};
  try {
    const body = await c.req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

type SyncJobRow = typeof adminStatsSync.$inferSelect;

function serializeSyncJob(row: SyncJobRow | null) {
  if (!row) {
    return {
      status: 'idle' as const,
      startedAt: null,
      finishedAt: null,
      lastSuccessAt: null,
      triggeredBy: null,
      triggeredByName: null,
      error: null,
      adminsUpdated: 0,
      productsScanned: 0,
      ordersScanned: 0,
      durationMs: 0,
    };
  }
  return {
    status: row.status,
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
    lastSuccessAt: toIso(row.lastSuccessAt),
    triggeredBy: row.triggeredBy,
    triggeredByName: row.triggeredByName,
    error: row.error,
    adminsUpdated: clampNonNeg(row.adminsUpdated),
    productsScanned: clampNonNeg(row.productsScanned),
    ordersScanned: clampNonNeg(row.ordersScanned),
    durationMs: clampNonNeg(row.durationMs),
  };
}

async function getOrCreateSyncJob(db: Database): Promise<SyncJobRow> {
  const [existing] = await db
    .select()
    .from(adminStatsSync)
    .where(eq(adminStatsSync.id, ADMIN_STATS_SYNC_ID))
    .limit(1);

  if (existing) return existing;

  const now = new Date();
  try {
    await db.insert(adminStatsSync).values({
      id: ADMIN_STATS_SYNC_ID,
      status: 'idle',
      startedAt: null,
      finishedAt: null,
      lastSuccessAt: null,
      triggeredBy: null,
      triggeredByName: null,
      error: null,
      adminsUpdated: 0,
      productsScanned: 0,
      ordersScanned: 0,
      durationMs: 0,
      updatedAt: now,
    });
  } catch {
    // Unique race — another request inserted the singleton.
  }

  const [row] = await db
    .select()
    .from(adminStatsSync)
    .where(eq(adminStatsSync.id, ADMIN_STATS_SYNC_ID))
    .limit(1);

  if (!row) {
    throw new Error('Failed to initialize admin stats sync job.');
  }
  return row;
}

function isStaleRunning(job: SyncJobRow, nowMs: number): boolean {
  if (job.status !== 'running' || !job.startedAt) return false;
  const started =
    job.startedAt instanceof Date
      ? job.startedAt.getTime()
      : new Date(job.startedAt).getTime();
  if (Number.isNaN(started)) return true;
  return nowMs - started > SYNC_STALE_MS;
}

function isOnCooldown(job: SyncJobRow, nowMs: number): boolean {
  if (!job.lastSuccessAt) return false;
  const last =
    job.lastSuccessAt instanceof Date
      ? job.lastSuccessAt.getTime()
      : new Date(job.lastSuccessAt).getTime();
  if (Number.isNaN(last)) return false;
  return nowMs - last < SYNC_COOLDOWN_MS;
}

type ComputedStats = {
  userId: string;
  productsAdded: number;
  ordersCount: number;
  productsWithOrders: number;
  revenueCents: number;
  profitCents: number;
  lastProductAddedAt: Date | null;
};

function emptyStats(userId: string): ComputedStats {
  return {
    userId,
    productsAdded: 0,
    ordersCount: 0,
    productsWithOrders: 0,
    revenueCents: 0,
    profitCents: 0,
    lastProductAddedAt: null,
  };
}

function chunkArray<T>(items: T[], size = D1_BATCH_SIZE): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type UserProfile = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  isBanned: boolean;
  isDeleted: boolean;
};

async function fetchUsersByIds(
  db: Database,
  ids: string[]
): Promise<Map<string, UserProfile>> {
  const map = new Map<string, UserProfile>();
  if (ids.length === 0) return map;

  for (const chunk of chunkArray(ids, 80)) {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        role: users.role,
        isBanned: users.isBanned,
        isDeleted: users.isDeleted,
      })
      .from(users)
      .where(inArray(users.id, chunk));

    for (const row of rows) {
      map.set(row.id, row);
    }
  }
  return map;
}

/**
 * Single-pass rebuild from source-of-truth product counters.
 *
 * Orders are not a table yet — `ordersCount` / revenue / profit are summed
 * from `products.order_count`, `products.total_revenue`, and
 * `products.revenue_in_profit`. When an orders table lands, replace the
 * aggregation here (and increment counters in the complete-order API).
 */
async function rebuildAdminStats(db: Database): Promise<{
  adminsUpdated: number;
  productsScanned: number;
  ordersScanned: number;
  unattributedProducts: number;
  skippedOrphans: number;
  staffIncluded: number;
}> {
  const [aggregates, staff, existingStats, productTotals] = await Promise.all([
    db
      .select({
        userId: products.productAddedBy,
        productsAdded: count(),
        ordersCount: sql<number>`coalesce(sum(${products.orderCount}), 0)`,
        productsWithOrders: sql<number>`coalesce(sum(case when ${products.orderCount} > 0 then 1 else 0 end), 0)`,
        revenueCents: sql<number>`coalesce(sum(${products.totalRevenue}), 0)`,
        profitCents: sql<number>`coalesce(sum(${products.revenueInProfit}), 0)`,
        lastProductAddedAt: max(products.createdAt),
      })
      .from(products)
      .where(isNotNull(products.productAddedBy))
      .groupBy(products.productAddedBy),
    db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          or(eq(users.role, 'admin'), eq(users.role, 'owner')),
          eq(users.isDeleted, false)
        )
      ),
    db.select({ userId: adminStats.userId }).from(adminStats),
    db
      .select({
        total: count(),
        unattributed: sql<number>`coalesce(sum(case when ${products.productAddedBy} is null then 1 else 0 end), 0)`,
        orders: sql<number>`coalesce(sum(${products.orderCount}), 0)`,
      })
      .from(products),
  ]);

  const desired = new Map<string, ComputedStats>();

  for (const row of aggregates) {
    if (!row.userId || !isValidId(row.userId)) continue;
    desired.set(row.userId, {
      userId: row.userId,
      productsAdded: clampNonNeg(row.productsAdded),
      ordersCount: clampNonNeg(row.ordersCount),
      productsWithOrders: clampNonNeg(row.productsWithOrders),
      revenueCents: clampNonNeg(row.revenueCents),
      profitCents: clampNonNeg(row.profitCents),
      lastProductAddedAt: row.lastProductAddedAt ?? null,
    });
  }

  for (const member of staff) {
    if (!desired.has(member.id)) {
      desired.set(member.id, emptyStats(member.id));
    }
  }

  const profiles = await fetchUsersByIds(db, [...desired.keys()]);
  let skippedOrphans = 0;
  for (const userId of [...desired.keys()]) {
    if (!profiles.has(userId)) {
      desired.delete(userId);
      skippedOrphans += 1;
    }
  }

  const desiredIds = new Set(desired.keys());
  const staleIds = existingStats
    .map((row) => row.userId)
    .filter((id) => !desiredIds.has(id));

  const now = new Date();
  const upserts = [...desired.values()];

  for (const group of chunkArray(upserts)) {
    await db.batch(
      group.map((row) =>
        db
          .insert(adminStats)
          .values({
            userId: row.userId,
            productsAdded: row.productsAdded,
            ordersCount: row.ordersCount,
            productsWithOrders: row.productsWithOrders,
            revenueCents: row.revenueCents,
            profitCents: row.profitCents,
            lastProductAddedAt: row.lastProductAddedAt,
            lastOrderAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: adminStats.userId,
            set: {
              productsAdded: row.productsAdded,
              ordersCount: row.ordersCount,
              productsWithOrders: row.productsWithOrders,
              revenueCents: row.revenueCents,
              profitCents: row.profitCents,
              lastProductAddedAt: row.lastProductAddedAt,
              updatedAt: now,
            },
          })
      ) as unknown as Parameters<Database['batch']>[0]
    );
  }

  for (const group of chunkArray(staleIds)) {
    await db.delete(adminStats).where(inArray(adminStats.userId, group));
  }

  const totals = productTotals[0];

  return {
    adminsUpdated: desired.size,
    productsScanned: clampNonNeg(totals?.total),
    // Derived from product counters until an orders table exists.
    ordersScanned: clampNonNeg(totals?.orders),
    unattributedProducts: clampNonNeg(totals?.unattributed),
    skippedOrphans,
    staffIncluded: staff.length,
  };
}

type LiveTotals = {
  productsAdded: number;
  ordersCount: number;
  productsWithOrders: number;
  revenueCents: number;
  profitCents: number;
  unattributedProducts: number;
  productsScanned: number;
};

async function computeLiveTotals(db: Database): Promise<LiveTotals> {
  const [row] = await db
    .select({
      productsScanned: count(),
      productsAdded: sql<number>`coalesce(sum(case when ${products.productAddedBy} is not null then 1 else 0 end), 0)`,
      unattributedProducts: sql<number>`coalesce(sum(case when ${products.productAddedBy} is null then 1 else 0 end), 0)`,
      ordersCount: sql<number>`coalesce(sum(case when ${products.productAddedBy} is not null then ${products.orderCount} else 0 end), 0)`,
      productsWithOrders: sql<number>`coalesce(sum(case when ${products.productAddedBy} is not null and ${products.orderCount} > 0 then 1 else 0 end), 0)`,
      revenueCents: sql<number>`coalesce(sum(case when ${products.productAddedBy} is not null then ${products.totalRevenue} else 0 end), 0)`,
      profitCents: sql<number>`coalesce(sum(case when ${products.productAddedBy} is not null then ${products.revenueInProfit} else 0 end), 0)`,
    })
    .from(products);

  return {
    productsAdded: clampNonNeg(row?.productsAdded),
    ordersCount: clampNonNeg(row?.ordersCount),
    productsWithOrders: clampNonNeg(row?.productsWithOrders),
    revenueCents: clampNonNeg(row?.revenueCents),
    profitCents: clampNonNeg(row?.profitCents),
    unattributedProducts: clampNonNeg(row?.unattributedProducts),
    productsScanned: clampNonNeg(row?.productsScanned),
  };
}

async function computeStoredTotals(db: Database): Promise<{
  contributors: number;
  productsAdded: number;
  ordersCount: number;
  productsWithOrders: number;
  revenueCents: number;
  profitCents: number;
}> {
  const [row] = await db
    .select({
      contributors: count(),
      productsAdded: sql<number>`coalesce(sum(${adminStats.productsAdded}), 0)`,
      ordersCount: sql<number>`coalesce(sum(${adminStats.ordersCount}), 0)`,
      productsWithOrders: sql<number>`coalesce(sum(${adminStats.productsWithOrders}), 0)`,
      revenueCents: sql<number>`coalesce(sum(${adminStats.revenueCents}), 0)`,
      profitCents: sql<number>`coalesce(sum(${adminStats.profitCents}), 0)`,
    })
    .from(adminStats);

  return {
    contributors: clampNonNeg(row?.contributors),
    productsAdded: clampNonNeg(row?.productsAdded),
    ordersCount: clampNonNeg(row?.ordersCount),
    productsWithOrders: clampNonNeg(row?.productsWithOrders),
    revenueCents: clampNonNeg(row?.revenueCents),
    profitCents: clampNonNeg(row?.profitCents),
  };
}

function sortValue(row: {
  productsAdded: number;
  ordersCount: number;
  revenueCents: number;
}, sort: SortKey): number {
  if (sort === 'orders') return row.ordersCount;
  if (sort === 'revenue') return row.revenueCents;
  return row.productsAdded;
}

function compareRows(
  a: {
    productsAdded: number;
    ordersCount: number;
    revenueCents: number;
    name: string;
  },
  b: {
    productsAdded: number;
    ordersCount: number;
    revenueCents: number;
    name: string;
  },
  sort: SortKey
): number {
  const primary = sortValue(b, sort) - sortValue(a, sort);
  if (primary !== 0) return primary;
  if (sort !== 'revenue') {
    const byRevenue = b.revenueCents - a.revenueCents;
    if (byRevenue !== 0) return byRevenue;
  }
  if (sort !== 'orders') {
    const byOrders = b.ordersCount - a.ordersCount;
    if (byOrders !== 0) return byOrders;
  }
  if (sort !== 'products') {
    const byProducts = b.productsAdded - a.productsAdded;
    if (byProducts !== 0) return byProducts;
  }
  return a.name.localeCompare(b.name);
}

// ─── Router ───────────────────────────────────────────────────────────────────

const adminStatsRouter = new Hono<AppEnv>();

adminStatsRouter.use('*', requireAdminMiddleware);

// ─── GET /  — ranked leaderboard ──────────────────────────────────────────────

async function listAdminStatsHandler(c: AppContext) {
  const actor = getActor(c);
  const db = getDb(c);

  const sort = sanitizeSort(c.req.query('sort'));
  const search = sanitizeSearch(c.req.query('search'));
  const page = parsePage(c.req.query('page'), 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parsePage(c.req.query('pageSize'), DEFAULT_PAGE_SIZE))
  );

  try {
    const [rows, canManage, job] = await Promise.all([
      db
        .select({
          userId: adminStats.userId,
          productsAdded: adminStats.productsAdded,
          ordersCount: adminStats.ordersCount,
          productsWithOrders: adminStats.productsWithOrders,
          revenueCents: adminStats.revenueCents,
          profitCents: adminStats.profitCents,
          lastProductAddedAt: adminStats.lastProductAddedAt,
          lastOrderAt: adminStats.lastOrderAt,
          updatedAt: adminStats.updatedAt,
          name: users.name,
          email: users.email,
          image: users.image,
          role: users.role,
          isBanned: users.isBanned,
          isDeleted: users.isDeleted,
        })
        .from(adminStats)
        .innerJoin(users, eq(adminStats.userId, users.id)),
      adminHasPermission(db, actor.id, PERMISSIONS.ADMIN_STATS_MANAGE),
      getOrCreateSyncJob(db),
    ]);

    const ranked = rows
      .map((row) => ({
        userId: row.userId,
        name: row.name,
        email: row.email,
        image: row.image,
        role: row.role,
        isBanned: Boolean(row.isBanned),
        isDeleted: Boolean(row.isDeleted),
        isStaff: row.role === 'admin' || row.role === 'owner',
        productsAdded: clampNonNeg(row.productsAdded),
        ordersCount: clampNonNeg(row.ordersCount),
        productsWithOrders: clampNonNeg(row.productsWithOrders),
        revenueCents: clampNonNeg(row.revenueCents),
        profitCents: clampNonNeg(row.profitCents),
        lastProductAddedAt: toIso(row.lastProductAddedAt),
        lastOrderAt: toIso(row.lastOrderAt),
        updatedAt: toIso(row.updatedAt),
      }))
      .sort((a, b) => compareRows(a, b, sort));

    // Competition ranking (1, 2, 2, 4) on the full set, then filter.
    let lastScore: number | null = null;
    let lastRank = 0;
    const withRank = ranked.map((row, index) => {
      const score = sortValue(row, sort);
      const rank = score === lastScore ? lastRank : index + 1;
      lastScore = score;
      lastRank = rank;
      return { ...row, rank };
    });

    const filtered = search
      ? withRank.filter((row) => {
          const q = search.toLowerCase();
          return (
            row.name.toLowerCase().includes(q) ||
            row.email.toLowerCase().includes(q)
          );
        })
      : withRank;

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const safePage = Math.min(page, totalPages);
    const pageRows = filtered.slice(
      (safePage - 1) * pageSize,
      safePage * pageSize
    );

    const totals = withRank.reduce(
      (acc, row) => {
        acc.productsAdded += row.productsAdded;
        acc.ordersCount += row.ordersCount;
        acc.productsWithOrders += row.productsWithOrders;
        acc.revenueCents += row.revenueCents;
        acc.profitCents += row.profitCents;
        return acc;
      },
      {
        contributors: withRank.length,
        productsAdded: 0,
        ordersCount: 0,
        productsWithOrders: 0,
        revenueCents: 0,
        profitCents: 0,
      }
    );

    return c.json({
      success: true,
      data: pageRows,
      meta: {
        currentUserId: actor.id,
        currentUserRole: actor.role,
        canManage,
        sort,
        search,
        total,
        page: safePage,
        pageSize,
        totalPages,
        totals,
        lastSync: serializeSyncJob(job),
      },
    });
  } catch (error) {
    console.error('Error listing admin stats:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load admin stats.');
  }
}

adminStatsRouter.get(
  '/',
  requireAnyPermission(
    PERMISSIONS.ADMIN_STATS_READ,
    PERMISSIONS.ADMIN_STATS_MANAGE
  ),
  listAdminStatsHandler
);

adminStatsRouter.get(
  '/all',
  requireAnyPermission(
    PERMISSIONS.ADMIN_STATS_READ,
    PERMISSIONS.ADMIN_STATS_MANAGE
  ),
  listAdminStatsHandler
);

// ─── GET /sync — last job + optional live-vs-stored drift ─────────────────────

adminStatsRouter.get(
  '/sync',
  requireAnyPermission(
    PERMISSIONS.ADMIN_STATS_READ,
    PERMISSIONS.ADMIN_STATS_MANAGE
  ),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);
    const includeDrift =
      c.req.query('drift') === '1' || c.req.query('drift') === 'true';

    try {
      const [job, canManage] = await Promise.all([
        getOrCreateSyncJob(db),
        adminHasPermission(db, actor.id, PERMISSIONS.ADMIN_STATS_MANAGE),
      ]);

      let drift: {
        stored: Awaited<ReturnType<typeof computeStoredTotals>>;
        live: LiveTotals;
        outOfSync: boolean;
      } | null = null;

      if (includeDrift) {
        const [stored, live] = await Promise.all([
          computeStoredTotals(db),
          computeLiveTotals(db),
        ]);
        drift = {
          stored,
          live,
          outOfSync:
            stored.productsAdded !== live.productsAdded ||
            stored.ordersCount !== live.ordersCount ||
            stored.productsWithOrders !== live.productsWithOrders ||
            stored.revenueCents !== live.revenueCents ||
            stored.profitCents !== live.profitCents,
        };
      }

      return c.json({
        success: true,
        data: {
          job: serializeSyncJob(job),
          drift,
          canManage,
          running: job.status === 'running' && !isStaleRunning(job, Date.now()),
        },
      });
    } catch (error) {
      console.error('Error loading admin stats sync status:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to load sync status.'
      );
    }
  }
);

// ─── POST /sync — full rebuild (manage only) ──────────────────────────────────

adminStatsRouter.post(
  '/sync',
  requirePermission(PERMISSIONS.ADMIN_STATS_MANAGE),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);

    const body = await readOptionalJsonObject(c);
    if (body.confirm !== true) {
      return errorJson(
        c,
        400,
        'CONFIRM_REQUIRED',
        'Send { "confirm": true } to rebuild admin stats from live data.'
      );
    }

    const now = new Date();
    const nowMs = now.getTime();

    let job: SyncJobRow;
    try {
      job = await getOrCreateSyncJob(db);
    } catch (error) {
      console.error('Error initializing admin stats sync job:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to start the sync job.'
      );
    }

    if (job.status === 'running' && !isStaleRunning(job, nowMs)) {
      return errorJson(
        c,
        409,
        'SYNC_IN_PROGRESS',
        'A stats sync is already running. Please wait for it to finish.'
      );
    }

    if (isOnCooldown(job, nowMs)) {
      return errorJson(
        c,
        429,
        'SYNC_COOLDOWN',
        'Stats were just synced. Wait a few seconds before syncing again.'
      );
    }

    try {
      await db
        .update(adminStatsSync)
        .set({
          status: 'running',
          startedAt: now,
          finishedAt: null,
          triggeredBy: actor.id,
          triggeredByName: actor.name,
          error: null,
          updatedAt: now,
        })
        .where(eq(adminStatsSync.id, ADMIN_STATS_SYNC_ID));
    } catch (error) {
      console.error('Error locking admin stats sync job:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to acquire the sync lock.'
      );
    }

    const startedMs = Date.now();

    try {
      const result = await rebuildAdminStats(db);
      const finished = new Date();
      const durationMs = Math.max(0, Date.now() - startedMs);

      await db
        .update(adminStatsSync)
        .set({
          status: 'success',
          finishedAt: finished,
          lastSuccessAt: finished,
          triggeredBy: actor.id,
          triggeredByName: actor.name,
          error: null,
          adminsUpdated: result.adminsUpdated,
          productsScanned: result.productsScanned,
          ordersScanned: result.ordersScanned,
          durationMs,
          updatedAt: finished,
        })
        .where(eq(adminStatsSync.id, ADMIN_STATS_SYNC_ID));

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.ADMIN_STATS_SYNC,
          category: AUDIT_CATEGORIES.ADMIN_STATS,
          description: `Rebuilt admin stats for ${result.adminsUpdated} contributor${result.adminsUpdated === 1 ? '' : 's'}`,
          targetType: AUDIT_TARGET_TYPES.ADMIN_STATS,
          targetId: ADMIN_STATS_SYNC_ID,
          targetLabel: 'admin_stats',
          severity: 'info',
          metadata: {
            ...result,
            durationMs,
            syncedBy: {
              id: actor.id,
              name: actor.name,
              email: actor.email,
              role: actor.role,
            },
          },
        }).then(() => undefined)
      );

      return c.json({
        success: true,
        message: `Synced ${result.adminsUpdated} admin${result.adminsUpdated === 1 ? '' : 's'} from ${result.productsScanned} product${result.productsScanned === 1 ? '' : 's'}.`,
        data: {
          job: {
            status: 'success' as const,
            startedAt: toIso(now),
            finishedAt: toIso(finished),
            lastSuccessAt: toIso(finished),
            triggeredBy: actor.id,
            triggeredByName: actor.name,
            error: null,
            adminsUpdated: result.adminsUpdated,
            productsScanned: result.productsScanned,
            ordersScanned: result.ordersScanned,
            durationMs,
          },
          result,
        },
      });
    } catch (error) {
      console.error('Error rebuilding admin stats:', error);
      const finished = new Date();
      const durationMs = Math.max(0, Date.now() - startedMs);
      const message =
        error instanceof Error ? error.message : 'Unknown sync error';

      try {
        await db
          .update(adminStatsSync)
          .set({
            status: 'failed',
            finishedAt: finished,
            triggeredBy: actor.id,
            triggeredByName: actor.name,
            error: message.slice(0, 500),
            durationMs,
            updatedAt: finished,
          })
          .where(eq(adminStatsSync.id, ADMIN_STATS_SYNC_ID));
      } catch (lockError) {
        console.error('Error marking admin stats sync as failed:', lockError);
      }

      c.executionCtx.waitUntil(
        logAuditFromContext(c, {
          action: AUDIT_ACTIONS.ADMIN_STATS_SYNC,
          category: AUDIT_CATEGORIES.ADMIN_STATS,
          description: 'Admin stats sync failed',
          targetType: AUDIT_TARGET_TYPES.ADMIN_STATS,
          targetId: ADMIN_STATS_SYNC_ID,
          targetLabel: 'admin_stats',
          status: 'failure',
          severity: 'warning',
          metadata: {
            error: message.slice(0, 500),
            durationMs,
            syncedBy: {
              id: actor.id,
              name: actor.name,
              email: actor.email,
              role: actor.role,
            },
          },
        }).then(() => undefined)
      );

      return errorJson(
        c,
        500,
        'SYNC_FAILED',
        'Failed to rebuild admin stats. Please try again.'
      );
    }
  }
);

adminStatsRouter.notFound((c) =>
  errorJson(c, 404, 'NOT_FOUND', 'Admin stats API route not found.')
);

export default adminStatsRouter;
