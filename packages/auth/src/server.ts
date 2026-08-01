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

export function createAuth(
  db: ReturnType<typeof createDb>,
  env: {
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    NODE_ENV?: string;
    API_URL?: string;
    APP_URL?: string;
    ORIGINS?: string;
    DOMAIN?: string;
  },
  sendResetPassEmail?: SendEmailFn,
  activity?: AuthActivityHooks,
) {
  const isProd = env.NODE_ENV === "production";

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

    baseURL: isProd ? env.API_URL : "http://localhost:8002",
    basePath: "/api/auth",

    trustedOrigins: [
      ...(env.ORIGINS ? env.ORIGINS.split(",") : []),
      "https://mantomart.com",
      "https://admin.mantomart.com",
      "http://localhost:8000",
      "http://localhost:8001",
    ],

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
      // Persist IP / user-agent on the session row (used for lastLoginIp)
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"],
      },
      // SameSite=Lax is enough: store/admin/api share the eTLD+1 in prod,
      // and localhost ports are same-site for credentialed API calls.
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: isProd,
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
