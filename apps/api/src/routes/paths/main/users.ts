import { Hono } from 'hono';
import { and, asc, count, desc, eq, like, or, sql, type SQL } from 'drizzle-orm';
import { PERMISSIONS } from '@repo/auth/permissions';
import { userPermissions, users, type Database } from '@repo/db';
import {
  errorJson,
  type AppEnv,
  type AppContext,
} from '@/utils/errorJson';
import { adminHasPermission } from '@/utils/permissions';
import {
  requireAdminMiddleware,
  requirePermission,
  getActor,
  getDb,
} from '@/middleware/permission';

type UserRole = 'customer' | 'admin' | 'owner';
type UserStatus = 'active' | 'banned' | 'deleted';

const ALL_ROLES: UserRole[] = ['customer', 'admin', 'owner'];
const ALL_STATUSES: UserStatus[] = ['active', 'banned', 'deleted'];
const SORTABLE_COLUMNS = [
  'name',
  'email',
  'role',
  'createdAt',
  'updatedAt',
  'lastActiveAt',
  'lastLoginAt',
] as const;
type SortColumn = (typeof SORTABLE_COLUMNS)[number];

const MAX_ID_LENGTH = 128;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const MAX_BAN_REASON_LENGTH = 500;

function isOwner(role: string | null | undefined): boolean {
  return role === 'owner';
}

function isValidUserId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function sanitizeRole(value: unknown): UserRole | null {
  if (typeof value !== 'string') return null;
  const role = value.trim().toLowerCase() as UserRole;
  return ALL_ROLES.includes(role) ? role : null;
}

function sanitizeStatus(value: unknown): UserStatus | null {
  if (typeof value !== 'string') return null;
  const status = value.trim().toLowerCase() as UserStatus;
  return ALL_STATUSES.includes(status) ? status : null;
}

function sanitizeSearch(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const search = value.trim();
  return search.length > 0 && search.length <= 100 ? search : null;
}

function sanitizeSortBy(value: unknown): SortColumn {
  if (typeof value !== 'string') return 'createdAt';
  return (SORTABLE_COLUMNS as readonly string[]).includes(value)
    ? (value as SortColumn)
    : 'createdAt';
}

function serializeUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    role: user.role as UserRole,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    isBanned: user.isBanned,
    isDeleted: user.isDeleted,
    bannedReason: user.bannedReason,
    bannedAt: user.bannedAt,
    bannedBy: user.bannedBy,
    deletedAt: user.deletedAt,
    lastLoginAt: user.lastLoginAt,
    lastLoginIp: user.lastLoginIp,
    lastActiveAt: user.lastActiveAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function resolveActorCapabilities(
  db: Database,
  actorId: string,
  role: string
) {
  if (isOwner(role)) {
    return { canBan: true, canManage: true };
  }

  const [canBan, canManage] = await Promise.all([
    adminHasPermission(db, actorId, PERMISSIONS.USER_BAN),
    adminHasPermission(db, actorId, PERMISSIONS.USER_MANAGE),
  ]);

  return { canBan, canManage };
}

function buildWhere(
  search: string | null,
  role: UserRole | null,
  status: UserStatus | null
): SQL | undefined {
  const conditions: SQL[] = [];

  // Default: hide soft-deleted accounts unless explicitly requested.
  if (status === 'deleted') {
    conditions.push(eq(users.isDeleted, true));
  } else if (status === 'banned') {
    conditions.push(eq(users.isBanned, true), eq(users.isDeleted, false));
  } else if (status === 'active') {
    conditions.push(eq(users.isBanned, false), eq(users.isDeleted, false));
  } else {
    conditions.push(eq(users.isDeleted, false));
  }

  if (search) {
    const escaped = search
      .toLowerCase()
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    const likePattern = `%${escaped}%`;
    conditions.push(
      or(
        like(sql`lower(${users.name})`, likePattern),
        like(sql`lower(${users.email})`, likePattern),
        like(sql`lower(${users.id})`, likePattern)
      )!
    );
  }

  if (role) {
    conditions.push(eq(users.role, role));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function buildOrderBy(sortBy: SortColumn, sortOrder: 'asc' | 'desc') {
  const columnMap = {
    name: users.name,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
    lastActiveAt: users.lastActiveAt,
    lastLoginAt: users.lastLoginAt,
  } as const;

  const column = columnMap[sortBy];
  return sortOrder === 'asc' ? asc(column) : desc(column);
}

async function readJsonObject(
  c: AppContext
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

async function listUsersHandler(c: AppContext) {
  const actor = getActor(c);
  const db = getDb(c);

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      parseInt(c.req.query('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) ||
        DEFAULT_PAGE_SIZE
    )
  );
  const search = sanitizeSearch(c.req.query('search'));
  const role = sanitizeRole(c.req.query('role'));
  const status = sanitizeStatus(c.req.query('status'));
  const sortBy = sanitizeSortBy(c.req.query('sortBy'));
  const sortOrder = c.req.query('sortOrder') === 'asc' ? 'asc' : 'desc';

  try {
    const where = buildWhere(search, role, status);
    const orderBy = buildOrderBy(sortBy, sortOrder);
    const capabilities = await resolveActorCapabilities(
      db,
      actor.id,
      actor.role
    );

    const [totalResult, rows] = await Promise.all([
      db.select({ value: count() }).from(users).where(where),
      db
        .select()
        .from(users)
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(totalResult[0]?.value ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

    return c.json({
      success: true,
      data: rows.map(serializeUser),
      meta: {
        currentUserId: actor.id,
        currentUserRole: actor.role,
        canBan: capabilities.canBan,
        canManage: capabilities.canManage,
        total,
        page,
        pageSize,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Error listing users:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load users.');
  }
}

const usersRouter = new Hono<AppEnv>();

// All routes require admin authentication
usersRouter.use('*', requireAdminMiddleware);

// ─── GET /all — paginated list (primary; matches /api/admins/all style) ───────
usersRouter.get('/all', listUsersHandler);

// Alias for clients that call the mount root
usersRouter.get('/', listUsersHandler);

// ─── GET /stats — aggregate counts by role / status ───────────────────────────
usersRouter.get('/stats', async (c) => {
  const db = getDb(c);

  try {
    const [totalResult, roleResults, bannedResult, deletedResult] =
      await Promise.all([
        db
          .select({ value: count() })
          .from(users)
          .where(eq(users.isDeleted, false)),
        db
          .select({ role: users.role, value: count() })
          .from(users)
          .where(eq(users.isDeleted, false))
          .groupBy(users.role),
        db
          .select({ value: count() })
          .from(users)
          .where(and(eq(users.isDeleted, false), eq(users.isBanned, true))),
        db
          .select({ value: count() })
          .from(users)
          .where(eq(users.isDeleted, true)),
      ]);

    const total = Number(totalResult[0]?.value ?? 0);
    const banned = Number(bannedResult[0]?.value ?? 0);
    const deleted = Number(deletedResult[0]?.value ?? 0);
    const byRole: Record<string, number> = {
      customer: 0,
      admin: 0,
      owner: 0,
    };
    for (const row of roleResults) {
      byRole[row.role] = Number(row.value);
    }

    return c.json({
      success: true,
      data: {
        total,
        active: Math.max(0, total - banned),
        banned,
        deleted,
        byRole,
      },
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load stats.');
  }
});

// ─── GET /:id — single user ───────────────────────────────────────────────────
usersRouter.get('/:id', async (c) => {
  const actor = getActor(c);
  const db = getDb(c);

  const targetId = c.req.param('id')?.trim() ?? '';
  if (!isValidUserId(targetId)) {
    return errorJson(c, 400, 'INVALID_ID', 'Invalid user id.');
  }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);

    if (!user) {
      return errorJson(c, 404, 'USER_NOT_FOUND', 'User not found.');
    }

    const capabilities = await resolveActorCapabilities(
      db,
      actor.id,
      actor.role
    );

    return c.json({
      success: true,
      data: serializeUser(user),
      meta: {
        canBan: capabilities.canBan,
        canManage: capabilities.canManage,
        isSelf: user.id === actor.id,
      },
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load user.');
  }
});

// ─── PATCH /:id/ban — ban or unban (USER_BAN) ─────────────────────────────────
usersRouter.patch(
  '/:id/ban',
  requirePermission(PERMISSIONS.USER_BAN),
  requirePermission(PERMISSIONS.USER_MANAGE),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);

    const targetId = c.req.param('id')?.trim() ?? '';
    if (!isValidUserId(targetId)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid user id.');
    }

    const parsedBody = await readJsonObject(c);
    if (!parsedBody.ok) return parsedBody.response;

    const banned = parsedBody.body.banned === true;
    const rawReason =
      typeof parsedBody.body.reason === 'string'
        ? parsedBody.body.reason.trim()
        : '';

    if (banned && rawReason.length === 0) {
      return errorJson(
        c,
        400,
        'MISSING_REASON',
        'A ban reason is required.'
      );
    }

    if (rawReason.length > MAX_BAN_REASON_LENGTH) {
      return errorJson(
        c,
        400,
        'REASON_TOO_LONG',
        `Ban reason must be at most ${MAX_BAN_REASON_LENGTH} characters.`
      );
    }

    try {
      const [target] = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);

      if (!target || target.isDeleted) {
        return errorJson(c, 404, 'USER_NOT_FOUND', 'User not found.');
      }

      if (target.id === actor.id) {
        return errorJson(
          c,
          400,
          'CANNOT_BAN_SELF',
          'You cannot ban yourself.'
        );
      }

      if (isOwner(target.role)) {
        return errorJson(c, 403, 'CANNOT_BAN_OWNER', 'Cannot ban an owner.');
      }

      // Non-owners may only ban customers (not other admins).
      if (!isOwner(actor.role) && target.role === 'admin') {
        return errorJson(
          c,
          403,
          'CANNOT_BAN_ADMIN',
          'Only owners can ban admin accounts.'
        );
      }

      if (target.isBanned === banned) {
        return errorJson(
          c,
          400,
          'STATE_UNCHANGED',
          `User is already ${banned ? 'banned' : 'active'}.`
        );
      }

      const now = new Date();
      const updated = await db
        .update(users)
        .set(
          banned
            ? {
                isBanned: true,
                bannedAt: now,
                bannedBy: actor.id,
                bannedReason: rawReason,
                updatedAt: now,
              }
            : {
                isBanned: false,
                bannedAt: null,
                bannedBy: null,
                bannedReason: null,
                updatedAt: now,
              }
        )
        .where(
          and(
            eq(users.id, targetId),
            eq(users.isDeleted, false),
            eq(users.isBanned, target.isBanned)
          )
        )
        .returning();

      if (updated.length === 0) {
        return errorJson(
          c,
          409,
          'CONFLICT',
          'Could not update ban status. The user may have changed — refresh and try again.'
        );
      }

      return c.json({
        success: true,
        message: banned
          ? `${updated[0].name} has been banned.`
          : `${updated[0].name} has been unbanned.`,
        data: serializeUser(updated[0]),
      });
    } catch (error) {
      console.error('Error banning/unbanning user:', error);
      return errorJson(
        c,
        500,
        'INTERNAL_ERROR',
        'Failed to update ban status.'
      );
    }
  }
);

// ─── DELETE /:id — soft-delete (USER_MANAGE) ──────────────────────────────────
// Role promotion lives on /api/admins — not here.
usersRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.USER_DELETE),
  requirePermission(PERMISSIONS.USER_MANAGE),
  async (c) => {
    const db = getDb(c);
    const actor = getActor(c);

    const targetId = c.req.param('id')?.trim() ?? '';
    if (!isValidUserId(targetId)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid user id.');
    }

    if (targetId === actor.id) {
      return errorJson(
        c,
        400,
        'CANNOT_DELETE_SELF',
        'You cannot delete yourself.'
      );
    }

    try {
      const [target] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, targetId), eq(users.isDeleted, false)))
        .limit(1);

      if (!target) {
        return errorJson(c, 404, 'USER_NOT_FOUND', 'User not found.');
      }

      if (isOwner(target.role)) {
        return errorJson(
          c,
          403,
          'CANNOT_DELETE_OWNER',
          'Cannot delete an owner.'
        );
      }

      // Non-owners may only delete customers.
      if (!isOwner(actor.role) && target.role === 'admin') {
        return errorJson(
          c,
          403,
          'CANNOT_DELETE_ADMIN',
          'Only owners can delete admin accounts.'
        );
      }

      const now = new Date();
      const updated = await db
        .update(users)
        .set({
          isDeleted: true,
          deletedAt: now,
          isBanned: true,
          bannedAt: now,
          bannedBy: actor.id,
          bannedReason: 'Account deleted by admin',
          role: 'customer',
          updatedAt: now,
        })
        .where(
          and(
            eq(users.id, targetId),
            eq(users.isDeleted, false),
            eq(users.role, target.role)
          )
        )
        .returning();

      if (updated.length === 0) {
        return errorJson(
          c,
          409,
          'CONFLICT',
          'Could not delete user. They may have changed — refresh and try again.'
        );
      }

      // Drop permission overrides for soft-deleted accounts.
      await db
        .delete(userPermissions)
        .where(eq(userPermissions.userId, targetId));

      return c.json({
        success: true,
        message: `${target.name} has been deleted.`,
        data: serializeUser(updated[0]),
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to delete user.');
    }
  }
);

// JSON 404 for unknown paths under /api/users/*
usersRouter.notFound((c) =>
  errorJson(c, 404, 'NOT_FOUND', 'User API route not found.')
);

export default usersRouter;
