import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "@repo/db";
import * as schema from "@repo/db/schema";

type SendEmailFn = (opts: {
  to: string;
  url: string;
  token: string;
}) => Promise<void>;

export type AuthActivityHooks = {
  /**
   * Called once when Better Auth creates a session row.
   * Caller owns any DB/KV writes so Cloudflare-specific bindings stay outside
   * this shared auth package.
   */
  onLogin?: (info: {
    userId: string;
    ip: string | null;
  }) => void | Promise<void>;
  /**
   * Called on authenticated get-session polls.
   * Caller MUST throttle (KV) — this can fire very often.
   */
  onSessionTouch?: (userId: string) => void | Promise<void>;
};

type SessionTouchContext = {
  session?: { user?: { id?: unknown } };
  newSession?: { user?: { id?: unknown } };
  returned?: unknown;
};

function extractIpFromContext(
  context: { request?: Request; headers?: Headers } | null | undefined,
  sessionIp?: string | null,
): string | null {
  if (sessionIp && typeof sessionIp === "string" && sessionIp.trim()) {
    const ip = sessionIp.trim();
    if (ip.length <= 45 && !/[\s\r\n]/.test(ip)) return ip;
  }

  const headers =
    context && "headers" in context && context.headers
      ? context.headers
      : context?.request?.headers;

  if (!headers) return null;

  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("true-client-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const ip = raw.trim();
    if (!ip || ip.length > 45 || /[\s\r\n]/.test(ip)) continue;
    return ip;
  }

  return null;
}

function extractTouchedUserId(context: SessionTouchContext): string | null {
  const directId = context.session?.user?.id ?? context.newSession?.user?.id;
  if (typeof directId === "string") return directId;

  if (!context.returned || typeof context.returned !== "object") return null;

  const returned = context.returned as {
    user?: { id?: unknown };
    session?: { userId?: unknown; user?: { id?: unknown } };
  };

  const returnedId =
    returned.user?.id ?? returned.session?.userId ?? returned.session?.user?.id;

  return typeof returnedId === "string" ? returnedId : null;
}

export type AuthEnv = {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /**
   * Required in production. Used to sign OAuth state + session cookies.
   * On Cloudflare Workers this MUST be passed explicitly — better-auth cannot
   * read wrangler secrets from process.env.
   */
  BETTER_AUTH_SECRET?: string;
  NODE_ENV?: string;
  /**
   * Public origin of this API (no trailing slash), e.g.
   * `https://api.mantomart.com` or `http://localhost:8002`.
   * Also accepts BETTER_AUTH_URL as an alias.
   */
  API_URL?: string;
  BETTER_AUTH_URL?: string;
  APP_URL?: string;
  ORIGINS?: string;
  DOMAIN?: string;
};

/**
 * Resolve the auth base URL used for OAuth redirect_uri + error pages.
 *
 * Important: never gate this only on NODE_ENV. If production is missing
 * NODE_ENV=production, the old code fell back to localhost:8002 and Google
 * OAuth returned `please_restart_the_process` (state written on one host,
 * callback on another / verification missing).
 */
function resolveAuthBaseURL(env: AuthEnv): string {
  const raw = (env.API_URL || env.BETTER_AUTH_URL || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  return "http://localhost:8002";
}

function resolveIsProd(env: AuthEnv, baseURL: string): boolean {
  if (env.NODE_ENV === "production") return true;
  if (env.NODE_ENV === "development" || env.NODE_ENV === "dev" || env.NODE_ENV === "test") {
    return false;
  }
  // NODE_ENV unset on many CF Workers — treat https API origin as production.
  return baseURL.startsWith("https://");
}

export function createAuth(
  db: ReturnType<typeof createDb>,
  env: AuthEnv,
  sendResetPassEmail?: SendEmailFn,
  activity?: AuthActivityHooks,
) {
  const baseURL = resolveAuthBaseURL(env);
  const isProd = resolveIsProd(env, baseURL);
  const secret = env.BETTER_AUTH_SECRET?.trim() || undefined;

  if (isProd && (!secret || secret.length < 32)) {
    console.error(
      "[auth] BETTER_AUTH_SECRET is missing or shorter than 32 chars. " +
        "OAuth state cookies and sessions will be insecure or fail. " +
        "Set it as a Cloudflare secret and pass it into createAuth.",
    );
  }

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),

    // Explicit secret — CF Workers do not expose wrangler secrets on process.env
    // so better-auth's env.BETTER_AUTH_SECRET lookup would miss them.
    ...(secret ? { secret } : {}),

    baseURL,
    basePath: "/api/auth",

    trustedOrigins: [
      ...(env.ORIGINS
        ? env.ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
        : []),
      "https://mantomart.com",
      "https://admin.mantomart.com",
      "https://api.mantomart.com",
      "http://localhost:8000",
      "http://localhost:8001",
      "http://localhost:8002",
    ],

    // OAuth state lives in D1; still set a state cookie as CSRF. Skip the
    // cookie check only if you hit cookie-loss on multi-origin setups — keep
    // the default (false) for security.
    account: {
      storeStateStrategy: "database",
    },

    advanced: {
      /**
       * Production: session cookie is scoped to DOMAIN (e.g. `.mantomart.com`)
       * so mantomart.com (store) and admin.mantomart.com share one login.
       *
       * Local: host-only cookie on the API origin (localhost:8002). Both
       * frontends talk to that same API with credentials, so one login still
       * covers store + admin without cross-port Domain cookies.
       */
      crossSubDomainCookies: {
        enabled: isProd && Boolean(env.DOMAIN),
        domain: isProd && env.DOMAIN ? env.DOMAIN : undefined,
      },
      useSecureCookies: isProd || baseURL.startsWith("https://"),
      // Persist IP / user-agent on the session row (used for lastLoginIp)
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"],
      },
      // SameSite=Lax is enough: store/admin/api share the eTLD+1 in prod,
      // and localhost ports are same-site for credentialed API calls.
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: isProd || baseURL.startsWith("https://"),
        httpOnly: true,
        path: "/",
      },
    },

    user: {
      additionalFields: {
        gender: {
          type: "string",
          required: false,
          input: true,
        },
        role: {
          type: "string",
          required: false,
          input: false,
          defaultValue: "customer",
        },
        /**
         * Denormalized order count. Used by the storefront to hide/show
         * `audience: 'new_user'` homepage slides (totalOrders === 0).
         * Not user-writable.
         */
        totalOrders: {
          type: "number",
          required: false,
          input: false,
          defaultValue: 0,
        },
      },
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,

      resetPassword: {
        enabled: true,
      },

      sendResetPassword: async ({ user, url, token }) => {
        if (sendResetPassEmail) {
          await sendResetPassEmail({ to: user.email, url, token });
        }
      },
    },

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },

    databaseHooks: {
      session: {
        create: {
          after: async (session, context) => {
            try {
              const userId = session.userId;
              if (!userId || !activity?.onLogin) return;

              const ip = extractIpFromContext(
                context as { request?: Request; headers?: Headers } | null,
                typeof session.ipAddress === "string" ? session.ipAddress : null,
              );

              await activity.onLogin({ userId, ip });
            } catch (error) {
              // Never block session creation
              console.error("onLogin hook failed:", error);
            }
          },
        },
      },
    },

    /**
     * Lightweight activity signal on session polls.
     * Throttling is the caller's responsibility (KV in the API worker).
     */
    hooks: activity?.onSessionTouch
      ? {
          after: createAuthMiddleware(async (ctx) => {
            try {
              const path = ctx.path ?? "";
              // get-session is polled by clients; skip other auth endpoints.
              if (!path.endsWith("/get-session") && path !== "/get-session") return;

              const userId = extractTouchedUserId(
                ctx.context as SessionTouchContext,
              );
              if (!userId) return;

              void Promise.resolve(activity.onSessionTouch!(userId)).catch(
                (err) => {
                  console.error("onSessionTouch failed:", err);
                },
              );
            } catch {
              // ignore — activity must never break auth
            }
          }),
        }
      : undefined,
  });
}
