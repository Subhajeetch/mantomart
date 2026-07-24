// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole = 'customer' | 'admin' | 'owner';

export type UserStatus = 'active' | 'banned' | 'deleted';

export type UserGender =
  | 'male'
  | 'female'
  | 'other'
  | 'prefer_not_to_say';

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

/** Full user detail from GET /:id */
export type UserDetail = User & {
  dateOfBirth: string | null;
  gender: UserGender | null;
  phoneVerified: boolean;
  defaultAddressId: string | null;
  emailNotifications: boolean;
  smsNotifications: boolean;
  currency: string;
  locale: string;
  timezone: string;
  loyaltyPoints: number;
  ragiCoins: number;
  referralCode: string | null;
  referredBy: string | null;
  totalSpent: number;
  totalOrders: number;
  averageOrderValue: number;
  isVipUser: boolean;
  isVerifiedSeller: boolean;
  adminNotes: string | null;
};

export type UserDetailMeta = {
  canBan: boolean;
  canManage: boolean;
  canDelete: boolean;
  canEdit: boolean;
  isSelf: boolean;
  editableFields: readonly string[];
};

/** Alias used by dialogs / cards */
export type AdminUser = User;

export type ListMeta = {
  currentUserId: string;
  currentUserRole: UserRole;
  canBan: boolean;
  canDelete: boolean;
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

/** Payload keys accepted by PATCH /:id */
export type UserUpdatePayload = {
  name?: string;
  email?: string;
  emailVerified?: boolean;
  image?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  gender?: UserGender | null;
  phone?: string | null;
  phoneVerified?: boolean;
  emailNotifications?: boolean;
  smsNotifications?: boolean;
  currency?: string;
  locale?: string;
  timezone?: string;
  adminNotes?: string | null;
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

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return 'Not set';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
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

  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), 'day');
  return formatDateTime(date);
}

export function formatMoney(value: number | null | undefined, currency = 'USD') {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || 'USD'}`;
  }
}

export function formatBool(value: boolean | null | undefined) {
  if (value === null || value === undefined) return '—';
  return value ? 'Yes' : 'No';
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

export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function genderLabel(gender: UserGender | null | undefined): string {
  if (!gender) return 'Not set';
  switch (gender) {
    case 'prefer_not_to_say':
      return 'Prefer not to say';
    case 'male':
      return 'Male';
    case 'female':
      return 'Female';
    case 'other':
      return 'Other';
    default:
      return gender;
  }
}

// ─── Role & Status helpers ────────────────────────────────────────────────────

export const ALL_ROLES: UserRole[] = ['customer', 'admin', 'owner'];
export const ALL_STATUSES: UserStatus[] = ['active', 'banned', 'deleted'];
export const ALL_GENDERS: UserGender[] = [
  'male',
  'female',
  'other',
  'prefer_not_to_say',
];

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

export function getUserStatus(user: Pick<User, 'isBanned' | 'isDeleted'>): UserStatus {
  if (user.isDeleted) return 'deleted';
  if (user.isBanned) return 'banned';
  return 'active';
}

/** Human-readable labels for change diffs in confirmation dialogs. */
export const FIELD_LABELS: Record<keyof UserUpdatePayload, string> = {
  name: 'Display name',
  email: 'Email',
  emailVerified: 'Email verified',
  image: 'Avatar URL',
  firstName: 'First name',
  lastName: 'Last name',
  dateOfBirth: 'Date of birth',
  gender: 'Gender',
  phone: 'Phone',
  phoneVerified: 'Phone verified',
  emailNotifications: 'Email notifications',
  smsNotifications: 'SMS notifications',
  currency: 'Currency',
  locale: 'Locale',
  timezone: 'Timezone',
  adminNotes: 'Admin notes',
};

export function formatFieldValue(
  field: keyof UserUpdatePayload,
  value: unknown
): string {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (field === 'dateOfBirth' && typeof value === 'string') {
    return formatDate(value);
  }
  if (field === 'gender' && typeof value === 'string') {
    return genderLabel(value as UserGender);
  }
  return String(value);
}
