import { Hono } from 'hono';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { PERMISSIONS } from '@repo/auth/permissions';
import { auditLogs } from '@repo/db';
import { errorJson, type AppEnv, type AppContext } from '@/utils/errorJson';
import {
  requireAdminMiddleware,
  requireAnyPermission,
  getActor,
  getDb,
} from '@/middleware/permission';
import {
  MAX_AUDIT_LOG_ENTRIES,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
} from '@/utils/auditLog';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ID_LENGTH = 128;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const MAX_SEARCH_LENGTH = 100;

const SORTABLE_COLUMNS = [
  'createdAt',
  'action',
  'category',
  'severity',
  'status',
  'actorName',
] as const;
type SortColumn = (typeof SORTABLE_COLUMNS)[number];

const SEVERITIES = ['info', 'warning', 'critical'] as const;
type Severity = (typeof SEVERITIES)[number];

const STATUSES = ['success', 'failure', 'partial'] as const;
type Status = (typeof STATUSES)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function sanitizeSearch(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const search = value.trim();
  return search.length > 0 && search.length <= MAX_SEARCH_LENGTH
    ? search
    : null;
}

function sanitizeOptionalString(value: unknown, max = 128): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function sanitizeSeverity(value: unknown): Severity | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return (SEVERITIES as readonly string[]).includes(v) ? (v as Severity) : null;
}

function sanitizeStatus(value: unknown): Status | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return (STATUSES as readonly string[]).includes(v) ? (v as Status) : null;
}

function sanitizeSortBy(value: unknown): SortColumn {
  if (typeof value !== 'string') return 'createdAt';
  return (SORTABLE_COLUMNS as readonly string[]).includes(value)
    ? (value as SortColumn)
    : 'createdAt';
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value.trim());
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function serializeAuditLog(row: typeof auditLogs.$inferSelect) {
  return {
    id: row.id,
    action: row.action,
    category: row.category,
    description: row.description,
    status: row.status,
    severity: row.severity,
    actorId: row.actorId,
    actorName: row.actorName,
    actorEmail: row.actorEmail,
    actorRole: row.actorRole,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    changes: row.changes ?? null,
    metadata: row.metadata ?? null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    requestMethod: row.requestMethod,
    requestPath: row.requestPath,
    createdAt: row.createdAt,
  };
}

function buildWhere(filters: {
  search: string | null;
  action: string | null;
  category: string | null;
  severity: Severity | null;
  status: Status | null;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  from: Date | null;
  to: Date | null;
}): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.search) {
    const escaped = filters.search
      .toLowerCase()
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    const likePattern = `%${escaped}%`;
    conditions.push(
      or(
        sql`lower(${auditLogs.description}) LIKE ${likePattern} ESCAPE '\\'`,
        sql`lower(${auditLogs.action}) LIKE ${likePattern} ESCAPE '\\'`,
        sql`lower(${auditLogs.actorName}) LIKE ${likePattern} ESCAPE '\\'`,
        sql`lower(${auditLogs.actorEmail}) LIKE ${likePattern} ESCAPE '\\'`,
        sql`lower(${auditLogs.targetLabel}) LIKE ${likePattern} ESCAPE '\\'`,
        sql`lower(${auditLogs.targetId}) LIKE ${likePattern} ESCAPE '\\'`,
        sql`lower(${auditLogs.id}) LIKE ${likePattern} ESCAPE '\\'`
      )!
    );
  }

  if (filters.action) {
    conditions.push(eq(auditLogs.action, filters.action));
  }
  if (filters.category) {
    conditions.push(eq(auditLogs.category, filters.category));
  }
  if (filters.severity) {
    conditions.push(eq(auditLogs.severity, filters.severity));
  }
  if (filters.status) {
    conditions.push(eq(auditLogs.status, filters.status));
  }
  if (filters.actorId) {
    conditions.push(eq(auditLogs.actorId, filters.actorId));
  }
  if (filters.targetType) {
    conditions.push(eq(auditLogs.targetType, filters.targetType));
  }
  if (filters.targetId) {
    conditions.push(eq(auditLogs.targetId, filters.targetId));
  }
  if (filters.from) {
    conditions.push(gte(auditLogs.createdAt, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(auditLogs.createdAt, filters.to));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function buildOrderBy(sortBy: SortColumn, sortOrder: 'asc' | 'desc') {
  const columnMap = {
    createdAt: auditLogs.createdAt,
    action: auditLogs.action,
    category: auditLogs.category,
    severity: auditLogs.severity,
    status: auditLogs.status,
    actorName: auditLogs.actorName,
  } as const;

  const column = columnMap[sortBy];
  return sortOrder === 'asc' ? asc(column) : desc(column);
}

// ─── Router ───────────────────────────────────────────────────────────────────

const auditLogsRouter = new Hono<AppEnv>();

auditLogsRouter.use('*', requireAdminMiddleware);

// ─── GET /all — paginated list ────────────────────────────────────────────────
async function listAuditLogsHandler(c: AppContext) {
  const actor = getActor(c);
  const db = getDb(c);

  // Read permission (owners always pass via requireAnyPermission below)
  // Applied at route level; re-check not needed here.

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      parseInt(c.req.query('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) ||
        DEFAULT_PAGE_SIZE
    )
  );

  const search = sanitizeSearch(c.req.query('search'));
  const action = sanitizeOptionalString(c.req.query('action'));
  const category = sanitizeOptionalString(c.req.query('category'), 64);
  const severity = sanitizeSeverity(c.req.query('severity'));
  const status = sanitizeStatus(c.req.query('status'));
  const actorId = sanitizeOptionalString(c.req.query('actorId'));
  const targetType = sanitizeOptionalString(c.req.query('targetType'), 64);
  const targetId = sanitizeOptionalString(c.req.query('targetId'));
  const from = parseTimestamp(c.req.query('from'));
  const to = parseTimestamp(c.req.query('to'));
  const sortBy = sanitizeSortBy(c.req.query('sortBy'));
  const sortOrder = c.req.query('sortOrder') === 'asc' ? 'asc' : 'desc';

  if (from && to && from.getTime() > to.getTime()) {
    return errorJson(
      c,
      400,
      'INVALID_DATE_RANGE',
      '`from` must be before or equal to `to`.'
    );
  }

  try {
    const where = buildWhere({
      search,
      action,
      category,
      severity,
      status,
      actorId,
      targetType,
      targetId,
      from,
      to,
    });
    const orderBy = buildOrderBy(sortBy, sortOrder);

    const [totalResult, rows, capResult] = await Promise.all([
      db.select({ value: count() }).from(auditLogs).where(where),
      db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ value: count() }).from(auditLogs),
    ]);

    const total = Number(totalResult[0]?.value ?? 0);
    const storedTotal = Number(capResult[0]?.value ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

    return c.json({
      success: true,
      data: rows.map(serializeAuditLog),
      meta: {
        currentUserId: actor.id,
        currentUserRole: actor.role,
        total,
        page,
        pageSize,
        totalPages,
        maxEntries: MAX_AUDIT_LOG_ENTRIES,
        storedTotal,
      },
    });
  } catch (error) {
    console.error('Error listing audit logs:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load audit logs.');
  }
}

auditLogsRouter.get(
  '/all',
  requireAnyPermission(
    PERMISSIONS.AUDIT_LOG_READ,
    PERMISSIONS.AUDIT_LOG_MANAGE
  ),
  listAuditLogsHandler
);

auditLogsRouter.get(
  '/',
  requireAnyPermission(
    PERMISSIONS.AUDIT_LOG_READ,
    PERMISSIONS.AUDIT_LOG_MANAGE
  ),
  listAuditLogsHandler
);

// ─── GET /stats — aggregate counts ────────────────────────────────────────────
auditLogsRouter.get(
  '/stats',
  requireAnyPermission(
    PERMISSIONS.AUDIT_LOG_READ,
    PERMISSIONS.AUDIT_LOG_MANAGE
  ),
  async (c) => {
    const db = getDb(c);

    try {
      const [totalResult, byCategory, bySeverity, byStatus, recentCritical] =
        await Promise.all([
          db.select({ value: count() }).from(auditLogs),
          db
            .select({ category: auditLogs.category, value: count() })
            .from(auditLogs)
            .groupBy(auditLogs.category),
          db
            .select({ severity: auditLogs.severity, value: count() })
            .from(auditLogs)
            .groupBy(auditLogs.severity),
          db
            .select({ status: auditLogs.status, value: count() })
            .from(auditLogs)
            .groupBy(auditLogs.status),
          db
            .select({ value: count() })
            .from(auditLogs)
            .where(eq(auditLogs.severity, 'critical')),
        ]);

      const total = Number(totalResult[0]?.value ?? 0);
      const categoryMap: Record<string, number> = {};
      for (const row of byCategory) {
        categoryMap[row.category] = Number(row.value);
      }
      const severityMap: Record<string, number> = {
        info: 0,
        warning: 0,
        critical: 0,
      };
      for (const row of bySeverity) {
        severityMap[row.severity] = Number(row.value);
      }
      const statusMap: Record<string, number> = {
        success: 0,
        failure: 0,
        partial: 0,
      };
      for (const row of byStatus) {
        statusMap[row.status] = Number(row.value);
      }

      return c.json({
        success: true,
        data: {
          total,
          maxEntries: MAX_AUDIT_LOG_ENTRIES,
          remaining: Math.max(0, MAX_AUDIT_LOG_ENTRIES - total),
          critical: Number(recentCritical[0]?.value ?? 0),
          byCategory: categoryMap,
          bySeverity: severityMap,
          byStatus: statusMap,
        },
      });
    } catch (error) {
      console.error('Error fetching audit log stats:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load stats.');
    }
  }
);

// ─── GET /meta — catalogs for filter UI ───────────────────────────────────────
auditLogsRouter.get(
  '/meta',
  requireAnyPermission(
    PERMISSIONS.AUDIT_LOG_READ,
    PERMISSIONS.AUDIT_LOG_MANAGE
  ),
  async (c) => {
    const db = getDb(c);

    try {
      const [actionRows, categoryRows] = await Promise.all([
        db
          .selectDistinct({ action: auditLogs.action })
          .from(auditLogs)
          .orderBy(auditLogs.action),
        db
          .selectDistinct({ category: auditLogs.category })
          .from(auditLogs)
          .orderBy(auditLogs.category),
      ]);

      return c.json({
        success: true,
        data: {
          knownActions: Object.values(AUDIT_ACTIONS),
          knownCategories: Object.values(AUDIT_CATEGORIES),
          knownTargetTypes: Object.values(AUDIT_TARGET_TYPES),
          knownSeverities: SEVERITIES,
          knownStatuses: STATUSES,
          usedActions: actionRows.map((r) => r.action).filter(Boolean),
          usedCategories: categoryRows.map((r) => r.category).filter(Boolean),
          maxEntries: MAX_AUDIT_LOG_ENTRIES,
        },
      });
    } catch (error) {
      console.error('Error fetching audit log meta:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load metadata.');
    }
  }
);

// ─── GET /:id — single entry ──────────────────────────────────────────────────
auditLogsRouter.get(
  '/:id',
  requireAnyPermission(
    PERMISSIONS.AUDIT_LOG_READ,
    PERMISSIONS.AUDIT_LOG_MANAGE
  ),
  async (c) => {
    const db = getDb(c);
    const id = c.req.param('id')?.trim() ?? '';

    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid audit log id.');
    }

    try {
      const [row] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.id, id))
        .limit(1);

      if (!row) {
        return errorJson(c, 404, 'NOT_FOUND', 'Audit log entry not found.');
      }

      return c.json({
        success: true,
        data: serializeAuditLog(row),
      });
    } catch (error) {
      console.error('Error fetching audit log:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load audit log.');
    }
  }
);

auditLogsRouter.notFound((c) =>
  errorJson(c, 404, 'NOT_FOUND', 'Audit logs API route not found.')
);

export default auditLogsRouter;
