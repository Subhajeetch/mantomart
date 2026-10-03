import { eq } from 'drizzle-orm';
import {
  PERMISSIONS,
  resolvePermission,
  type Permission,
  type PermissionOverride,
} from '@repo/auth/permissions';
import { userPermissions, users, type Database } from '@repo/db';

const KNOWN_PERMISSIONS = new Set<string>(Object.values(PERMISSIONS));

function isKnownAdminRole(role: string): role is 'admin' | 'owner' {
  return role === 'admin' || role === 'owner';
}

function isKnownPermission(permission: string): permission is Permission {
  return KNOWN_PERMISSIONS.has(permission);
}

function normalizeOverrides(
  rows: Array<{ permission: string; granted: boolean }>
): PermissionOverride[] {
  const byPermission = new Map<Permission, boolean>();

  for (const row of rows) {
    if (isKnownPermission(row.permission)) {
      byPermission.set(row.permission, row.granted);
    }
  }

  return Array.from(byPermission, ([permission, granted]) => ({
    permission,
    granted,
  }));
}

/**
 * Check whether an admin user can perform a permission-gated action.
 *
 * Owners always pass. Regular admins are resolved from role defaults plus
 * user_permissions override rows. Non-admin users, missing users, banned users,
 * and deleted users always fail closed.
 */
export async function adminHasPermission(
  db: Database,
  userId: string,
  permission: Permission
): Promise<boolean> {
  const [user] = await db
    .select({
      role: users.role,
      isBanned: users.isBanned,
      isDeleted: users.isDeleted,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.isBanned || user.isDeleted) return false;
  if (!isKnownAdminRole(user.role)) return false;
  if (user.role === 'owner') return true;

  const rows = await db
    .select({
      permission: userPermissions.permission,
      granted: userPermissions.granted,
    })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId))
    .orderBy(userPermissions.createdAt);

  return resolvePermission(user.role, permission, normalizeOverrides(rows));
}
