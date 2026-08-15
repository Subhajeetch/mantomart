// ─── Types ────────────────────────────────────────────────────────────────────

export type StatsSort = 'products' | 'orders' | 'revenue';

export type AdminStatRow = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  isBanned: boolean;
  isDeleted: boolean;
  isStaff: boolean;
  productsAdded: number;
  ordersCount: number;
  productsWithOrders: number;
  revenueCents: number;
  profitCents: number;
  lastProductAddedAt: string | null;
  lastOrderAt: string | null;
  updatedAt: string | null;
  rank: number;
};

export type StatsTotals = {
  contributors: number;
  productsAdded: number;
  ordersCount: number;
  productsWithOrders: number;
  revenueCents: number;
  profitCents: number;
};

export type SyncJob = {
  status: 'idle' | 'running' | 'success' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  triggeredBy: string | null;
  triggeredByName: string | null;
  error: string | null;
  adminsUpdated: number;
  productsScanned: number;
  ordersScanned: number;
  durationMs: number;
};

export type ListMeta = {
  currentUserId: string;
  currentUserRole: string;
  canManage: boolean;
  sort: StatsSort;
  search: string | null;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  totals: StatsTotals;
  lastSync: SyncJob;
};

export type LiveTotals = {
  productsAdded: number;
  ordersCount: number;
  productsWithOrders: number;
  revenueCents: number;
  profitCents: number;
  unattributedProducts: number;
  productsScanned: number;
};

export type SyncDrift = {
  stored: StatsTotals;
  live: LiveTotals;
  outOfSync: boolean;
};

export type SyncStatus = {
  job: SyncJob;
  drift: SyncDrift | null;
  canManage: boolean;
  running: boolean;
};

export type SyncResult = {
  adminsUpdated: number;
  productsScanned: number;
  ordersScanned: number;
  unattributedProducts: number;
  skippedOrphans: number;
  staffIncluded: number;
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

export const SORT_OPTIONS: {
  value: StatsSort;
  label: string;
  shortLabel: string;
}[] = [
  { value: 'products', label: 'Products added', shortLabel: 'Products' },
  { value: 'orders', label: 'Orders', shortLabel: 'Orders' },
  { value: 'revenue', label: 'Revenue', shortLabel: 'Revenue' },
];

// ─── API helpers ──────────────────────────────────────────────────────────────

export function getAdminStatsApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  return origin ? `${origin}/api/admin-stats` : '/api/admin-stats';
}

export async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getAdminStatsApiBase();
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
        'Admin stats API not found. Restart the API server so /api/admin-stats is loaded.',
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
        ? 'You must be signed in to view admin stats.'
        : response.status === 403
          ? 'You do not have permission to do that.'
          : response.status === 404
            ? 'Resource not found.'
            : response.status === 409
              ? 'A sync is already running.'
              : response.status === 429
                ? 'Please wait a moment before syncing again.'
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

export function formatMoney(cents: number | null | undefined) {
  const value = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(value / 100);
}

export function formatNumber(value: number | null | undefined) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(undefined).format(n);
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return 'Never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatRelative(value: string | Date | null | undefined) {
  if (!value) return 'Never';
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

export function formatDuration(ms: number | null | undefined) {
  const value = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function primaryMetric(row: AdminStatRow, sort: StatsSort): string {
  if (sort === 'orders') return formatNumber(row.ordersCount);
  if (sort === 'revenue') return formatMoney(row.revenueCents);
  return formatNumber(row.productsAdded);
}

export function primaryMetricLabel(sort: StatsSort): string {
  if (sort === 'orders') return 'orders';
  if (sort === 'revenue') return 'revenue';
  return 'products';
}

export function metricValue(row: AdminStatRow, sort: StatsSort): number {
  if (sort === 'orders') return row.ordersCount;
  if (sort === 'revenue') return row.revenueCents;
  return row.productsAdded;
}
