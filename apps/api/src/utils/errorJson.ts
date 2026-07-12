import { type Context } from 'hono';
import type { Database } from '@repo/db';
import type Env from '@/types/env';

/** Actor set by admin auth middleware after a successful session check. */
export type AdminActor = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'owner';
};

/**
 * Hono Variables for routes that use auth middleware.
 * Keys must be declared here so `c.set` / `c.get` type-check.
 */
export type AppVariables = {
  actor: AdminActor;
  db: Database;
};

export type AppEnv = {
  Bindings: Env;
  Variables: AppVariables;
};

/** Context for routes that set actor/db via middleware. */
export type AppContext = Context<AppEnv>;

/**
 * Any context that has our Cloudflare bindings.
 * Used by shared helpers (errorJson) that don't need Variables.
 */
export type EnvContext = Context<{ Bindings: Env }>;

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503;

/**
 * Generic over the Hono env so both `{ Bindings }` and
 * `{ Bindings; Variables }` contexts are accepted.
 */
function errorJson<E extends { Bindings: Env }>(
  c: Context<E>,
  status: ErrorStatus,
  code: string,
  message: string
) {
  return c.json(
    {
      success: false,
      error: message,
      code,
    },
    status
  );
}

export { errorJson, type ErrorStatus };
