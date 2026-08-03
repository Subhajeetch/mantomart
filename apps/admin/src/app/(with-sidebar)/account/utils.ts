// ─── Types ────────────────────────────────────────────────────────────────────

export type AdminRole = 'admin' | 'owner';

export type LinkedProvider = {
  providerId: string;
  createdAt: string | null;
};

export type AdminAccount = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: AdminRole;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  locale: string;
  timezone: string;
  currency: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
  linkedProviders: LinkedProvider[];
  activeSessionCount: number;
};

export type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

// ─── API helpers ──────────────────────────────────────────────────────────────

export function getAccountApiUrl() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  // Prefer absolute API origin so session cookies are sent cross-origin.
  return origin ? `${origin}/api/admin/account` : '/api/admin/account';
}

export async function requestAccountJson<T>(
  options: RequestInit = {}
): Promise<T> {
  const url = getAccountApiUrl();

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      method: options.method ?? 'GET',
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

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
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

  if (abs < minute) return 'Just now';
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
    .slice(0, 2) || '?';
}

/** Soft-mask middle of IPv4 / leave short values alone. Own-account display. */
export function maskIp(ip: string | null | undefined): string {
  if (!ip || !ip.trim()) return '—';
  const value = ip.trim();
  // IPv4
  const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    return `${v4[1]}.${v4[2]}.•••.${v4[4]}`;
  }
  // IPv6 — keep first two hextets
  if (value.includes(':')) {
    const parts = value.split(':').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]}:${parts[1]}:••••`;
    }
  }
  return value;
}

export function providerLabel(providerId: string): string {
  const id = providerId.toLowerCase();
  if (id === 'credential' || id === 'email' || id === 'password') {
    return 'Email & password';
  }
  if (id === 'google') return 'Google';
  if (id === 'github') return 'GitHub';
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

export function getProfileEditUrl(): string {
  // Keep in sync with app-urls getStoreUrl so edit always lands on the store.
  const fromEnv = process.env.NEXT_PUBLIC_STORE_URL?.trim();
  let base: string;
  if (fromEnv) {
    base = fromEnv.replace(/\/$/, '');
  } else if (process.env.NODE_ENV === 'production') {
    base = 'https://mantomart.com';
  } else {
    base = 'http://localhost:8000';
  }
  return `${base}/profile/edit`;
}
