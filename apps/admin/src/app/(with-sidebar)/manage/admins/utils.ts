// ─── Types ────────────────────────────────────────────────────────────────────

export type AdminRole = 'admin' | 'owner';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: 'customer' | AdminRole;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  isBanned: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListMeta = {
  currentUserId: string;
  currentUserRole: string;
  canManage: boolean;
  total: number;
};

export type PermissionState = {
  permission: string;
  granted: boolean;
  defaultGranted: boolean;
  override: boolean | null;
};

export type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

// ─── API helpers ──────────────────────────────────────────────────────────────

export function getAdminsApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  // Prefer absolute API origin so session cookies (set by better-auth) are sent.
  // Fall back to same-origin rewrite when the env var is not set.
  return origin ? `${origin}/api/admins` : '/api/admins';
}

export async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getAdminsApiBase();
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
    throw new Error('Unable to reach the server. Please try again.');
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }
    throw new Error('Server returned an invalid response.');
  }

  if (!response.ok) {
    const errorBody = data as ApiErrorBody;
    throw new Error(
      errorBody.error ||
        errorBody.message ||
        `Request failed with status ${response.status}.`
    );
  }

  const possibleError = data as ApiErrorBody;
  if (possibleError.success === false) {
    throw new Error(
      possibleError.error || possibleError.message || 'Request failed.'
    );
  }

  return data as T;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

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

export function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function looksLikeEmail(value: string) {
  return value.includes('@');
}

export function formatPermissionText(value: string) {
  return value
    .replace(/[:_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getPermissionGroup(permission: string) {
  return formatPermissionText(permission.split(':')[0] ?? 'Other');
}

export function getPermissionAction(permission: string) {
  return formatPermissionText(permission.split(':')[1] ?? permission);
}