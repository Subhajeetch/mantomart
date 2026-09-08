"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@repo/types/session-client";
import { useSession } from "@/lib/auth-client";
import { UserSidebar } from "./sidebar";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";

export default function UserLayout({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession();
  const session = data as Session | null;
  const router = useRouter();
  const pathname = usePathname();
  const isRoot = pathname === "/user";
  const isWishlistFolder = pathname.startsWith("/user/wishlist/");
  const pageNames: Record<string, string> = {
    "/user/profile": "Profile",
    "/user/sessions": "Manage Sessions",
    "/user/orders": "Orders",
    "/user/wishlists": "Wishlists",
    "/user/addresses": "Saved Addresses",
    "/user/notifications": "Notifications",
  };

  useEffect(() => {
    if (!isPending && !session) router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
  }, [isPending, pathname, router, session]);

  if (isPending) {
    return (
      <main className="flex min-h-[calc(100svh-4rem)] items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </main>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-[calc(100svh-4rem)] bg-background">
      <div className="mx-auto flex max-w-7xl flex-col lg:flex-row">
        <div className={isRoot ? "block lg:block" : "hidden lg:block"}>
          <UserSidebar session={session} />
        </div>
        <main className="min-w-0 flex-1">
          {!isRoot && !isWishlistFolder && (
            <div className="flex items-center gap-3 border-b border-border px-5 py-4 lg:hidden">
              <Link href="/user" aria-label="Back to account" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" />
              </Link>
              <span className="text-sm font-semibold">{pageNames[pathname] ?? "Account"}</span>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
