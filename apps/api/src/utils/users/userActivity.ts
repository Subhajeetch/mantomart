import { eq } from "drizzle-orm";
import { users, type Database } from "@repo/db";

/**
 * How often we allow a D1 write for lastActiveAt per user.
 * KV is the gate: most requests only cost a single cheap KV GET.
 */
export const ACTIVITY_THROTTLE_SECONDS = 10 * 60; // 10 minutes

const ACTIVITY_KEY_PREFIX = "ua:active:";
const MAX_USER_ID_LENGTH = 128;
const MAX_IP_LENGTH = 45; // IPv6 textual max

function activityKey(userId: string) {
  return `${ACTIVITY_KEY_PREFIX}${userId}`;
}

/** Normalize client IPs from common proxy / CF headers. */
export function extractClientIp(headers: Headers): string | null {
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("true-client-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const ip = raw.trim();
    if (!ip || ip.length > MAX_IP_LENGTH) continue;
    // Basic sanity: reject obvious garbage / header injection
    if (/[\s\r\n]/.test(ip)) continue;
    return ip;
  }

  return null;
}

function isValidUserId(userId: string): boolean {
  return (
    typeof userId === "string" &&
    userId.length > 0 &&
    userId.length <= MAX_USER_ID_LENGTH
  );
}

/**
 * Record a real login (new session).
 * One D1 write per login — sets last login, IP, and last active together.
 */
export async function recordUserLogin(
  db: Database,
  userId: string,
  ip: string | null,
  kv?: KVNamespace,
  options?: {
    /** Cloudflare waitUntil — lets the response return before activity writes finish */
    waitUntil?: (promise: Promise<unknown>) => void;
  },
): Promise<void> {
  if (!isValidUserId(userId)) return;

  const now = new Date();
  const safeIp =
    ip && ip.length > 0 && ip.length <= MAX_IP_LENGTH && !/[\s\r\n]/.test(ip)
      ? ip
      : null;

  const write = async () => {
    await db
      .update(users)
      .set({
        lastLoginAt: now,
        lastActiveAt: now,
        ...(safeIp ? { lastLoginIp: safeIp } : {}),
      })
      .where(eq(users.id, userId));

    // Seed throttle so the next get-session does not immediately re-write lastActiveAt
    if (kv) {
      try {
        await kv.put(activityKey(userId), String(now.getTime()), {
          expirationTtl: ACTIVITY_THROTTLE_SECONDS,
        });
      } catch {
        // Non-fatal — activity throttle is best-effort
      }
    }
  };

  const task = write().catch((error) => {
    // Never fail auth because activity tracking failed
    console.error("recordUserLogin failed:", error);
  });

  if (options?.waitUntil) {
    options.waitUntil(task);
    return;
  }

  await task;
}

/**
 * Throttled last-active touch.
 *
 * Cost profile (per authenticated request):
 * - Hot path (within throttle window): 1 KV GET, 0 D1 writes
 * - Cold path (window expired): 1 KV GET + 1 KV PUT + 1 D1 UPDATE
 *
 * Safe to call on every request — never throws.
 */
export async function touchLastActive(
  db: Database,
  kv: KVNamespace,
  userId: string,
  options?: {
    /** Cloudflare waitUntil — lets the response return before D1 write finishes */
    waitUntil?: (promise: Promise<unknown>) => void;
  },
): Promise<void> {
  if (!isValidUserId(userId)) return;

  try {
    const key = activityKey(userId);
    const existing = await kv.get(key);
    if (existing !== null) {
      // Still within throttle window — skip D1 entirely
      return;
    }

    const now = new Date();

    // Claim the window first to collapse concurrent stampedes into ~1 write
    await kv.put(key, String(now.getTime()), {
      expirationTtl: ACTIVITY_THROTTLE_SECONDS,
    });

    const write = db
      .update(users)
      .set({ lastActiveAt: now })
      .where(eq(users.id, userId))
      .then(() => undefined)
      .catch((error) => {
        console.error("touchLastActive D1 write failed:", error);
      });

    if (options?.waitUntil) {
      options.waitUntil(write);
    } else {
      await write;
    }
  } catch (error) {
    console.error("touchLastActive failed:", error);
  }
}
