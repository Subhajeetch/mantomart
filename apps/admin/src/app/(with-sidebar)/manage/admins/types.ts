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