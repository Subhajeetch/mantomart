"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Static bottom bar for mobile — links map 1:1 to App Router files:
 * - `/`        → app/(with-navbar)/page.tsx  (store home)
 * - `/search`  → search results (query via `?q=`)
 * - `/home`    → app/home/page.tsx          (signed-in profile)
 *
 * Intentionally not driven by the header API so it stays cheap and stable.
 */
const items = [
  { href: "/", label: "Home", icon: Home, match: "exact" as const },
  { href: "/search", label: "Search", icon: Search, match: "prefix" as const },
  { href: "/home", label: "Profile", icon: UserRound, match: "prefix" as const },
] as const;

function isActivePath(
  pathname: string,
  href: string,
  match: "exact" | "prefix"
) {
  if (match === "exact") {
    return pathname === href;
  }
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] backdrop-blur sm:hidden"
      aria-label="Mobile primary"
    >
      <div className="mx-auto grid max-w-sm grid-cols-3 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href, item.match);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground transition-colors",
                active && "text-primary"
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
