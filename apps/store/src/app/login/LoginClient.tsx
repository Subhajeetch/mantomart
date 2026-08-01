"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LoginForm from "./components/login-form";
import { authClient, useSession } from "@/lib/auth-client";
import {
  canAccessAdminPanel,
  getAdminOverviewUrl,
  getStoreUrl,
} from "@/lib/app-urls";
import type { Session } from "@repo/types/session-client";

/**
 * Client-only login shell.
 * - Already-authenticated users skip the form.
 * - Optional `?returnTo=` (absolute URL on our admin/store origins) after success.
 * - Admins arriving from the admin app get a path back to the panel.
 */
export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, isPending } = useSession();
  const session = data as Session | null;

  const storeUrl = useMemo(() => getStoreUrl(), []);
  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get("returnTo"), storeUrl),
    [searchParams, storeUrl],
  );

  useEffect(() => {
    if (isPending || !session?.session) return;

    if (returnTo) {
      window.location.assign(returnTo);
      return;
    }

    // Already signed in — send staff to admin if they opened /login cold.
    if (canAccessAdminPanel(session.user.role) && searchParams.get("admin") === "1") {
      window.location.assign(getAdminOverviewUrl());
      return;
    }

    router.replace("/home");
  }, [isPending, session, returnTo, router, searchParams]);

  function handleSuccess() {
    if (returnTo) {
      window.location.assign(returnTo);
      return;
    }
    router.push("/home");
  }

  if (isPending) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white">
        <div
          className="w-6 h-6 rounded-full border-2 border-neutral-200 border-t-neutral-500 animate-spin"
          aria-label="Loading"
        />
      </main>
    );
  }

  // While redirecting an existing session, avoid flashing the form.
  if (session?.session) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white">
        <div
          className="w-6 h-6 rounded-full border-2 border-neutral-200 border-t-neutral-500 animate-spin"
          aria-label="Redirecting"
        />
      </main>
    );
  }

  return (
    <LoginForm
      authClient={authClient}
      appUrl={storeUrl}
      successRedirect={returnTo}
      onSuccess={handleSuccess}
    />
  );
}

/**
 * Only allow returnTo URLs on our store/admin origins (open-redirect safe).
 */
function sanitizeReturnTo(
  raw: string | null,
  storeUrl: string,
): string | null {
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const allowed = new Set(
      [
        storeUrl,
        process.env.NEXT_PUBLIC_ADMIN_URL,
        process.env.NODE_ENV === "production"
          ? "https://admin.mantomart.com"
          : "http://localhost:8001",
        process.env.NODE_ENV === "production"
          ? "https://mantomart.com"
          : "http://localhost:8000",
      ]
        .filter(Boolean)
        .map((o) => new URL(String(o)).origin),
    );

    if (!allowed.has(url.origin)) return null;
    // Disallow javascript: etc. — URL constructor already forces http(s) here.
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
