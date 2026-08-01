/**
 * Canonical frontend origins for store + admin.
 * Used for OAuth callbacks, post-login redirects, and the Admin Panel link.
 *
 * Prefer NEXT_PUBLIC_* overrides when set (staging, previews).
 * Fall back to production domains / local ports.
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export function getStoreUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_STORE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv?.trim()) return stripTrailingSlash(fromEnv.trim());

  if (process.env.NODE_ENV === "production") {
    return "https://mantomart.com";
  }
  return "http://localhost:8000";
}

export function getAdminUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_ADMIN_URL;
  if (fromEnv?.trim()) return stripTrailingSlash(fromEnv.trim());

  if (process.env.NODE_ENV === "production") {
    return "https://admin.mantomart.com";
  }
  return "http://localhost:8001";
}

export function getStoreLoginUrl(returnTo?: string): string {
  const base = `${getStoreUrl()}/login`;
  if (!returnTo) return base;
  const params = new URLSearchParams({ returnTo });
  return `${base}?${params.toString()}`;
}

export function getAdminOverviewUrl(): string {
  return `${getAdminUrl()}/overview`;
}

/** Roles that may open the admin dashboard. */
export function canAccessAdminPanel(role: string | null | undefined): boolean {
  return role === "admin" || role === "owner";
}
