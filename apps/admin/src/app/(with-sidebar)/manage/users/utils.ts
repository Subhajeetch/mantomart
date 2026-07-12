// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole = 'customer' | 'admin' | 'owner';

export type UserStatus = 'active' | 'banned' | 'deleted';

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: UserRole;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  isBanned: boolean;
  isDeleted: boolean;
  bannedReason: string | null;
  bannedAt: string | null;
  bannedBy: string | null;
  deletedAt: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Alias used by dialogs / cards */
export type AdminUser = User;

export type ListMeta = {
  currentUserId: string;
  currentUserRole: UserRole;
  canBan: boolean;
  canManage: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type UserStats = {
  total: number;
  active: number;
  banned: number;
  deleted: number;
  byRole: Record<string, number>;
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

export function getUsersApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  return origin ? `${origin}/api/users` : '/api/users';
}

export async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getUsersApiBase();
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
        'Users API not found. Restart the API server so /api/users is loaded.',
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
        ? 'You must be signed in to manage users.'
        : response.status === 403
          ? 'You do not have permission to perform this action.'
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

// ─── Role & Status helpers ────────────────────────────────────────────────────

export const ALL_ROLES: UserRole[] = ['customer', 'admin', 'owner'];
export const ALL_STATUSES: UserStatus[] = ['active', 'banned', 'deleted'];

export function getRoleLabel(role: UserRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function getStatusLabel(status: UserStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function getRoleBadgeVariant(
  role: UserRole
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (role) {
    case 'owner':
      return 'default';
    case 'admin':
      return 'secondary';
    case 'customer':
      return 'outline';
  }
}

export function getStatusBadgeVariant(
  status: UserStatus
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'banned':
      return 'destructive';
    case 'deleted':
      return 'secondary';
    case 'active':
      return 'default';
  }
}
