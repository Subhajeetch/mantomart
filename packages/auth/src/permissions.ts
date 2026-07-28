export const PERMISSIONS = {
  ANALYTICS_VIEW: 'analytics:view',
  PRODUCT_READ: 'product:read',
  PRODUCT_CREATE: 'product:create',
  PRODUCT_UPDATE: 'product:update',
  PRODUCT_DELETE: 'product:delete',

  CATEGORY_TREE_READ: 'category_tree:read',
  CATEGORY_MANAGE: 'category:manage',
  CATEGORY_CREATE: 'category:create',
  CATEGORY_UPDATE: 'category:update',
  CATEGORY_DELETE: 'category:delete',

  REVIEW_WRITE: 'review:write',
  REVIEW_DELETE: 'review:delete',
  REVIEW_MODERATE: 'review:moderate',

  ORDER_MANAGE: 'order:manage',
  ORDER_CREATE: 'order:create',
  ORDER_READ: 'order:read',
  ORDER_CANCEL: 'order:cancel',
  ORDER_REFUND: 'order:refund',

  USER_MANAGE: 'user:manage',
  USER_BAN: 'user:ban',
  USER_DELETE: 'user:delete',

  ADMIN_ACCESS: 'admin:access',

  AE_CONNECTION_REFRESH: 'ae_connection:refresh',
  AE_CONNECTION_MANAGE: 'ae_connection:manage',

  GOOGLE_CONNECTION_REFRESH: 'google_connection:refresh',
  GOOGLE_CONNECTION_MANAGE: 'google_connection:manage',
  GOOGLE_KEYWORD_RESEARCH: 'google_keyword:research',

  /** Generate SEO product copy via Google AI Studio (Gemini). */
  AI_SEO_GENERATE: 'ai_seo:generate',

  AUDIT_LOG_READ: 'audit_log:read',
  AUDIT_LOG_MANAGE: 'audit_log:manage',

  /**
   * Edit storefront header collections / nav menu.
   * Intentionally NOT on the default admin role — grant via override or owner.
   */
  HEADER_UPDATE: 'header:update',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const AUDIT_ACTIONS = {
  // Users
  USER_BAN: 'user.ban',
  USER_UNBAN: 'user.unban',
  USER_DELETE: 'user.delete',
  USER_UNDELETE: 'user.undelete',
  USER_UPDATE: 'user.update',

  // Admins
  ADMIN_PROMOTE: 'admin.promote',
  ADMIN_DEMOTE: 'admin.demote',
  ADMIN_ROLE_CHANGE: 'admin.role_change',
  ADMIN_PERMISSIONS_UPDATE: 'admin.permissions_update',

  // Products
  PRODUCT_CREATE: 'product.create',
  PRODUCT_UPDATE: 'product.update',
  PRODUCT_DELETE: 'product.delete',
  
  // Categories
  CATEGORY_CREATE: 'category.create',
  CATEGORY_UPDATE: 'category.update',
  CATEGORY_DELETE: 'category.delete',

  // Orders
  ORDER_UPDATE: 'order.update',
  ORDER_CANCEL: 'order.cancel',
  ORDER_REFUND: 'order.refund',

  // Reviews
  REVIEW_MODERATE: 'review.moderate',
  REVIEW_DELETE: 'review.delete',

  // AliExpress
  AE_CONNECT: 'ae.connect',
  AE_DISCONNECT: 'ae.disconnect',
  AE_TOKEN_REFRESH: 'ae.token_refresh',

  // Google Ads
  GOOGLE_CONNECT: 'google.connect',
  GOOGLE_DISCONNECT: 'google.disconnect',
  GOOGLE_TOKEN_REFRESH: 'google.token_refresh',

  // AI
  AI_SEO_GENERATE: 'ai_seo.generate',

  // Store header / nav
  HEADER_CREATE: 'header.create',
  HEADER_UPDATE: 'header.update',
  HEADER_DELETE: 'header.delete',

  // System
  SYSTEM: 'system.event',
} as const;

export type AuditAction =
  | (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]
  | (string & {});

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
    PERMISSIONS.CATEGORY_CREATE,
    PERMISSIONS.CATEGORY_UPDATE,
    PERMISSIONS.CATEGORY_DELETE,
    PERMISSIONS.REVIEW_WRITE,
    PERMISSIONS.REVIEW_DELETE,
    PERMISSIONS.REVIEW_MODERATE,
    PERMISSIONS.ORDER_CREATE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.ORDER_CANCEL,
    PERMISSIONS.ORDER_REFUND,
    PERMISSIONS.USER_BAN,
    PERMISSIONS.USER_DELETE,
    PERMISSIONS.ADMIN_ACCESS,
    PERMISSIONS.AE_CONNECTION_REFRESH,
    PERMISSIONS.GOOGLE_CONNECTION_REFRESH,
    PERMISSIONS.GOOGLE_KEYWORD_RESEARCH,
    PERMISSIONS.AI_SEO_GENERATE,
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
  overrides: PermissionOverride[]
): boolean {
  const override = overrides.find((o) => o.permission === permission);
  if (override !== undefined) return override.granted;
  return hasPermission(role, permission);
}

//resolve all permissions a user has (for frontend use)
export function resolveAllPermissions(
  role: string,
  overrides: PermissionOverride[]
): Permission[] {
  const all = Object.values(PERMISSIONS) as Permission[];
  return all.filter((p) => resolvePermission(role, p, overrides));
}
