import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStoreLoginUrl, getAdminOverviewUrl } from "@/lib/app-urls";

export const metadata: Metadata = {
  title: "Redirecting to login — Mantomart Admin",
  description: "Admin login is handled on the main Mantomart storefront.",
};

/**
 * Admin has no login UI. Bookmarks / old links to /login are forwarded
 * to the store login with a returnTo back to the admin overview.
 *
 * Session cookies are shared via better-auth (same API + cross-subdomain
 * cookies on .mantomart.com in production).
 */
export default function LoginPage() {
  redirect(getStoreLoginUrl(getAdminOverviewUrl()));
}
