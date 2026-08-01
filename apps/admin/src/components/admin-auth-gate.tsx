"use client";

import { useEffect } from "react";
import type { Session } from "@repo/types/session-client";
import { useSession } from "@/lib/auth-client";
import {
  canAccessAdminPanel,
  getAdminOverviewUrl,
  redirectToStoreHome,
  redirectToStoreLogin,
} from "@/lib/app-urls";

/**
 * Client gate for the admin app shell.
 * - No session → store login (admin has no login UI).
 * - Customer / non-staff role → store home.
 * - Staff (admin | owner) → render children.
 *
 * Session cookies live on the API (and `.mantomart.com` in prod), so a login
 * on the store app is enough for this gate to pass.
 */
export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession();
  const session = data as Session | null;

  useEffect(() => {
    if (isPending) return;

    if (!session?.session) {
      redirectToStoreLogin(getAdminOverviewUrl());
      return;
    }

    if (!canAccessAdminPanel(session.user.role)) {
      redirectToStoreHome();
    }
  }, [session, isPending]);

  if (isPending) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center bg-background">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-muted-foreground"
          aria-label="Checking session"
        />
      </div>
    );
  }

  if (!session?.session) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center bg-background">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-muted-foreground"
          aria-label="Redirecting to login"
        />
      </div>
    );
  }

  if (!canAccessAdminPanel(session.user.role)) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center bg-background">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-muted-foreground"
          aria-label="Redirecting"
        />
      </div>
    );
  }

  return <>{children}</>;
}
