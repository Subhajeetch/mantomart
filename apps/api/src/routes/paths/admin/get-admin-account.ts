/**
 * GET /api/admin/account
 *
 * Returns the authenticated admin's own account profile for the admin panel
 * Account page. Never accepts a user id — always the session user only.
 *
 * Security
 * --------
 * - Requires a valid better-auth session
 * - Re-loads role from D1 (stale session role cannot elevate)
 * - Rejects banned / deleted / non-admin users
 * - Returns only the caller's row (no other-user lookup)
 * - Strips internal-only fields (adminNotes, ban metadata, tokens)
 * - Auth providers: provider id only — never access/refresh tokens or password
 * - Cache-Control: no-store (per-session PII)
 */

import { Hono } from 'hono';
import { and, count, eq, gt } from 'drizzle-orm';
import { createAuth } from '@repo/auth/server';
import { accounts, createDb, sessions, users } from '@repo/db';
import type Env from '@/types/env';
import { errorJson, type EnvContext } from '@/utils/errorJson';
import { touchLastActive } from '@/utils/userActivity';

type AdminRole = 'admin' | 'owner';

const account = new Hono<{ Bindings: Env }>();

function createAuthFromEnv(c: EnvContext) {
  const db = createDb(c.env.DB);
  const auth = createAuth(db, {
    GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
    NODE_ENV: c.env.NODE_ENV,
    API_URL: c.env.API_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    ORIGINS: c.env.ORIGINS,
    DOMAIN: c.env.DOMAIN,
  });
  return { db, auth };
}

function isAdminRole(role: string | null | undefined): role is AdminRole {
  return role === 'admin' || role === 'owner';
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Authenticate via better-auth, then re-check role in D1 so a demoted
 * session cannot read admin account data.
 */
async function requireAdminSelf(c: EnvContext) {
  const { db, auth } = createAuthFromEnv(c);

  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: c.req.raw.headers });
  } catch (error) {
    console.error('get-admin-account: getSession failed', error);
    return {
      ok: false as const,
      response: errorJson(
        c,
        500,
        'SESSION_ERROR',
        'Unable to verify your session. Please try again.'
      ),
    };
  }

  if (!session?.user?.id) {
    return {
      ok: false as const,
      response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.'),
    };
  }

  const userId = session.user.id;

  let dbUser: typeof users.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    dbUser = rows[0];
  } catch (error) {
    console.error('get-admin-account: user lookup failed', error);
    return {
      ok: false as const,
      response: errorJson(
        c,
        500,
        'LOOKUP_FAILED',
        'Unable to load your account. Please try again.'
      ),
    };
  }

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

  // Best-effort activity touch — never block the response on failure.
  try {
    await touchLastActive(db, c.env.KV, dbUser.id, {
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
  } catch {
    // non-fatal
  }

  return {
    ok: true as const,
    db,
    user: dbUser,
  };
}

function serializeAccount(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    role: user.role as AdminRole,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    phoneVerified: user.phoneVerified,
    locale: user.locale,
    timezone: user.timezone,
    currency: user.currency,
    lastLoginAt: toIso(user.lastLoginAt),
    lastLoginIp: user.lastLoginIp,
    lastActiveAt: toIso(user.lastActiveAt),
    createdAt: toIso(user.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(user.updatedAt) ?? new Date(0).toISOString(),
  };
}

account.get('/', async (c) => {
  // Never cache account PII at any layer.
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  c.header('Pragma', 'no-cache');
  c.header('Vary', 'Cookie');

  // Only GET is defined on this path; reject anything else defensively
  // if mounted under a catch-all in the future.
  if (c.req.method !== 'GET') {
    return errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  }

  const access = await requireAdminSelf(c);
  if (!access.ok) return access.response;

  const { db, user } = access;
  const now = new Date();

  let linkedProviders: Array<{
    providerId: string;
    createdAt: string | null;
  }> = [];
  let activeSessionCount = 0;

  try {
    const [providerRows, sessionCountRow] = await Promise.all([
      db
        .select({
          providerId: accounts.providerId,
          createdAt: accounts.createdAt,
        })
        .from(accounts)
        .where(eq(accounts.userId, user.id)),
      db
        .select({ value: count() })
        .from(sessions)
        .where(
          and(eq(sessions.userId, user.id), gt(sessions.expiresAt, now))
        ),
    ]);

    // De-dupe providers (credential + oauth can both exist).
    const seen = new Set<string>();
    linkedProviders = [];
    for (const row of providerRows) {
      const id = (row.providerId ?? '').trim().toLowerCase();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      linkedProviders.push({
        providerId: id,
        createdAt: toIso(row.createdAt),
      });
    }

    activeSessionCount = Number(sessionCountRow[0]?.value ?? 0);
  } catch (error) {
    // Providers / session count are secondary — still return core profile.
    console.error('get-admin-account: secondary lookups failed', error);
  }

  return c.json(
    {
      success: true,
      data: {
        ...serializeAccount(user),
        linkedProviders,
        activeSessionCount,
      },
      meta: {
        checkedAt: new Date().toISOString(),
        self: true,
      },
    },
    200
  );
});

// Explicit method guards for common mistakes
account.all('*', (c) =>
  errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
);

export default account;
