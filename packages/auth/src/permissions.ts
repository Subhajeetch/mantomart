export const PERMISSIONS = {
  ANALYTICS_VIEW:  "analytics:view",
  PRODUCT_READ:    "product:read",
  PRODUCT_CREATE:  "product:create",
  PRODUCT_UPDATE:  "product:update",
  PRODUCT_DELETE:  "product:delete",

  CATEGORY_TREE_READ: "category_tree:read",
  CATEGORY_MANAGE:    "category:manage",

  REVIEW_WRITE:    "review:write",
  REVIEW_DELETE:   "review:delete",
  REVIEW_MODERATE: "review:moderate",

  ORDER_READ:      "order:read",
  ORDER_CANCEL:    "order:cancel",
  ORDER_REFUND:    "order:refund",

  USER_BAN:        "user:ban",
  USER_MANAGE:     "user:manage",

  ADMIN_ACCESS:    "admin:access",

  AE_CONNECTION_REFRESH: "ae_connection:refresh",
  AE_CONNECTION_MANAGE: "ae_connection:manage",

  AUDIT_LOG_READ: 'audit_log:read',
  AUDIT_LOG_MANAGE: 'audit_log:manage',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];


export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  customer: [
    PERMISSIONS.PRODUCT_READ,
    PERMISSIONS.REVIEW_WRITE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.ORDER_CANCEL,
  ],
  admin: [
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.PRODUCT_READ,
    PERMISSIONS.PRODUCT_CREATE,
    PERMISSIONS.PRODUCT_UPDATE,
    PERMISSIONS.PRODUCT_DELETE,
    PERMISSIONS.CATEGORY_TREE_READ,
    PERMISSIONS.CATEGORY_MANAGE,
    PERMISSIONS.REVIEW_WRITE,
    PERMISSIONS.REVIEW_DELETE,
    PERMISSIONS.REVIEW_MODERATE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.ORDER_CANCEL,
    PERMISSIONS.ORDER_REFUND,
    PERMISSIONS.USER_BAN,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.ADMIN_ACCESS,
    PERMISSIONS.AE_CONNECTION_REFRESH,
    PERMISSIONS.AUDIT_LOG_READ,
  ],
  owner: Object.values(PERMISSIONS) as Permission[],
};


export type PermissionOverride = {
  permission: Permission;
  granted: boolean;
};

// role only check (no overrides)
export function hasPermission(role: string, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

//final check.. override wins over role
export function resolvePermission(
  role: string,
  permission: Permission,
  overrides: PermissionOverride[],
): boolean {
  const override = overrides.find(o => o.permission === permission);
  if (override !== undefined) return override.granted;
  return hasPermission(role, permission);
}

//resolve all permissions a user has (for frontend use)
export function resolveAllPermissions(
  role: string,
  overrides: PermissionOverride[],
): Permission[] {
  const all = Object.values(PERMISSIONS) as Permission[];
  return all.filter(p => resolvePermission(role, p, overrides));
}