import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { AUDIT_ACTIONS, type AuditAction } from '@repo/auth/permissions';
import { auditLogs, type Database } from '@repo/db';
import type { AppContext } from '@/utils/errorJson';
import type { AdminActor } from '@/utils/errorJson';
import { extractClientIp } from '@/utils/userActivity';
import { getActor, getDb } from '@/middleware/permission';

// ─── Limits ───────────────────────────────────────────────────────────────────

/** Hard cap on retained audit log rows. Older entries are pruned on write. */
export const MAX_AUDIT_LOG_ENTRIES = 1000;

const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_TARGET_LABEL_LENGTH = 255;
const MAX_ACTION_LENGTH = 128;
const MAX_CATEGORY_LENGTH = 64;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_PATH_LENGTH = 512;
const MAX_IP_LENGTH = 45;
const MAX_CHANGES_JSON_LENGTH = 16_000;
const MAX_METADATA_JSON_LENGTH = 8_000;

// ─── Catalog (use these constants from other APIs) ────────────────────────────

export { AUDIT_ACTIONS, type AuditAction };

export const AUDIT_CATEGORIES = {
  USER: 'user',
  ADMIN: 'admin',
  PRODUCT: 'product',
  CATEGORY: 'category',
  ORDER: 'order',
  REVIEW: 'review',
  AE: 'ae',
  AUTH: 'auth',
  SYSTEM: 'system',
  AUDIT: 'audit',
  OTHER: 'other',
} as const;

export type AuditCategory =
  | (typeof AUDIT_CATEGORIES)[keyof typeof AUDIT_CATEGORIES]
  | (string & {});

export const AUDIT_TARGET_TYPES = {
  USER: 'user',
  ADMIN: 'admin',
  PRODUCT: 'product',
  CATEGORY: 'category',
  ORDER: 'order',
  REVIEW: 'review',
  AE_CONNECTION: 'ae_connection',
  SYSTEM: 'system',
} as const;

export type AuditTargetType =
  | (typeof AUDIT_TARGET_TYPES)[keyof typeof AUDIT_TARGET_TYPES]
  | (string & {});

export type AuditStatus = 'success' | 'failure' | 'partial';
export type AuditSeverity = 'info' | 'warning' | 'critical';

export type AuditActor = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

export type AuditChangeMap = Record<
  string,
  { from?: unknown; to?: unknown } | unknown
>;

export type CreateAuditLogInput = {
  action: AuditAction;
  category: AuditCategory;
  description: string;
  status?: AuditStatus;
  severity?: AuditSeverity;

  actor?: AuditActor | null;

  targetType?: AuditTargetType | null;
  targetId?: string | null;
  targetLabel?: string | null;

  changes?: AuditChangeMap | null;
  metadata?: Record<string, unknown> | null;

  ipAddress?: string | null;
  userAgent?: string | null;
  requestMethod?: string | null;
  requestPath?: string | null;

  /** Defaults to now. */
  createdAt?: Date;
};

export type CreateAuditLogResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

// ─── Sanitizers ───────────────────────────────────────────────────────────────

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + '…';
}

function sanitizeOptionalString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return truncate(trimmed, max);
}

function safeJsonObject(
  value: unknown,
  maxLength: number
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;

  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > maxLength) {
      return {
        _truncated: true,
        _originalLength: serialized.length,
        note: 'Payload exceeded storage limit and was truncated.',
      };
    }
    return value as Record<string, unknown>;
  } catch {
    return { _error: 'unserializable_payload' };
  }
}

function normalizeStatus(value: unknown): AuditStatus {
  if (value === 'failure' || value === 'partial' || value === 'success') {
    return value;
  }
  return 'success';
}

function normalizeSeverity(value: unknown): AuditSeverity {
  if (value === 'warning' || value === 'critical' || value === 'info') {
    return value;
  }
  return 'info';
}

// ─── Core write + prune ───────────────────────────────────────────────────────

/**
 * Insert an audit log row and prune the table to `MAX_AUDIT_LOG_ENTRIES`.
 *
 * Failures are swallowed (returned as `{ ok: false }`) so a logging error
 * never breaks the primary business action. Callers may still `await` this
 * or fire-and-forget via `c.executionCtx.waitUntil(...)`.
 */
export async function createAuditLog(
  db: Database,
  input: CreateAuditLogInput
): Promise<CreateAuditLogResult> {
  try {
    const action = sanitizeOptionalString(input.action, MAX_ACTION_LENGTH);
    const category = sanitizeOptionalString(
      input.category,
      MAX_CATEGORY_LENGTH
    );
    const rawDescription =
      typeof input.description === 'string' ? input.description.trim() : '';

    if (!action || !category || !rawDescription) {
      return {
        ok: false,
        error: 'action, category, and description are required.',
      };
    }

    const id = nanoid();
    const createdAt =
      input.createdAt instanceof Date ? input.createdAt : new Date();
    const actor = input.actor ?? null;

    await db.insert(auditLogs).values({
      id,
      action,
      category,
      description: truncate(rawDescription, MAX_DESCRIPTION_LENGTH),
      status: normalizeStatus(input.status),
      severity: normalizeSeverity(input.severity),

      actorId: sanitizeOptionalString(actor?.id, 128),
      actorName: sanitizeOptionalString(actor?.name, 255),
      actorEmail: sanitizeOptionalString(actor?.email, 254),
      actorRole: sanitizeOptionalString(actor?.role, 32),

      targetType: sanitizeOptionalString(input.targetType, 64),
      targetId: sanitizeOptionalString(input.targetId, 128),
      targetLabel: sanitizeOptionalString(
        input.targetLabel,
        MAX_TARGET_LABEL_LENGTH
      ),

      changes: safeJsonObject(input.changes, MAX_CHANGES_JSON_LENGTH),
      metadata: safeJsonObject(input.metadata, MAX_METADATA_JSON_LENGTH),

      ipAddress: sanitizeOptionalString(input.ipAddress, MAX_IP_LENGTH),
      userAgent: sanitizeOptionalString(input.userAgent, MAX_USER_AGENT_LENGTH),
      requestMethod: sanitizeOptionalString(input.requestMethod, 16),
      requestPath: sanitizeOptionalString(input.requestPath, MAX_PATH_LENGTH),

      createdAt,
    });

    // Keep only the newest MAX_AUDIT_LOG_ENTRIES rows.
    // SQLite needs a nested subquery when using DELETE … ORDER BY … LIMIT patterns.
    await db.run(sql`
      DELETE FROM audit_logs
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id FROM audit_logs
          ORDER BY created_at DESC, id DESC
          LIMIT ${MAX_AUDIT_LOG_ENTRIES}
        )
      )
    `);

    return { ok: true, id };
  } catch (error) {
    console.error('Failed to write audit log:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown audit log error',
    };
  }
}

// ─── Context helpers (for Hono route handlers) ────────────────────────────────

export type RequestAuditContext = {
  ipAddress: string | null;
  userAgent: string | null;
  requestMethod: string;
  requestPath: string;
};

/** Minimal request shape needed to capture audit request context. */
type AuditRequestLike = {
  req: {
    method: string;
    path: string;
    raw: { headers: Headers };
  };
};

/** Extract IP / UA / method / path from a Hono context. */
export function extractRequestAuditContext(
  c: AuditRequestLike
): RequestAuditContext {
  const headers = c.req.raw.headers;
  return {
    ipAddress: extractClientIp(headers),
    userAgent: headers.get('user-agent'),
    requestMethod: c.req.method,
    requestPath: c.req.path,
  };
}

export type LogAuditFromContextInput = Omit<
  CreateAuditLogInput,
  'actor' | 'ipAddress' | 'userAgent' | 'requestMethod' | 'requestPath'
> & {
  /** Override actor (defaults to middleware `getActor(c)`). */
  actor?: AuditActor | null;
  /** Skip reading actor/db from context (e.g. system jobs). */
  db?: Database;
};

/**
 * Convenience wrapper for route handlers that already use
 * `requireAdminMiddleware` (so `actor` + `db` are on the context).
 *
 * Usage:
 * ```ts
 * await logAuditFromContext(c, {
 *   action: AUDIT_ACTIONS.USER_BAN,
 *   category: AUDIT_CATEGORIES.USER,
 *   description: `Banned user ${target.email}`,
 *   targetType: AUDIT_TARGET_TYPES.USER,
 *   targetId: target.id,
 *   targetLabel: target.email,
 *   changes: { isBanned: { from: false, to: true }, bannedReason: { from: null, to: reason } },
 *   severity: 'warning',
 * });
 * ```
 *
 * Prefer fire-and-forget when the response must not wait on logging:
 * ```ts
 * c.executionCtx.waitUntil(logAuditFromContext(c, { ... }).then(() => undefined));
 * ```
 */
export async function logAuditFromContext(
  c: AppContext,
  input: LogAuditFromContextInput
): Promise<CreateAuditLogResult> {
  let db: Database;
  let actor: AuditActor | null = input.actor ?? null;

  try {
    db = input.db ?? getDb(c);
  } catch {
    return { ok: false, error: 'Database not available on context.' };
  }

  if (actor === null && input.actor === undefined) {
    try {
      const a = getActor(c);
      actor = {
        id: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
      };
    } catch {
      actor = null;
    }
  }

  const request = extractRequestAuditContext(c);

  return createAuditLog(db, {
    ...input,
    actor,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
    requestMethod: request.requestMethod,
    requestPath: request.requestPath,
  });
}

/**
 * Build a field-diff map from two plain objects (only keys you care about).
 * Skips keys whose values are deeply equal via JSON stringify.
 */
export function buildChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys?: string[]
): AuditChangeMap {
  const fields =
    keys ??
    Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changes: AuditChangeMap = {};

  for (const key of fields) {
    const from = before[key];
    const to = after[key];
    let same = false;
    try {
      same = JSON.stringify(from) === JSON.stringify(to);
    } catch {
      same = from === to;
    }
    if (!same) {
      changes[key] = { from, to };
    }
  }

  return changes;
}

/** Map an AdminActor to the shape expected by createAuditLog. */
export function actorFromAdmin(actor: AdminActor): AuditActor {
  return {
    id: actor.id,
    name: actor.name,
    email: actor.email,
    role: actor.role,
  };
}
