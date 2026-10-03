/**
 * Admin panel access cache (Cloudflare KV).
 *
 * Goal: after the first successful (or denied) access check for a session,
 * subsequent checks avoid D1 user lookups for the TTL window.
 *
 * Key layout
 * ----------
 *   admin:access:v1:sess:{sha256(sessionToken)}  → CachedAccessDecision
 *   admin:access:v1:rev:{userId}                 → revocation timestamp (ms)
 *
 * Hot path (cache hit, not revoked): 1–2 KV reads, 0 D1 queries.
 * Cold path: better-auth session + 1 D1 user row + 1 KV write.
 *
 * Revocation
 * ----------
 * Bump `rev:{userId}` whenever role / ban / delete changes so any cached
 * allow (or deny) for that user is treated as a miss until re-checked.
 * Session tokens themselves are never stored in plaintext — only a SHA-256.
 */

import kvManager from '@/utils/kvManager';

/** Positive + negative cache lifetime. Short enough for role changes to converge. */
export const ADMIN_ACCESS_CACHE_TTL_SECONDS = 5 * 60; // 5 minutes

/** Revocation markers outlive cache entries so a mid-TTL demotion always wins. */
export const ADMIN_ACCESS_REVOCATION_TTL_SECONDS = 15 * 60; // 15 minutes

const CACHE_VERSION = 1;
const SESS_PREFIX = `admin:access:v${CACHE_VERSION}:sess:`;
const REV_PREFIX = `admin:access:v${CACHE_VERSION}:rev:`;

export type AdminAccessRole = 'admin' | 'owner';

export type CachedAccessDecision = {
  v: typeof CACHE_VERSION;
  allowed: boolean;
  /** Machine-readable reason when allowed === false */
  code?:
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'USER_BANNED'
    | 'USER_DELETED'
    | 'SESSION_EXPIRED';
  userId: string;
  role?: AdminAccessRole;
  name?: string;
  email?: string;
  sessionId: string;
  /** Epoch ms — session row expiry from better-auth */
  sessionExpiresAt: number;
  /** Epoch ms — when this cache entry was written */
  cachedAt: number;
};

function sessKey(tokenHash: string): string {
  return `${SESS_PREFIX}${tokenHash}`;
}

function revKey(userId: string): string {
  return `${REV_PREFIX}${userId}`;
}

/** SHA-256 hex of the raw session token (never store the token itself). */
export async function hashSessionToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Read a cached access decision for this session token.
 * Returns null on miss, expiry, revocation, or corrupt payload.
 */
export async function getCachedAdminAccess(
  kv: KVNamespace,
  tokenHash: string
): Promise<CachedAccessDecision | null> {
  const manager = kvManager(kv);

  let cached: CachedAccessDecision | null;
  try {
    cached = await manager.getJson<CachedAccessDecision>(sessKey(tokenHash));
  } catch (error) {
    console.error('adminAccessCache: KV read failed:', error);
    return null;
  }

  if (!cached || cached.v !== CACHE_VERSION) return null;
  if (typeof cached.userId !== 'string' || !cached.userId) return null;
  if (typeof cached.cachedAt !== 'number') return null;
  if (typeof cached.sessionExpiresAt !== 'number') return null;

  // Session already past its better-auth expiry — force re-check / deny.
  if (cached.sessionExpiresAt <= Date.now()) return null;

  // Role/ban/delete changed after this entry was written.
  try {
    const revokedAtRaw = await manager.get(revKey(cached.userId));
    if (revokedAtRaw !== null) {
      const revokedAt = Number(revokedAtRaw);
      if (Number.isFinite(revokedAt) && revokedAt > cached.cachedAt) {
        return null;
      }
    }
  } catch (error) {
    console.error('adminAccessCache: revocation read failed:', error);
    // Fail open to cache only if rev check breaks? No — fail closed to DB path.
    return null;
  }

  return cached;
}

/** Persist an access decision for this session (best-effort). */
export async function setCachedAdminAccess(
  kv: KVNamespace,
  tokenHash: string,
  decision: CachedAccessDecision
): Promise<void> {
  try {
    await kvManager(kv).setJson(sessKey(tokenHash), decision, {
      expirationTtl: ADMIN_ACCESS_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.error('adminAccessCache: KV write failed:', error);
  }
}

/**
 * Invalidate all cached access decisions for a user.
 * Call on role change, ban, unban, soft-delete, or admin removal.
 */
export async function invalidateAdminAccessForUser(
  kv: KVNamespace,
  userId: string
): Promise<void> {
  if (!userId || userId.length > 128) return;

  try {
    await kvManager(kv).set(revKey(userId), String(Date.now()), {
      expirationTtl: ADMIN_ACCESS_REVOCATION_TTL_SECONDS,
    });
  } catch (error) {
    console.error('adminAccessCache: revocation write failed:', error);
  }
}

/**
 * Drop a single session's cache entry (e.g. after explicit logout signal).
 * Best-effort — safe to ignore failures.
 */
export async function invalidateAdminAccessForSession(
  kv: KVNamespace,
  tokenHash: string
): Promise<void> {
  try {
    await kvManager(kv).delete(sessKey(tokenHash));
  } catch (error) {
    console.error('adminAccessCache: session cache delete failed:', error);
  }
}
