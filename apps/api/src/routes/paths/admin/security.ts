/**
 * Admin panel security gate.
 *
 * GET /api/admin/security/access
 *   Called by the admin Next.js middleware on every protected navigation
 *   (or when the short-lived edge gate cookie has expired).
 *
 *   1. Resolve better-auth session from Cookie header
 *   2. KV cache hit → return immediately (no D1 user lookup)
 *   3. KV miss → load user from D1, verify admin|owner, not banned/deleted
 *   4. Write decision to KV (TTL 5 min) and return
 *
 * POST /api/admin/security/invalidate
 *   Internal/staff helper to force-revoke a user's cached access.
 *   Requires the caller to already be an authenticated owner/admin.
 *
 * Efficiency profile
 * ------------------
 * Hot (same session, within TTL, not revoked):
 *   1× better-auth session resolve + 1–2× KV get  →  0 D1 user queries
 *   (Session resolve is required so a logged-out token cannot reuse cache.)
 *
 *   Wait — we intentionally skip getSession on pure KV hits when the
 *   cached payload still has a future sessionExpiresAt. The trade-off is a
 *   max 5-minute window after logout/demotion unless invalidate is called.
 *   Demotion/ban paths call invalidateAdminAccessForUser so they take effect
 *   on the next request. Logout relies on the short TTL + missing cookie
 *   (middleware will 401 without a session cookie).
 *
 * Cold: getSession + 1 D1 SELECT + 1 KV PUT
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createAuth } from '@repo/auth/server';
import { createDb, users } from '@repo/db';
import type Env from '@/types/env';
import { errorJson, type EnvContext } from '@/utils/errorJson';
import {
  ADMIN_ACCESS_CACHE_TTL_SECONDS,
  getCachedAdminAccess,
  hashSessionToken,
  invalidateAdminAccessForUser,
  setCachedAdminAccess,
  type AdminAccessRole,
  type CachedAccessDecision,
} from '@/utils/adminAccessCache';
import { touchLastActive } from '@/utils/userActivity';

const security = new Hono<{ Bindings: Env }>();

/** better-auth default cookie names (with/without __Secure- prefix). */
const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
  // Legacy / alternate separators some better-auth versions used
  'better-auth-session_token',
  '__Secure-better-auth-session_token',
] as const;

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

function isAdminRole(role: string | null | undefined): role is AdminAccessRole {
  return role === 'admin' || role === 'owner';
}

/**
 * Pull the raw session token out of the Cookie header.
 * better-auth may URL-encode the value; we keep it as the browser sent it
 * for hashing, and also try decodeURIComponent for the hash input stability.
 */
function extractSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  // Split on "; " carefully — values should not contain raw semicolons.
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    if (!SESSION_COOKIE_NAMES.includes(name as (typeof SESSION_COOKIE_NAMES)[number])) {
      continue;
    }
    const raw = trimmed.slice(eqIdx + 1).trim();
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function jsonAccess(
  c: EnvContext,
  status: 200 | 401 | 403,
  body: {
    allowed: boolean;
    code?: string;
    message?: string;
    user?: {
      id: string;
      role: AdminAccessRole;
      name: string;
      email: string;
    };
    meta?: {
      cache: 'hit' | 'miss';
      ttlSeconds: number;
      checkedAt: string;
    };
  }
) {
  // Never cache at the HTTP layer — decisions are per-session.
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  c.header('Pragma', 'no-cache');
  c.header('Vary', 'Cookie');

  return c.json(
    {
      success: body.allowed,
      allowed: body.allowed,
      ...(body.code ? { code: body.code } : {}),
      ...(body.message ? { message: body.message, error: body.message } : {}),
      ...(body.user ? { user: body.user } : {}),
      ...(body.meta ? { meta: body.meta } : {}),
    },
    status
  );
}

function decisionToResponse(
  c: EnvContext,
  decision: CachedAccessDecision,
  cache: 'hit' | 'miss'
) {
  const checkedAt = new Date(decision.cachedAt).toISOString();

  if (!decision.allowed) {
    const status = decision.code === 'UNAUTHORIZED' || decision.code === 'SESSION_EXPIRED'
      ? 401
      : 403;
    return jsonAccess(c, status, {
      allowed: false,
      code: decision.code ?? 'FORBIDDEN',
      message:
        decision.code === 'USER_BANNED'
          ? 'Your account is banned.'
          : decision.code === 'UNAUTHORIZED' || decision.code === 'SESSION_EXPIRED'
            ? 'Authentication required.'
            : 'Admin access is required.',
      meta: {
        cache,
        ttlSeconds: ADMIN_ACCESS_CACHE_TTL_SECONDS,
        checkedAt,
      },
    });
  }

  if (!decision.role || !decision.name || !decision.email) {
    // Corrupt allow entry — treat as miss upstream; defensive here.
    return jsonAccess(c, 403, {
      allowed: false,
      code: 'FORBIDDEN',
      message: 'Admin access is required.',
      meta: { cache, ttlSeconds: ADMIN_ACCESS_CACHE_TTL_SECONDS, checkedAt },
    });
  }

  return jsonAccess(c, 200, {
    allowed: true,
    user: {
      id: decision.userId,
      role: decision.role,
      name: decision.name,
      email: decision.email,
    },
    meta: {
      cache,
      ttlSeconds: ADMIN_ACCESS_CACHE_TTL_SECONDS,
      checkedAt,
    },
  });
}

/**
 * GET /access — primary gate used by admin middleware.
 *
 * Auth: session cookie (credentials). No extra headers required.
 */
security.get('/access', async (c) => {
  const cookieHeader = c.req.header('cookie') ?? c.req.header('Cookie') ?? null;
  const sessionToken = extractSessionToken(cookieHeader);

  // No session cookie at all → cheap deny, no DB / no KV.
  if (!sessionToken) {
    return jsonAccess(c, 401, {
      allowed: false,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
      meta: {
        cache: 'miss',
        ttlSeconds: ADMIN_ACCESS_CACHE_TTL_SECONDS,
        checkedAt: new Date().toISOString(),
      },
    });
  }

  let tokenHash: string;
  try {
    tokenHash = await hashSessionToken(sessionToken);
  } catch (error) {
    console.error('admin security: token hash failed:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to verify access.');
  }

  // ── Fast path: KV ────────────────────────────────────────────────────────
  const cached = await getCachedAdminAccess(c.env.KV, tokenHash);
  if (cached) {
    return decisionToResponse(c, cached, 'hit');
  }

  // ── Cold path: session + D1 ──────────────────────────────────────────────
  try {
    const { db, auth } = createAuthFromEnv(c);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session?.user?.id || !session.session?.id) {
      // Do not cache bare "no session" against a token that failed lookup —
      // the token may be stale junk; caching would lock out a fresh login
      // that reuses nothing. Just deny.
      return jsonAccess(c, 401, {
        allowed: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
        meta: {
          cache: 'miss',
          ttlSeconds: ADMIN_ACCESS_CACHE_TTL_SECONDS,
          checkedAt: new Date().toISOString(),
        },
      });
    }

    const sessionExpiresAt = (() => {
      const raw = session.session.expiresAt;
      if (raw instanceof Date) return raw.getTime();
      if (typeof raw === 'string' || typeof raw === 'number') {
        const t = new Date(raw).getTime();
        return Number.isFinite(t) ? t : Date.now() + ADMIN_ACCESS_CACHE_TTL_SECONDS * 1000;
      }
      return Date.now() + ADMIN_ACCESS_CACHE_TTL_SECONDS * 1000;
    })();

    // Session already expired according to better-auth payload.
    if (sessionExpiresAt <= Date.now()) {
      return jsonAccess(c, 401, {
        allowed: false,
        code: 'SESSION_EXPIRED',
        message: 'Authentication required.',
        meta: {
          cache: 'miss',
          ttlSeconds: ADMIN_ACCESS_CACHE_TTL_SECONDS,
          checkedAt: new Date().toISOString(),
        },
      });
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

    const now = Date.now();
    const baseDecision = {
      v: 1 as const,
      userId: session.user.id,
      sessionId: session.session.id,
      sessionExpiresAt,
      cachedAt: now,
    };

    if (!dbUser || dbUser.isDeleted) {
      const decision: CachedAccessDecision = {
        ...baseDecision,
        allowed: false,
        code: dbUser?.isDeleted ? 'USER_DELETED' : 'UNAUTHORIZED',
      };
      // Cache negative briefly so a deleted account cannot hammer D1.
      await setCachedAdminAccess(c.env.KV, tokenHash, decision);
      return decisionToResponse(c, decision, 'miss');
    }

    if (dbUser.isBanned) {
      const decision: CachedAccessDecision = {
        ...baseDecision,
        userId: dbUser.id,
        allowed: false,
        code: 'USER_BANNED',
        name: dbUser.name,
        email: dbUser.email,
      };
      await setCachedAdminAccess(c.env.KV, tokenHash, decision);
      return decisionToResponse(c, decision, 'miss');
    }

    if (!isAdminRole(dbUser.role)) {
      const decision: CachedAccessDecision = {
        ...baseDecision,
        userId: dbUser.id,
        allowed: false,
        code: 'FORBIDDEN',
        name: dbUser.name,
        email: dbUser.email,
      };
      await setCachedAdminAccess(c.env.KV, tokenHash, decision);
      return decisionToResponse(c, decision, 'miss');
    }

    const decision: CachedAccessDecision = {
      ...baseDecision,
      userId: dbUser.id,
      allowed: true,
      role: dbUser.role,
      name: dbUser.name,
      email: dbUser.email,
    };

    await setCachedAdminAccess(c.env.KV, tokenHash, decision);

    // Activity touch is best-effort and must not delay the gate response.
    c.executionCtx.waitUntil(
      touchLastActive(db, c.env.KV, dbUser.id, {
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      }).catch(() => undefined)
    );

    return decisionToResponse(c, decision, 'miss');
  } catch (error) {
    console.error('admin security /access failed:', error);
    // Fail closed — never let an error through as allowed.
    return errorJson(
      c,
      503,
      'SECURITY_CHECK_FAILED',
      'Unable to verify admin access. Please try again.'
    );
  }
});

/**
 * POST /invalidate
 * Force-revoke cached access for a user (owners managing admins, etc.).
 * Body: { userId: string }
 *
 * Also used internally via the shared helper; this HTTP surface is for
 * explicit busts (e.g. after out-of-band role changes).
 */
security.post('/invalidate', async (c) => {
  try {
    const { db, auth } = createAuthFromEnv(c);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session?.user?.id) {
      return errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const [actor] = await db
      .select({ id: users.id, role: users.role, isBanned: users.isBanned, isDeleted: users.isDeleted })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (!actor || actor.isDeleted || actor.isBanned || !isAdminRole(actor.role)) {
      return errorJson(c, 403, 'FORBIDDEN', 'Admin access is required.');
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorJson(c, 400, 'INVALID_JSON', 'Request body must be JSON.');
    }

    const userId =
      body &&
      typeof body === 'object' &&
      typeof (body as { userId?: unknown }).userId === 'string'
        ? (body as { userId: string }).userId.trim()
        : '';

    if (!userId || userId.length > 128) {
      return errorJson(c, 400, 'INVALID_USER_ID', 'A valid userId is required.');
    }

    // Non-owners may only invalidate themselves (e.g. sign-out cleanup).
    if (actor.role !== 'owner' && actor.id !== userId) {
      return errorJson(
        c,
        403,
        'OWNER_REQUIRED',
        'Only owners can invalidate another user\'s admin access cache.'
      );
    }

    await invalidateAdminAccessForUser(c.env.KV, userId);

    return c.json({
      success: true,
      message: 'Admin access cache invalidated.',
      data: { userId },
    });
  } catch (error) {
    console.error('admin security /invalidate failed:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to invalidate access cache.');
  }
});

/**
 * GET /health — cheap liveness for the security module (no auth).
 * Useful for middleware startup probes; does not reveal user data.
 */
security.get('/health', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({
    success: true,
    service: 'admin-security',
    cacheTtlSeconds: ADMIN_ACCESS_CACHE_TTL_SECONDS,
  });
});

export default security;
