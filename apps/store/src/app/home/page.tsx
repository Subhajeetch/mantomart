"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession, authClient } from "@/lib/auth-client";
import type { Session } from "@repo/types/session-client";
import {
  canAccessAdminPanel,
  getAdminOverviewUrl,
} from "@/lib/app-urls";

export default function HomePage() {
  const { data, isPending } = useSession();
  const session = data as Session | null;
  const router = useRouter();

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
    }
  }, [session, isPending, router]);

  if (isPending) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div
          className="w-6 h-6 rounded-full border-2 border-neutral-700 border-t-neutral-400 animate-spin"
          aria-label="Loading"
        />
      </main>
    );
  }

  if (!session) return null;

  const { user } = session;
  const showAdminPanel = canAccessAdminPanel(user.role);

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email.slice(0, 2).toUpperCase();

  const expiresAt = session.session?.expiresAt
    ? new Date(session.session.expiresAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "N/A";

  return (
    <main className="min-h-screen bg-neutral-950 flex justify-center p-6">
      <div className="w-full max-w-lg pt-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <span className="text-sm font-bold tracking-widest text-neutral-200">
            MANTOMART
          </span>
          <button
            type="button"
            onClick={() =>
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => router.push("/login"),
                },
              })
            }
            className="text-xs text-neutral-500 border border-neutral-800 rounded-lg px-3 py-1.5 hover:border-neutral-700 hover:text-neutral-400 transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>

        {/* Profile card */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 flex items-center gap-4 mb-4">
          <div className="relative shrink-0">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt={user.name}
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-linear-to-br from-neutral-700 to-neutral-500 flex items-center justify-center text-xl font-bold text-neutral-200">
                {initials}
              </div>
            )}
            <span className="absolute bottom-0.5 right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-neutral-900" />
          </div>

          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="text-xl font-bold text-neutral-100 tracking-tight truncate">
              {user.name ?? "No name set"}
            </h1>
            <p className="text-sm text-neutral-500 truncate">{user.email}</p>
            <span className="inline-block mt-1 bg-neutral-800 border border-neutral-700 rounded-md px-2 py-0.5 text-xs text-neutral-400 uppercase tracking-wider w-fit">
              {user.role ?? "customer"}
            </span>
          </div>
        </div>

        {/* Admin entry — only for staff roles; session is shared with admin via API cookies */}
        {showAdminPanel && (
          <a
            href={getAdminOverviewUrl()}
            className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-blue-500/30 bg-blue-500/10 px-5 py-4 text-blue-300 transition-colors hover:border-blue-400/50 hover:bg-blue-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold tracking-wide text-blue-200">
                Admin Panel
              </span>
              <span className="text-xs text-blue-300/70">
                Open the staff dashboard
              </span>
            </div>
            <span aria-hidden className="text-lg text-blue-300/80">
              →
            </span>
          </a>
        )}

        {/* Session details */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 mb-4">
          <p className="text-xs font-semibold text-neutral-600 uppercase tracking-widest mb-2">
            Session Details
          </p>
          <div className="flex flex-col divide-y divide-neutral-800">
            <DetailRow label="User ID" value={user.id} mono />
            <DetailRow
              label="Email Verified"
              value={user.emailVerified ? "Yes ✓" : "No ✗"}
            />
            <DetailRow label="Session Expires" value={expiresAt} />
          </div>
        </div>

        {/* Raw session dump */}
        <details className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
          <summary className="text-xs text-neutral-600 cursor-pointer select-none hover:text-neutral-400 transition-colors">
            Raw session object
          </summary>
          <pre className="mt-4 text-xs text-neutral-500 font-mono overflow-auto leading-relaxed">
            {JSON.stringify(session, null, 2)}
          </pre>
        </details>
      </div>
    </main>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 py-3">
      <span className="text-xs text-neutral-600 uppercase tracking-wider">
        {label}
      </span>
      <span
        className={`text-sm text-neutral-300 ${
          mono ? "font-mono text-xs text-neutral-500 break-all" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
