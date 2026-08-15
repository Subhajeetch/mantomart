import { Hono } from "hono";
import { cors } from "hono/cors";
import type Env from "@/types/env";
import { createAuth } from "@repo/auth/server";
import { createDb } from "@repo/db";
import sendResetPassEmail from "@/utils/sendResetPassEmail";
import {
  recordUserLogin,
  touchLastActive,
} from "@/utils/userActivity";

// routes import
import {
  aeProduct,
  aeAuth,
  googleAuth,
  googleKeywords,
  admins,
  users,
  auditLogs,
  categories,
  addProductMyList,
  manageProducts,
  aiEndpoints,
  editHeader,
  security,
  imageUpload,
  imageProxy,
  getAdminAccount,
  adminStats,
  storeHeader,
  storeImages,
} from "./routes";


const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const origins = (
    c.env.ORIGINS
      ? c.env.ORIGINS.split(",")
      : [
          "https://mantomart.com",
          "https://admin.mantomart.com",
          "http://localhost:8000",
          "http://localhost:8001",
        ]
  )
    .map((o) => o.trim())
    .filter(Boolean);

  return cors({
    origin: origins,
    allowHeaders: ["Content-Type", "Authorization", "Accept"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 86400,
  })(c, next);
});

app.all("/api/auth/*", (c) => {
  const db = createDb(c.env.DB);
  const kv = c.env.KV;

  const auth = createAuth(
    db,
    {
      GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
      BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
      NODE_ENV: c.env.NODE_ENV,
      API_URL: c.env.API_URL,
      BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
      ORIGINS: c.env.ORIGINS,
      DOMAIN: c.env.DOMAIN,
    },
    sendResetPassEmail,
    {
      // One D1 write per login; KV is seeded to prevent an immediate lastActive rewrite.
      onLogin: ({ userId, ip }) =>
        recordUserLogin(db, userId, ip, kv, {
          waitUntil: (p) => c.executionCtx.waitUntil(p),
        }),
      // Polled often by useSession — KV-throttled, max 1 D1 write / 10 min / user
      onSessionTouch: (userId) =>
        touchLastActive(db, kv, userId, {
          waitUntil: (p) => c.executionCtx.waitUntil(p),
        }),
    },
  );

  return auth.handler(c.req.raw);
});

app.get("/api/health", () => {
  return new Response("OK");
});

//routes
app.route("/api/ae/", aeProduct);
app.route("/api/ae/", aeAuth);
app.route("/api/google/", googleAuth);
app.route("/api/google/keywords", googleKeywords);
app.route("/api/admins", admins);
app.route("/api/users", users);
app.route("/api/audit-logs", auditLogs);
app.route("/api/categories", categories);
app.route("/api/products/mylist", addProductMyList);
app.route("/api/products/manage", manageProducts);
app.route("/api/ai", aiEndpoints);
app.route("/api/admin/header", editHeader);
app.route("/api/admin/security", security);
app.route("/api/admin/images", imageUpload);
app.route("/api/admin/image-proxy", imageProxy);
app.route("/api/admin/account", getAdminAccount);
app.route("/api/admin-stats", adminStats);
app.route("/api/store/header", storeHeader);
/** Public R2 object serve — used when R2_PUBLIC_URL is unset (local + default prod). */
app.route("/api/images", storeImages);

export default app;
