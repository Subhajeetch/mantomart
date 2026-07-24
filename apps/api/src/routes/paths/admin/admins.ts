import { Hono } from 'hono';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createAuth } from '@repo/auth/server';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  resolvePermission,
  type Permission,
  type PermissionOverride,
} from '@repo/auth/permissions';
import { createDb, userPermissions, users } from '@repo/db';
import type Env from '@/types/env';
import { errorJson, type EnvContext } from '@/utils/errorJson';
import { touchLastActive } from '@/utils/userActivity';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  createAuditLog,
  extractRequestAuditContext,
  type AuditActor,
} from '@/utils/auditLog';

type AdminRole = 'admin' | 'owner';
type UserRole = 'customer' | AdminRole;

const ADMIN_ROLES: AdminRole[] = ['admin', 'owner'];
const ASSIGNABLE_ROLES: AdminRole[] = ['admin', 'owner'];
const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];
const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

/** better-auth ids are short text tokens; reject absurd values early. */
const MAX_ID_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;

type Actor = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
};

type PermissionState = {
  permission: Permission;
  granted: boolean;
  defaultGranted: boolean;
  override: boolean | null;
};

const admins = new Hono<{ Bindings: Env }>();

function createAuthFromEnv(c: EnvContext) {
  const db = createDb(c.env.DB);
  const auth = createAuth(db, {
    GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
    NODE_ENV: c.env.NODE_ENV,
    API_URL: c.env.API_URL,
    ORIGINS: c.env.ORIGINS,
    DOMAIN: c.env.DOMAIN,
  });
  return { db, auth };
}

function isAdminRole(role: string | null | undefined): role is AdminRole {
  return role === 'admin' || role === 'owner';
}

function isOwner(role: string | null | undefined): boolean {
  return role === 'owner';
}

function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return false;
  // Practical email shape check (not full RFC). Rejects whitespace & control chars.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUserId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  // Allow typical auth ids (nanoid / uuid / alphanumerics with common separators).
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function serializeUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    isBanned: user.isBanned,
    lastLoginAt: user.lastLoginAt,
    lastLoginIp: user.lastLoginIp,
    lastActiveAt: user.lastActiveAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function toAuditActor(actor: Actor): AuditActor {
  return {
    id: actor.id,
    name: actor.name,
    email: actor.email,
    role: actor.role,
  };
}

function scheduleAdminAudit(
  c: EnvContext,
  db: ReturnType<typeof createDb>,
  actor: Actor,
  input: Parameters<typeof createAuditLog>[1]
) {
  const request = extractRequestAuditContext(c);
  c.executionCtx.waitUntil(
    createAuditLog(db, {
      ...input,
      actor: input.actor ?? toAuditActor(actor),
      ipAddress: input.ipAddress ?? request.ipAddress,
      userAgent: input.userAgent ?? request.userAgent,
      requestMethod: input.requestMethod ?? request.requestMethod,
      requestPath: input.requestPath ?? request.requestPath,
    }).then(() => undefined)
  );
}

async function countOwners(db: ReturnType<typeof createDb>) {
  const [result] = await db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.role, 'owner'), eq(users.isDeleted, false)));
  return Number(result?.value ?? 0);
}

/**
 * Authenticate via better-auth session, then re-load role from DB so
 * permission checks cannot be bypassed with a stale session role.
 */
async function requireAdminAccess(c: EnvContext) {
  const { db, auth } = createAuthFromEnv(c);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session?.user?.id) {
    return {
      ok: false as const,
      response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.'),
    };
  }

  const [dbUser] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isBanned: users.isBanned,
      isDeleted: users.isDeleted,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!dbUser || dbUser.isDeleted) {
    return {
      ok: false as const,
      response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.'),
    };
  }

  if (dbUser.isBanned) {
    return {
      ok: false as const,
      response: errorJson(c, 403, 'USER_BANNED', 'Your account is banned.'),
    };
  }

  if (!isAdminRole(dbUser.role)) {
    return {
      ok: false as const,
      response: errorJson(
        c,
        403,
        'FORBIDDEN',
        'Admin access is required for this resource.'
      ),
    };
  }

  const actor: Actor = {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
  };

  await touchLastActive(db, c.env.KV, dbUser.id);

  return { ok: true as const, actor, db };
}

/** Only owners can mutate admin membership / roles. */
async function requireOwnerAccess(c: EnvContext) {
  const access = await requireAdminAccess(c);
  if (!access.ok) return access;

  if (!isOwner(access.actor.role)) {
    return {
      ok: false as const,
      response: errorJson(
        c,
        403,
        'OWNER_REQUIRED',
        'Only owners can perform this action.'
      ),
    };
  }

  return access;
}

function parseRole(value: unknown): AdminRole | null {
  if (typeof value !== 'string') return null;
  const role = value.trim().toLowerCase();
  if (role === 'admin' || role === 'owner') return role;
  return null;
}

function isKnownPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_SET.has(value);
}

function parsePermissions(
  value: unknown
):
  | { ok: true; permissions: Permission[] }
  | { ok: false; code: string; message: string } {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      code: 'INVALID_PERMISSIONS',
      message: 'Permissions must be an array.',
    };
  }

  const permissions: Permission[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!isKnownPermission(item)) {
      return {
        ok: false,
        code: 'INVALID_PERMISSION',
        message: 'One or more permissions are not supported.',
      };
    }

    if (!seen.has(item)) {
      seen.add(item);
      permissions.push(item);
    }
  }

  return { ok: true, permissions };
}

function serializePermissionStates(
  role: UserRole,
  overrides: PermissionOverride[]
): PermissionState[] {
  if (role === 'owner') {
    return ALL_PERMISSIONS.map((permission) => ({
      permission,
      granted: true,
      defaultGranted: true,
      override: null,
    }));
  }

  return ALL_PERMISSIONS.map((permission) => {
    const override = overrides.find((item) => item.permission === permission);
    const defaultGranted =
      ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
    return {
      permission,
      granted: resolvePermission(role, permission, overrides),
      defaultGranted,
      override: override?.granted ?? null,
    };
  });
}

function buildPermissionOverrides(
  role: UserRole,
  grantedPermissions: Permission[]
): PermissionOverride[] {
  const granted = new Set(grantedPermissions);

  return ALL_PERMISSIONS.flatMap((permission) => {
    const selected = granted.has(permission);
    const defaultGranted =
      ROLE_PERMISSIONS[role]?.includes(permission) ?? false;

    if (selected === defaultGranted) return [];
    return [{ permission, granted: selected }];
  });
}

function normalizePermissionOverrides(
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
 * Parse a JSON body safely and reject non-objects / oversized payloads.
 * Hono already limits body size at the platform level; this is defense-in-depth.
 */
async function readJsonObject(
  c: EnvContext
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return {
      ok: false,
      response: errorJson(
        c,
        400,
        'INVALID_BODY',
        'Request body must be valid JSON.'
      ),
    };
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      response: errorJson(
        c,
        400,
        'INVALID_BODY',
        'Request body must be a JSON object.'
      ),
    };
  }

  return { ok: true, body: body as Record<string, unknown> };
}

function parseIdentifier(input: {
  email?: unknown;
  id?: unknown;
}):
  | { ok: true; email?: string; id?: string }
  | { ok: false; code: string; message: string } {
  const rawEmail =
    typeof input.email === 'string'
      ? input.email.trim().toLowerCase()
      : undefined;
  const rawId = typeof input.id === 'string' ? input.id.trim() : undefined;

  const email = rawEmail && rawEmail.length > 0 ? rawEmail : undefined;
  const id = rawId && rawId.length > 0 ? rawId : undefined;

  if (!email && !id) {
    return {
      ok: false,
      code: 'MISSING_IDENTIFIER',
      message: 'Provide either an email or a user id.',
    };
  }

  if (email && id) {
    return {
      ok: false,
      code: 'AMBIGUOUS_IDENTIFIER',
      message: 'Provide either an email or a user id, not both.',
    };
  }

  if (email && !isValidEmail(email)) {
    return {
      ok: false,
      code: 'INVALID_EMAIL',
      message: 'Invalid email format.',
    };
  }

  if (id && !isValidUserId(id)) {
    return {
      ok: false,
      code: 'INVALID_ID',
      message: 'Invalid user id format.',
    };
  }

  return { ok: true, email, id };
}

/**
 * Safety net against concurrent demotions leaving zero owners.
 * If we ever end up with 0 owners, re-promote the given user to owner.
 */
async function ensureAtLeastOneOwner(
  db: ReturnType<typeof createDb>,
  fallbackUserId: string
) {
  const owners = await countOwners(db);
  if (owners > 0) return { ok: true as const };

  await db
    .update(users)
    .set({ role: 'owner', updatedAt: new Date() })
    .where(eq(users.id, fallbackUserId));

  return { ok: false as const };
}

// ─── GET /all — list admins ───────────────────────────────────────────────────
admins.get('/all', async (c) => {
  const access = await requireAdminAccess(c);
  if (!access.ok) return access.response;

  try {
    const rows = await access.db
      .select()
      .from(users)
      .where(and(inArray(users.role, ADMIN_ROLES), eq(users.isDeleted, false)))
      .orderBy(
        sql`CASE WHEN ${users.role} = 'owner' THEN 0 ELSE 1 END`,
        users.name
      );

    return c.json({
      success: true,
      data: rows.map(serializeUser),
      meta: {
        currentUserId: access.actor.id,
        currentUserRole: access.actor.role,
        canManage: isOwner(access.actor.role),
        total: rows.length,
      },
    });
  } catch (error) {
    console.error('Error listing admins:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load admins.');
  }
});

// ─── GET /lookup — preview a user by email or id before promoting ─────────────
admins.get('/lookup', async (c) => {
  const access = await requireOwnerAccess(c);
  if (!access.ok) return access.response;

  const parsed = parseIdentifier({
    email: c.req.query('email'),
    id: c.req.query('id'),
  });

  if (!parsed.ok) {
    return errorJson(c, 400, parsed.code, parsed.message);
  }

  try {
    const [user] = await access.db
      .select()
      .from(users)
      .where(
        and(
          parsed.email
            ? sql`lower(${users.email}) = ${parsed.email}`
            : eq(users.id, parsed.id!),
          eq(users.isDeleted, false)
        )
      )
      .limit(1);

    if (!user) {
      // Generic message — do not leak whether email exists vs wrong id
      return errorJson(
        c,
        404,
        'USER_NOT_FOUND',
        'No user found with that email or id.'
      );
    }

    if (user.isBanned) {
      return errorJson(
        c,
        400,
        'USER_BANNED',
        'This user is banned and cannot be promoted to admin.'
      );
    }

    return c.json({
      success: true,
      data: serializeUser(user),
      meta: {
        alreadyAdmin: isAdminRole(user.role),
        canPromote: user.role === 'customer',
      },
    });
  } catch (error) {
    console.error('Error looking up user:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to look up user.');
  }
});

// ─── POST /add — promote a user to admin/owner ────────────────────────────────
admins.post('/add', async (c) => {
  const access = await requireOwnerAccess(c);
  if (!access.ok) return access.response;

  const parsedBody = await readJsonObject(c);
  if (!parsedBody.ok) return parsedBody.response;

  const { body } = parsedBody;
  const identifier = parseIdentifier({ email: body.email, id: body.id });
  if (!identifier.ok) {
    return errorJson(c, 400, identifier.code, identifier.message);
  }

  const role = parseRole(body.role ?? 'admin');
  if (!role) {
    return errorJson(
      c,
      400,
      'INVALID_ROLE',
      `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}.`
    );
  }

  try {
    const [user] = await access.db
      .select()
      .from(users)
      .where(
        and(
          identifier.email
            ? sql`lower(${users.email}) = ${identifier.email}`
            : eq(users.id, identifier.id!),
          eq(users.isDeleted, false)
        )
      )
      .limit(1);

    if (!user) {
      return errorJson(
        c,
        404,
        'USER_NOT_FOUND',
        'No user found with that email or id.'
      );
    }

    // Never let an owner re-promote themselves via this endpoint (no-op / confuse)
    if (user.id === access.actor.id) {
      return errorJson(
        c,
        400,
        'CANNOT_PROMOTE_SELF',
        'You are already an admin.'
      );
    }

    if (user.isBanned) {
      return errorJson(
        c,
        400,
        'USER_BANNED',
        'This user is banned and cannot be promoted to admin.'
      );
    }

    // Strict: only regular customers can be elevated (blocks unknown / future roles)
    if (user.role !== 'customer') {
      if (isAdminRole(user.role)) {
        return errorJson(
          c,
          409,
          'ALREADY_ADMIN',
          'This user is already an admin.'
        );
      }
      return errorJson(
        c,
        400,
        'INVALID_USER_STATE',
        'Only customer accounts can be promoted to admin.'
      );
    }

    const now = new Date();

    // Conditional update: only promote if still a customer (prevents race)
    const updated = await access.db
      .update(users)
      .set({ role, updatedAt: now })
      .where(
        and(
          eq(users.id, user.id),
          eq(users.role, 'customer'),
          eq(users.isDeleted, false),
          eq(users.isBanned, false)
        )
      )
      .returning();

    if (updated.length === 0) {
      return errorJson(
        c,
        409,
        'CONFLICT',
        'Could not promote this user. Their account may have changed — try again.'
      );
    }

    const promoted = updated[0];
    scheduleAdminAudit(c, access.db, access.actor, {
      action: AUDIT_ACTIONS.ADMIN_PROMOTE,
      category: AUDIT_CATEGORIES.ADMIN,
      description: `Promoted ${promoted.name} (${promoted.email}) to ${role}`,
      targetType: AUDIT_TARGET_TYPES.ADMIN,
      targetId: promoted.id,
      targetLabel: promoted.email,
      severity: role === 'owner' ? 'critical' : 'warning',
      changes: {
        role: { from: 'customer', to: role },
      },
    });

    return c.json(
      {
        success: true,
        message: `${promoted.name} is now an ${role}.`,
        data: serializeUser(promoted),
      },
      201
    );
  } catch (error) {
    console.error('Error adding admin:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to add admin.');
  }
});

// ─── PATCH /:id/role — update an admin's role ─────────────────────────────────
admins.patch('/:id/role', async (c) => {
  const access = await requireOwnerAccess(c);
  if (!access.ok) return access.response;

  const targetId = c.req.param('id')?.trim() ?? '';
  if (!isValidUserId(targetId)) {
    return errorJson(c, 400, 'INVALID_ID', 'Invalid admin id.');
  }

  const parsedBody = await readJsonObject(c);
  if (!parsedBody.ok) return parsedBody.response;

  const newRole = parseRole(parsedBody.body.role);
  if (!newRole) {
    return errorJson(
      c,
      400,
      'INVALID_ROLE',
      `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}.`
    );
  }

  try {
    const [target] = await access.db
      .select()
      .from(users)
      .where(and(eq(users.id, targetId), eq(users.isDeleted, false)))
      .limit(1);

    if (!target) {
      return errorJson(c, 404, 'USER_NOT_FOUND', 'Admin not found.');
    }

    if (!isAdminRole(target.role)) {
      return errorJson(
        c,
        400,
        'NOT_AN_ADMIN',
        'This user is not an admin. Promote them first.'
      );
    }

    if (target.role === newRole) {
      return errorJson(
        c,
        400,
        'ROLE_UNCHANGED',
        `User already has the role "${newRole}".`
      );
    }

    // Demoting owner → admin: block if this is the last owner
    if (target.role === 'owner' && newRole === 'admin') {
      const owners = await countOwners(access.db);
      if (owners <= 1) {
        return errorJson(
          c,
          400,
          'LAST_OWNER',
          'Cannot demote the last owner. Promote another owner first.'
        );
      }
    }

    const now = new Date();
    const previousRole = target.role;

    // Conditional update based on current role (reduces race windows)
    const updated = await access.db
      .update(users)
      .set({ role: newRole, updatedAt: now })
      .where(
        and(
          eq(users.id, targetId),
          eq(users.role, previousRole),
          eq(users.isDeleted, false),
          inArray(users.role, ADMIN_ROLES)
        )
      )
      .returning();

    if (updated.length === 0) {
      return errorJson(
        c,
        409,
        'CONFLICT',
        'Could not update role. The admin may have changed — refresh and try again.'
      );
    }

    // Concurrent demotion safety: never allow zero owners
    if (previousRole === 'owner' && newRole === 'admin') {
      const ensured = await ensureAtLeastOneOwner(access.db, targetId);
      if (!ensured.ok) {
        return errorJson(
          c,
          400,
          'LAST_OWNER',
          'Cannot demote the last owner. Promote another owner first.'
        );
      }
    }

    const roleUpdated = updated[0];
    scheduleAdminAudit(c, access.db, access.actor, {
      action: AUDIT_ACTIONS.ADMIN_ROLE_CHANGE,
      category: AUDIT_CATEGORIES.ADMIN,
      description: `Changed role of ${roleUpdated.name} from ${previousRole} to ${newRole}`,
      targetType: AUDIT_TARGET_TYPES.ADMIN,
      targetId: roleUpdated.id,
      targetLabel: roleUpdated.email,
      severity:
        previousRole === 'owner' || newRole === 'owner' ? 'critical' : 'warning',
      changes: {
        role: { from: previousRole, to: newRole },
      },
    });

    return c.json({
      success: true,
      message: `Role updated to ${newRole}.`,
      data: serializeUser(roleUpdated),
    });
  } catch (error) {
    console.error('Error updating admin role:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to update admin role.');
  }
});

// ─── GET /:id/permissions — load effective permissions for an admin ──────────
admins.get('/:id/permissions', async (c) => {
  const access = await requireOwnerAccess(c);
  if (!access.ok) return access.response;

  const targetId = c.req.param('id')?.trim() ?? '';
  if (!isValidUserId(targetId)) {
    return errorJson(c, 400, 'INVALID_ID', 'Invalid admin id.');
  }

  try {
    const [target] = await access.db
      .select()
      .from(users)
      .where(and(eq(users.id, targetId), eq(users.isDeleted, false)))
      .limit(1);

    if (!target) {
      return errorJson(c, 404, 'USER_NOT_FOUND', 'Admin not found.');
    }

    if (!isAdminRole(target.role)) {
      return errorJson(c, 400, 'NOT_AN_ADMIN', 'This user is not an admin.');
    }

    const overrideRows = await access.db
      .select({
        permission: userPermissions.permission,
        granted: userPermissions.granted,
      })
      .from(userPermissions)
      .where(eq(userPermissions.userId, targetId))
      .orderBy(userPermissions.createdAt);

    const overrides = normalizePermissionOverrides(overrideRows);

    return c.json({
      success: true,
      data: {
        user: serializeUser(target),
        permissions: serializePermissionStates(target.role, overrides),
      },
      meta: {
        canUpdate: true,
        ownerHasAllPermissions: target.role === 'owner',
      },
    });
  } catch (error) {
    console.error('Error loading admin permissions:', error);
    return errorJson(
      c,
      500,
      'INTERNAL_ERROR',
      'Failed to load admin permissions.'
    );
  }
});

// ─── PATCH /:id/permissions — replace override permissions for an admin ──────
admins.patch('/:id/permissions', async (c) => {
  const access = await requireOwnerAccess(c);
  if (!access.ok) return access.response;

  const targetId = c.req.param('id')?.trim() ?? '';
  if (!isValidUserId(targetId)) {
    return errorJson(c, 400, 'INVALID_ID', 'Invalid admin id.');
  }

  const parsedBody = await readJsonObject(c);
  if (!parsedBody.ok) return parsedBody.response;

  const parsedPermissions = parsePermissions(parsedBody.body.permissions);
  if (!parsedPermissions.ok) {
    return errorJson(c, 400, parsedPermissions.code, parsedPermissions.message);
  }

  try {
    const [target] = await access.db
      .select()
      .from(users)
      .where(and(eq(users.id, targetId), eq(users.isDeleted, false)))
      .limit(1);

    if (!target) {
      return errorJson(c, 404, 'USER_NOT_FOUND', 'Admin not found.');
    }

    if (!isAdminRole(target.role)) {
      return errorJson(c, 400, 'NOT_AN_ADMIN', 'This user is not an admin.');
    }

    if (target.role === 'owner') {
      await access.db
        .delete(userPermissions)
        .where(eq(userPermissions.userId, targetId));

      return c.json({
        success: true,
        message: 'Owners always have all permissions.',
        data: {
          user: serializeUser(target),
          permissions: serializePermissionStates(target.role, []),
        },
      });
    }

    const now = new Date();
    const overrides = buildPermissionOverrides(
      target.role,
      parsedPermissions.permissions
    );
    const deleteOverrides = access.db
      .delete(userPermissions)
      .where(eq(userPermissions.userId, targetId));

    if (overrides.length === 0) {
      await access.db.batch([deleteOverrides]);
    } else {
      const insertOverrides = access.db.insert(userPermissions).values(
        overrides.map((override) => ({
          id: nanoid(),
          userId: targetId,
          permission: override.permission,
          granted: override.granted,
          grantedBy: access.actor.id,
          createdAt: now,
        }))
      );

      await access.db.batch([deleteOverrides, insertOverrides]);
    }

    scheduleAdminAudit(c, access.db, access.actor, {
      action: AUDIT_ACTIONS.ADMIN_PERMISSIONS_UPDATE,
      category: AUDIT_CATEGORIES.ADMIN,
      description: `Updated permissions for ${target.name} (${target.email})`,
      targetType: AUDIT_TARGET_TYPES.ADMIN,
      targetId: target.id,
      targetLabel: target.email,
      severity: 'warning',
      changes: {
        permissions: {
          to: parsedPermissions.permissions,
          overrides,
        },
      },
      metadata: {
        grantedCount: parsedPermissions.permissions.length,
        overrideCount: overrides.length,
      },
    });

    return c.json({
      success: true,
      message: 'Permissions updated.',
      data: {
        user: serializeUser(target),
        permissions: serializePermissionStates(target.role, overrides),
      },
    });
  } catch (error) {
    console.error('Error updating admin permissions:', error);
    return errorJson(
      c,
      500,
      'INTERNAL_ERROR',
      'Failed to update admin permissions.'
    );
  }
});

// ─── DELETE /:id — remove admin privileges (demote to customer) ───────────────
admins.delete('/:id', async (c) => {
  const access = await requireOwnerAccess(c);
  if (!access.ok) return access.response;

  const targetId = c.req.param('id')?.trim() ?? '';
  if (!isValidUserId(targetId)) {
    return errorJson(c, 400, 'INVALID_ID', 'Invalid admin id.');
  }

  if (targetId === access.actor.id) {
    return errorJson(
      c,
      400,
      'CANNOT_REMOVE_SELF',
      'You cannot remove your own admin access.'
    );
  }

  try {
    const [target] = await access.db
      .select()
      .from(users)
      .where(and(eq(users.id, targetId), eq(users.isDeleted, false)))
      .limit(1);

    if (!target) {
      return errorJson(c, 404, 'USER_NOT_FOUND', 'Admin not found.');
    }

    if (!isAdminRole(target.role)) {
      return errorJson(c, 400, 'NOT_AN_ADMIN', 'This user is not an admin.');
    }

    if (target.role === 'owner') {
      const owners = await countOwners(access.db);
      if (owners <= 1) {
        return errorJson(
          c,
          400,
          'LAST_OWNER',
          'Cannot remove the last owner. Promote another owner first.'
        );
      }
    }

    const now = new Date();
    const previousRole = target.role;

    const updated = await access.db
      .update(users)
      .set({ role: 'customer' as UserRole, updatedAt: now })
      .where(
        and(
          eq(users.id, targetId),
          eq(users.role, previousRole),
          eq(users.isDeleted, false),
          inArray(users.role, ADMIN_ROLES)
        )
      )
      .returning();

    if (updated.length === 0) {
      return errorJson(
        c,
        409,
        'CONFLICT',
        'Could not remove admin. Their role may have changed — refresh and try again.'
      );
    }

    if (previousRole === 'owner') {
      const ensured = await ensureAtLeastOneOwner(access.db, targetId);
      if (!ensured.ok) {
        // User was restored to owner by the safety net
        return errorJson(
          c,
          400,
          'LAST_OWNER',
          'Cannot remove the last owner. Promote another owner first.'
        );
      }
    }

    const demoted = updated[0];
    scheduleAdminAudit(c, access.db, access.actor, {
      action: AUDIT_ACTIONS.ADMIN_DEMOTE,
      category: AUDIT_CATEGORIES.ADMIN,
      description: `Removed admin access from ${demoted.name} (${demoted.email})`,
      targetType: AUDIT_TARGET_TYPES.ADMIN,
      targetId: demoted.id,
      targetLabel: demoted.email,
      severity: previousRole === 'owner' ? 'critical' : 'warning',
      changes: {
        role: { from: previousRole, to: 'customer' },
      },
    });

    return c.json({
      success: true,
      message: `${demoted.name} is no longer an admin.`,
      data: serializeUser(demoted),
    });
  } catch (error) {
    console.error('Error removing admin:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to remove admin.');
  }
});

export default admins;
