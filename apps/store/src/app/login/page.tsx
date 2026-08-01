import { Metadata } from "next";
import { Suspense } from "react";
import LoginClient from "./LoginClient";

export const metadata: Metadata = {
  title: "Login / Sign up — Mantomart",
  description: "Log in or create an account to access your Mantomart account",
};

function LoginFallback() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-white">
      <div
        className="w-6 h-6 rounded-full border-2 border-neutral-200 border-t-neutral-500 animate-spin"
        aria-label="Loading"
      />
    </main>
  );
}

/**
 * Login is store-only. Admin has no login UI — staff sign in here, then open
 * Admin Panel from /home when they have admin/owner role.
 *
 * Suspense is required because LoginClient reads useSearchParams().
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginClient />
    </Suspense>
  );
}
