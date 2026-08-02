/**
 * Edge gate cookie for the admin panel.
 *
 * After the security API allows a request, Edge Middleware stamps a short-lived
 * httpOnly cookie on the admin origin. Subsequent navigations within the TTL
 * skip the network round-trip to the API (and therefore skip D1 entirely).
 *
 * Security model
 * --------------
 * The cookie is HMAC-SHA256 signed with ADMIN_GATE_SECRET (or BETTER_AUTH_SECRET
 * as a fallback). Forging it without the secret is not feasible.
 *
 * The cookie is bound to the better-auth session token fingerprint so a stolen
 * gate cookie alone (without the session cookie) is rejected, and a gate from
 * session A cannot be replayed with session B.
 *
 * If no signing secret is configured, middleware falls back to calling the
 * security API on every protected request (still cheap via KV on the API).
 */

export const ADMIN_GATE_COOKIE = "mm_admin_gate";

/**
 * Edge gate lifetime. Keep short so demotion/ban converge quickly even when
 * middleware skips the API. API KV TTL is independently 5 minutes.
 */
export const ADMIN_GATE_TTL_SECONDS = 2 * 60;

const GATE_VERSION = "v1";

export type AdminGatePayload = {
  /** user id */
  uid: string;
  /** admin | owner */
  role: "admin" | "owner";
  /** epoch seconds */
  exp: number;
  /** first 16 hex chars of sha256(sessionToken) */
  sth: string;
};

function getGateSecret(): string | null {
  const raw =
    process.env.ADMIN_GATE_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim() ||
    "";
  return raw.length >= 16 ? raw : null;
}

/** Whether local verification is available (secret configured). */
export function canVerifyAdminGateLocally(): boolean {
  return getGateSecret() !== null;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Stable short fingerprint of the session token (not reversible). */
export async function sessionTokenFingerprint(token: string): Promise<string> {
  const full = await sha256Hex(token);
  return full.slice(0, 16);
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/**
 * Build a signed gate cookie value for an allowed admin session.
 * Returns null when no signing secret is configured.
 */
export async function mintAdminGateCookie(input: {
  userId: string;
  role: "admin" | "owner";
  sessionToken: string;
  /** override TTL (seconds); default ADMIN_GATE_TTL_SECONDS */
  ttlSeconds?: number;
}): Promise<string | null> {
  const secret = getGateSecret();
  if (!secret) return null;

  if (!input.userId || (input.role !== "admin" && input.role !== "owner")) {
    return null;
  }

  const ttl = Math.max(
    30,
    Math.min(input.ttlSeconds ?? ADMIN_GATE_TTL_SECONDS, ADMIN_GATE_TTL_SECONDS)
  );
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sth = await sessionTokenFingerprint(input.sessionToken);

  const body = `${GATE_VERSION}.${input.userId}.${input.role}.${exp}.${sth}`;
  const sig = await hmacSign(secret, body);
  return `${body}.${sig}`;
}

/**
 * Verify a gate cookie.
 * Requires the raw session token from the request to match the bound fingerprint.
 */
export async function verifyAdminGateCookie(
  cookieValue: string | undefined | null,
  sessionToken: string | null
): Promise<AdminGatePayload | null> {
  if (!cookieValue || !sessionToken) return null;

  const secret = getGateSecret();
  if (!secret) return null;

  const parts = cookieValue.split(".");
  // v1 | uid | role | exp | sth | sig
  if (parts.length !== 6) return null;

  const [version, uid, role, expStr, sth, sig] = parts;
  if (version !== GATE_VERSION) return null;
  if (!uid || uid.length > 128) return null;
  if (role !== "admin" && role !== "owner") return null;
  if (!expStr || !/^\d+$/.test(expStr)) return null;
  if (!sth || !/^[a-f0-9]{16}$/.test(sth)) return null;
  if (!sig || !/^[a-f0-9]{64}$/.test(sig)) return null;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;

  const body = `${version}.${uid}.${role}.${expStr}.${sth}`;
  const expected = await hmacSign(secret, body);
  if (!timingSafeEqual(expected, sig)) return null;

  const actualSth = await sessionTokenFingerprint(sessionToken);
  if (!timingSafeEqual(actualSth, sth)) return null;

  return { uid, role, exp, sth };
}

/** better-auth session cookie names (prod secure + local). */
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
  "better-auth-session_token",
  "__Secure-better-auth-session_token",
] as const;

/** Read raw session token from a Cookie header / NextRequest cookies map. */
export function extractSessionTokenFromCookieHeader(
  cookieHeader: string | null
): string | null {
  if (!cookieHeader) return null;

  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    if (
      !SESSION_COOKIE_NAMES.includes(
        name as (typeof SESSION_COOKIE_NAMES)[number]
      )
    ) {
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

export function extractSessionTokenFromCookies(
  get: (name: string) => { value: string } | undefined
): string | null {
  for (const name of SESSION_COOKIE_NAMES) {
    const hit = get(name);
    if (hit?.value) {
      try {
        return decodeURIComponent(hit.value);
      } catch {
        return hit.value;
      }
    }
  }
  return null;
}

/** Resolve the public store origin used for deny redirects. */
export function resolveStoreRedirectUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_STORE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (process.env.NODE_ENV === "production") {
    return "https://mantomart.com";
  }
  return "http://localhost:8000";
}

/** Resolve the API origin for the security check. */
export function resolveApiOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (process.env.NODE_ENV === "production") {
    return "https://api.mantomart.com";
  }
  return "http://localhost:8002";
}
