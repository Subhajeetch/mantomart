import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { createAuth } from '@repo/auth/server';
import { type Permission } from '@repo/auth/permissions';
import { createDb, users, type Database } from '@repo/db';
import {
  errorJson,
  type AdminActor,
  type AppEnv,
  type AppContext,
} from '@/utils/errorJson';
import { adminHasPermission } from '@/utils/permissions';
import { touchLastActive } from '@/utils/userActivity';

export type { AdminActor, Permission };

function isOwner(role: string | null | undefined): boolean {
  return role === 'owner';
}

function isAdminOrOwner(role: string | null | undefined): role is 'admin' | 'owner' {
  return role === 'admin' || role === 'owner';
}

function createAuthContext(c: AppContext) {
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

/**
 * Authenticate via better-auth session, then re-load role from DB so
 * permission checks cannot be bypassed with a stale session role.
 */
export async function authenticateAdmin(c: AppContext): Promise<
  | { ok: true; actor: AdminActor; db: Database }
  | { ok: false; response: Response }
> {
  const { db, auth } = createAuthContext(c);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session?.user?.id) {
    return {
      ok: false,
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
      ok: false,
      response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.'),
    };
  }

  if (dbUser.isBanned) {
    return {
      ok: false,
      response: errorJson(c, 403, 'USER_BANNED', 'Your account is banned.'),
    };
  }

  if (!isAdminOrOwner(dbUser.role)) {
    return {
      ok: false,
      response: errorJson(
        c,
        403,
        'FORBIDDEN',
        'Admin access is required for this resource.'
      ),
    };
  }

  const actor: AdminActor = {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
  };

  await touchLastActive(db, c.env.KV, dbUser.id);

  return { ok: true, actor, db };
}

function attachAuth(
  c: AppContext,
  auth: { actor: AdminActor; db: Database }
) {
  c.set('actor', auth.actor);
  c.set('db', auth.db);
}

/**
 * Middleware: requires admin or owner authentication.
 * Sets `actor` and `db` on the request context.
 */
export const requireAdminMiddleware: MiddlewareHandler<AppEnv> = async (
  c,
  next
) => {
  const auth = await authenticateAdmin(c);
  if (!auth.ok) return auth.response;

  attachAuth(c, auth);
  await next();
};

/**
 * Middleware: requires owner role.
 * Reuses actor/db from a prior middleware when available.
 */
export const requireOwnerMiddleware: MiddlewareHandler<AppEnv> = async (
  c,
  next
) => {
  let actor = c.get('actor');
  let db = c.get('db');

  if (!actor || !db) {
    const auth = await authenticateAdmin(c);
    if (!auth.ok) return auth.response;
    actor = auth.actor;
    db = auth.db;
    attachAuth(c, auth);
  }

  if (!isOwner(actor.role)) {
    return errorJson(
      c,
      403,
      'OWNER_REQUIRED',
      'Only owners can perform this action.'
    );
  }

  await next();
};

/**
 * Middleware factory: requires a specific permission.
 * Owners always pass. Admins are resolved via role defaults + overrides.
 * Reuses `actor`/`db` from a prior middleware when already set.
 */
export function requirePermission(
  permission: Permission
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // Prefer context already populated by requireAdminMiddleware to avoid
    // a second session round-trip on the same request.
    let actor = c.get('actor');
    let db = c.get('db');

    if (!actor || !db) {
      const auth = await authenticateAdmin(c);
      if (!auth.ok) return auth.response;
      actor = auth.actor;
      db = auth.db;
      attachAuth(c, auth);
    }

    if (!isOwner(actor.role)) {
      const hasPerm = await adminHasPermission(db, actor.id, permission);
      if (!hasPerm) {
        return errorJson(
          c,
          403,
          'INSUFFICIENT_PERMISSION',
          `Requires permission: ${permission}`
        );
      }
    }

    await next();
  };
}

/** Middleware factory: requires at least one of the supplied permissions. */
export function requireAnyPermission(
  ...permissions: Permission[]
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let actor = c.get('actor');
    let db = c.get('db');

    if (!actor || !db) {
      const auth = await authenticateAdmin(c);
      if (!auth.ok) return auth.response;
      actor = auth.actor;
      db = auth.db;
      attachAuth(c, auth);
    }

    if (!isOwner(actor.role)) {
      const hasAnyPermission = await Promise.all(
        permissions.map((permission) => adminHasPermission(db, actor.id, permission))
      );

      if (!hasAnyPermission.some(Boolean)) {
        return errorJson(
          c,
          403,
          'INSUFFICIENT_PERMISSION',
          `Requires one of permissions: ${permissions.join(', ')}`
        );
      }
    }

    await next();
  };
}

/** Read the authenticated actor set by middleware. */
export function getActor(c: AppContext): AdminActor {
  const actor = c.get('actor');
  if (!actor) {
    throw new Error('Actor not set — auth middleware was not applied.');
  }
  return actor;
}

/** Read the database instance set by middleware. */
export function getDb(c: AppContext): Database {
  const db = c.get('db');
  if (!db) {
    throw new Error('Database not set — auth middleware was not applied.');
  }
  return db;
}
