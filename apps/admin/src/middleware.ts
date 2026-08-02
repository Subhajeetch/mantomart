/**
 * Admin panel access gate (Edge Middleware).
 *
 * Must stay as `middleware.ts` (not Next.js 16 `proxy.ts`): Proxy defaults to
 * the Node.js runtime, which OpenNext/Cloudflare does not support. Edge
 * Middleware is required for Cloudflare Workers deployment.
 *
 * Runs BEFORE any page or layout renders. Unauthenticated or non-staff users
 * never see admin UI — they are redirected to the store origin.
 *
 * Flow
 * ----
 * 1. Skip static assets / public files (matcher).
 * 2. Fast path: valid signed `mm_admin_gate` cookie bound to the session token
 *    → allow immediately (no API / no D1). Requires ADMIN_GATE_SECRET.
 * 3. Slow path: GET {API}/api/admin/security/access with the browser cookies.
 *    API uses KV so repeated checks within 5 min avoid D1 user lookups.
 * 4. On allow → set/refresh gate cookie, continue.
 * 5. On deny / error → redirect to NEXT_PUBLIC_STORE_URL (fail closed).
 *
 * /login is still matched so old bookmarks cannot bypass the gate; the page
 * itself only redirects to the store login.
 *
 * Implementation stays Edge-safe: Web Crypto (HMAC/SHA-256), fetch, cookies.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_GATE_COOKIE,
  ADMIN_GATE_TTL_SECONDS,
  canVerifyAdminGateLocally,
  extractSessionTokenFromCookies,
  mintAdminGateCookie,
  resolveApiOrigin,
  resolveStoreRedirectUrl,
  verifyAdminGateCookie,
} from "@/lib/admin-gate";

/** Hard ceiling so a hung API never stalls the edge forever. */
const SECURITY_FETCH_TIMEOUT_MS = 8_000;

type SecurityAccessResponse = {
  success?: boolean;
  allowed?: boolean;
  code?: string;
  user?: {
    id: string;
    role: "admin" | "owner";
    name?: string;
    email?: string;
  };
  meta?: {
    cache?: "hit" | "miss";
    ttlSeconds?: number;
  };
};

function storeRedirect(request: NextRequest): NextResponse {
  const storeUrl = resolveStoreRedirectUrl();
  // Absolute URL required for cross-origin redirect (admin → store).
  const target = new URL(storeUrl);
  const response = NextResponse.redirect(target);

  // Drop any stale gate so a later staff login starts clean.
  response.cookies.set(ADMIN_GATE_COOKIE, "", {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}

function isMutatingOrAssetPath(pathname: string): boolean {
  // Defense in depth — matcher should already exclude these.
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/favicon.svg") return true;
  if (pathname.startsWith("/icons/") || pathname.startsWith("/images/")) return true;
  if (pathname.startsWith("/logos/")) return true;
  return false;
}

/**
 * Build cookie options for the gate cookie on the admin origin.
 * Host-only (no Domain) — only this app should send it back.
 */
function gateCookieOptions(request: NextRequest, maxAge: number) {
  return {
    httpOnly: true as const,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isMutatingOrAssetPath(pathname)) {
    return NextResponse.next();
  }

  // Never gate the security health via rewrite loops — /api is rewritten to
  // the real API worker; those requests are not admin pages. Skip them so we
  // do not recursively authorize API traffic through this middleware.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const sessionToken = extractSessionTokenFromCookies((name) =>
    request.cookies.get(name)
  );

  // ── Fast path: signed gate cookie ────────────────────────────────────────
  if (canVerifyAdminGateLocally() && sessionToken) {
    const gateRaw = request.cookies.get(ADMIN_GATE_COOKIE)?.value;
    const gate = await verifyAdminGateCookie(gateRaw, sessionToken);
    if (gate) {
      // Still within TTL and bound to this session — no network.
      return NextResponse.next();
    }
  }

  // No session cookie at all → cheap deny (do not call API).
  if (!sessionToken) {
    return storeRedirect(request);
  }

  // ── Slow path: security API (KV-backed on the worker) ─────────────────────
  const apiOrigin = resolveApiOrigin();
  const accessUrl = `${apiOrigin}/api/admin/security/access`;

  let allowed = false;
  let userId: string | null = null;
  let role: "admin" | "owner" | null = null;
  let ttlSeconds = ADMIN_GATE_TTL_SECONDS;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      SECURITY_FETCH_TIMEOUT_MS
    );

    try {
      const cookieHeader = request.headers.get("cookie") ?? "";

      const res = await fetch(accessUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          // Forward the browser session so better-auth can resolve it.
          Cookie: cookieHeader,
          // Identify the caller for logs / future rate limits.
          "X-Admin-Gate": "middleware",
          "X-Forwarded-Host": request.headers.get("host") ?? "",
        },
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
      });

      // Network / 5xx → fail closed.
      if (!res.ok && res.status !== 401 && res.status !== 403) {
        console.error(
          `[admin-middleware] security API HTTP ${res.status} for ${pathname}`
        );
        return storeRedirect(request);
      }

      let data: SecurityAccessResponse;
      try {
        data = (await res.json()) as SecurityAccessResponse;
      } catch {
        console.error("[admin-middleware] security API returned non-JSON");
        return storeRedirect(request);
      }

      allowed = data.allowed === true && data.success !== false;
      if (
        allowed &&
        data.user?.id &&
        (data.user.role === "admin" || data.user.role === "owner")
      ) {
        userId = data.user.id;
        role = data.user.role;
        if (
          typeof data.meta?.ttlSeconds === "number" &&
          data.meta.ttlSeconds > 0
        ) {
          ttlSeconds = Math.min(data.meta.ttlSeconds, ADMIN_GATE_TTL_SECONDS);
        }
      } else {
        allowed = false;
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    // AbortError, DNS, connection refused, etc. — never render admin UI.
    const message =
      error instanceof Error ? error.message : "unknown middleware error";
    console.error(`[admin-middleware] security check failed: ${message}`);
    return storeRedirect(request);
  }

  if (!allowed || !userId || !role) {
    return storeRedirect(request);
  }

  // ── Allow: optionally stamp gate cookie for the next N minutes ───────────
  const response = NextResponse.next();

  const gateValue = await mintAdminGateCookie({
    userId,
    role,
    sessionToken,
    ttlSeconds,
  });

  if (gateValue) {
    response.cookies.set(
      ADMIN_GATE_COOKIE,
      gateValue,
      gateCookieOptions(request, ttlSeconds)
    );
  } else {
    // No signing secret — clear any leftover cookie so we never half-trust it.
    response.cookies.set(
      ADMIN_GATE_COOKIE,
      "",
      gateCookieOptions(request, 0)
    );
  }

  // Help caches / CDNs understand this is private per-user HTML.
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Admin-Gate", "allowed");

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on all paths except:
     * - Next internals (_next/static, _next/image, _next/data is still gated —
     *   RSC payloads must not leak to non-admins)
     * - Common static file extensions served from /public
     */
    "/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|css|js|map)$).*)",
  ],
};
