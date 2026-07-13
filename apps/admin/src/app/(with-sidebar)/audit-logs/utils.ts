// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditStatus = 'success' | 'failure' | 'partial';
export type AuditSeverity = 'info' | 'warning' | 'critical';

export type AuditLog = {
  id: string;
  action: string;
  category: string;
  description: string;
  status: AuditStatus;
  severity: AuditSeverity;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestMethod: string | null;
  requestPath: string | null;
  createdAt: string;
};

export type ListMeta = {
  currentUserId: string;
  currentUserRole: string;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  maxEntries: number;
  storedTotal: number;
};

export type AuditStats = {
  total: number;
  maxEntries: number;
  remaining: number;
  critical: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
};

export type AuditMeta = {
  knownActions: string[];
  knownCategories: string[];
  knownTargetTypes: string[];
  knownSeverities: AuditSeverity[];
  knownStatuses: AuditStatus[];
  usedActions: string[];
  usedCategories: string[];
  maxEntries: number;
};

export type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

export function getAuditLogsApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  return origin ? `${origin}/api/audit-logs` : '/api/audit-logs';
}

export async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getAuditLogsApiBase();
  const url = path.startsWith('http')
    ? path
    : `${base}${path.startsWith('/') ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      'Unable to reach the server. Check that the API is running.',
      0
    );
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    if (response.status === 404) {
      throw new ApiError(
        'Audit logs API not found. Restart the API server so /api/audit-logs is loaded.',
        404,
        'NOT_FOUND'
      );
    }
    if (!response.ok) {
      throw new ApiError(
        `Request failed with status ${response.status}.`,
        response.status
      );
    }
    throw new ApiError('Server returned an invalid response.', response.status);
  }

  if (!response.ok) {
    const errorBody = data as ApiErrorBody;
    const message =
      errorBody.error ||
      errorBody.message ||
      (response.status === 401
        ? 'You must be signed in to view audit logs.'
        : response.status === 403
          ? 'You do not have permission to view audit logs.'
          : response.status === 404
            ? 'Resource not found.'
            : `Request failed with status ${response.status}.`);

    throw new ApiError(message, response.status, errorBody.code);
  }

  const possibleError = data as ApiErrorBody;
  if (possibleError.success === false) {
    throw new ApiError(
      possibleError.error || possibleError.message || 'Request failed.',
      response.status,
      possibleError.code
    );
  }

  return data as T;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatRelative(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), 'day');
  return formatDateTime(date);
}

export function formatActionLabel(action: string) {
  // "user.ban" → "User ban"
  return action
    .split(/[._-]/)
    .filter(Boolean)
    .map((part, i) =>
      i === 0
        ? part.charAt(0).toUpperCase() + part.slice(1)
        : part.toLowerCase()
    )
    .join(' ');
}

export function getSeverityBadgeVariant(
  severity: AuditSeverity
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (severity) {
    case 'critical':
      return 'destructive';
    case 'warning':
      return 'secondary';
    case 'info':
    default:
      return 'outline';
  }
}

export function getStatusBadgeVariant(
  status: AuditStatus
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'failure':
      return 'destructive';
    case 'partial':
      return 'secondary';
    case 'success':
    default:
      return 'default';
  }
}

export function getCategoryColor(category: string): string {
  switch (category) {
    case 'user':
      return 'text-sky-600 dark:text-sky-400';
    case 'admin':
      return 'text-violet-600 dark:text-violet-400';
    case 'product':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'order':
      return 'text-amber-600 dark:text-amber-400';
    case 'ae':
      return 'text-orange-600 dark:text-orange-400';
    case 'audit':
      return 'text-rose-600 dark:text-rose-400';
    case 'system':
      return 'text-slate-600 dark:text-slate-400';
    default:
      return 'text-muted-foreground';
  }
}

/** Pretty-print changes/metadata JSON for the detail panel. */
export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ─── Timeline grouping ────────────────────────────────────────────────────────

/**
 * Same actor + same action within this window are stacked into one
 * collapsible timeline group.
 */
export const AUDIT_GROUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export type AuditLogGroup = {
  /** Stable key for React lists (first log id + count). */
  id: string;
  logs: AuditLog[];
  action: string;
  category: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  /** Highest severity in the group (critical > warning > info). */
  severity: AuditSeverity;
  /** Worst status if any failure, else partial, else success. */
  status: AuditStatus;
  newestAt: string;
  oldestAt: string;
};

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

const STATUS_RANK: Record<AuditStatus, number> = {
  success: 0,
  partial: 1,
  failure: 2,
};

function toMs(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function actorKey(log: AuditLog): string {
  return log.actorId ?? log.actorEmail ?? log.actorName ?? '__system__';
}

function canGroupWith(
  anchor: AuditLog,
  current: AuditLog,
  windowMs: number
): boolean {
  if (actorKey(anchor) !== actorKey(current)) return false;
  if (anchor.action !== current.action) return false;

  const anchorMs = toMs(anchor.createdAt);
  const currMs = toMs(current.createdAt);
  if (!anchorMs || !currMs) return false;

  // Strict bucket: every member must be within the window of the anchor event.
  return Math.abs(anchorMs - currMs) <= windowMs;
}

function maxSeverity(logs: AuditLog[]): AuditSeverity {
  let best: AuditSeverity = 'info';
  for (const log of logs) {
    if (SEVERITY_RANK[log.severity] > SEVERITY_RANK[best]) {
      best = log.severity;
    }
  }
  return best;
}

function maxStatus(logs: AuditLog[]): AuditStatus {
  let best: AuditStatus = 'success';
  for (const log of logs) {
    if (STATUS_RANK[log.status] > STATUS_RANK[best]) {
      best = log.status;
    }
  }
  return best;
}

/**
 * Collapse logs into timeline groups.
 *
 * The group starts at the first ungrouped log in the current sort order and
 * absorbs later logs on the same page from the same actor/action within the
 * configured window. Matching logs do not need to be adjacent, so an unrelated
 * event between two matching events will not split the group.
 *
 * Expects the list already sorted (typically newest-first from the API).
 */
export function groupAuditLogs(
  logs: AuditLog[],
  windowMs: number = AUDIT_GROUP_WINDOW_MS
): AuditLogGroup[] {
  if (logs.length === 0) return [];

  const groups: AuditLogGroup[] = [];
  const grouped = new Set<string>();

  const makeGroup = (bucket: AuditLog[]) => {
    const head = bucket[0];
    if (!head || bucket.length === 0) return null;

    const times = bucket.map((l) => toMs(l.createdAt)).filter((t) => t > 0);
    const newestMs =
      times.length > 0 ? Math.max(...times) : toMs(head.createdAt);
    const oldestMs =
      times.length > 0 ? Math.min(...times) : toMs(head.createdAt);

    return {
      id: `${head.id}:${bucket.length}`,
      logs: bucket,
      action: head.action,
      category: bucket[0]?.category ?? head.category,
      actorId: head.actorId,
      actorName: head.actorName,
      actorEmail: head.actorEmail,
      actorRole: head.actorRole,
      severity: maxSeverity(bucket),
      status: maxStatus(bucket),
      newestAt: new Date(newestMs || Date.now()).toISOString(),
      oldestAt: new Date(oldestMs || Date.now()).toISOString(),
    } satisfies AuditLogGroup;
  };

  for (let i = 0; i < logs.length; i++) {
    const anchor = logs[i];
    if (!anchor || grouped.has(anchor.id)) continue;

    const bucket: AuditLog[] = [anchor];
    grouped.add(anchor.id);

    for (let j = i + 1; j < logs.length; j++) {
      const candidate = logs[j];
      if (!candidate || grouped.has(candidate.id)) continue;

      if (canGroupWith(anchor, candidate, windowMs)) {
        bucket.push(candidate);
        grouped.add(candidate.id);
      }
    }

    const group = makeGroup(bucket);
    if (group) {
      groups.push(group);
    }
  }

  return groups;
}

/**
 * Human summary for a group header.
 * Single: original description.
 * Multi: e.g. "Created 10 products" / "User ban · 3 events".
 */
export function formatGroupSummary(group: AuditLogGroup): string {
  const n = group.logs.length;
  const only = group.logs[0];
  if (n === 1 && only) return only.description;

  const action = group.action;
  const label = formatActionLabel(action);

  // Verb-style for common dotted actions: product.create → "Created 10 products"
  const parts = action.split('.');
  if (parts.length >= 2) {
    const domain = parts[0] ?? 'item';
    const verb = parts[parts.length - 1] ?? 'event';
    const pluralDomain =
      domain.endsWith('s') || domain === 'ae' ? domain : `${domain}s`;

    const verbMap: Record<string, string> = {
      create: 'Created',
      update: 'Updated',
      delete: 'Deleted',
      ban: 'Banned',
      unban: 'Unbanned',
      undelete: 'Restored',
      promote: 'Promoted',
      demote: 'Demoted',
      publish: 'Published',
      unpublish: 'Unpublished',
      cancel: 'Cancelled',
      refund: 'Refunded',
      moderate: 'Moderated',
      connect: 'Connected',
      disconnect: 'Disconnected',
    };

    // role_change / permissions_update etc. stay generic
    if (verb.includes('_') || !verbMap[verb]) {
      return `${label} · ${n} events`;
    }

    const verbLabel = verbMap[verb];
    return `${verbLabel} ${n} ${pluralDomain}`;
  }

  return `${label} · ${n} events`;
}

/** Initials for avatar chip. */
export function getActorInitials(group: AuditLogGroup | AuditLog): string {
  const name =
    ('actorName' in group ? group.actorName : null) ||
    ('actorEmail' in group ? group.actorEmail : null) ||
    'S';
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Distinct non-empty target labels from a group (for preview chips). */
export function getGroupTargetPreview(
  group: AuditLogGroup,
  limit = 4
): { labels: string[]; remaining: number } {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const log of group.logs) {
    const label = log.targetLabel?.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    if (labels.length < limit) labels.push(label);
  }

  return {
    labels,
    remaining: Math.max(0, seen.size - labels.length),
  };
}
