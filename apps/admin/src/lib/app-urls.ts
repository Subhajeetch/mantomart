/**
 * Canonical frontend origins for store + admin.
 * Admin has no login UI — unauthenticated users are sent to the store login.
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export function getStoreUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_STORE_URL;
  if (fromEnv?.trim()) return stripTrailingSlash(fromEnv.trim());

  if (process.env.NODE_ENV === "production") {
    return "https://mantomart.com";
  }
  return "http://localhost:8000";
}

export function getAdminUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_ADMIN_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv?.trim()) return stripTrailingSlash(fromEnv.trim());

  if (process.env.NODE_ENV === "production") {
    return "https://admin.mantomart.com";
  }
  return "http://localhost:8001";
}

/** Store login with optional return URL (admin overview after login). */
export function getStoreLoginUrl(returnTo?: string): string {
  const base = `${getStoreUrl()}/login`;
  if (!returnTo) {
    // Default: after login, admins can jump back to the panel from /home.
    return base;
  }
  const params = new URLSearchParams({ returnTo });
  return `${base}?${params.toString()}`;
}

export function getAdminOverviewUrl(): string {
  return `${getAdminUrl()}/overview`;
}

/** Roles that may use the admin dashboard. */
export function canAccessAdminPanel(role: string | null | undefined): boolean {
  return role === "admin" || role === "owner";
}

/**
 * Hard navigation to the store login (cross-origin on production).
 * Prefer this over next/router for external store URLs.
 */
export function redirectToStoreLogin(returnTo?: string): void {
  if (typeof window === "undefined") return;
  window.location.assign(getStoreLoginUrl(returnTo ?? getAdminOverviewUrl()));
}

export function redirectToStoreHome(): void {
  if (typeof window === "undefined") return;
  window.location.assign(`${getStoreUrl()}/home`);
}
