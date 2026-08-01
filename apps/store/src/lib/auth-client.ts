import { createAuthClient } from "@repo/auth/client";
import type { AuthClient } from "@repo/auth/client";

/**
 * Prefer an absolute API origin so session cookies set by better-auth are
 * sent cross-origin when the store app and API are on different hosts.
 *
 * When NEXT_PUBLIC_API_URL is unset (e.g. CI build without secrets), omit
 * baseURL so better-auth falls back to same-origin `/api/auth`.
 * Passing `${undefined}/api/auth` throws during SSG and breaks the build.
 */
const apiOrigin = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

export const authClient: AuthClient = createAuthClient(
  apiOrigin ? { baseURL: `${apiOrigin}/api/auth` } : {}
);

export const { signIn, signOut, signUp, useSession } = authClient;
