"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, ShoppingCart, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { getCartSummary, type CartSummary } from "@/app/(with-navbar)/cart/api";

/**
 * Static bottom bar for mobile — links map 1:1 to App Router files:
 * - `/`        → app/(with-navbar)/page.tsx  (store home)
 * - `/search`  → search results (query via `?q=`)
 * - `/cart`    → app/(with-navbar)/cart/page.tsx
 * - `/user`    → app/user/profile/page.tsx          (signed-in profile)
 *
 * Intentionally not driven by the header API so it stays cheap and stable.
 */
const items = [
  { href: "/", label: "Home", icon: Home, match: "exact" as const },
  { href: "/search", label: "Search", icon: Search, match: "prefix" as const },
  { href: "/user", label: "Profile", icon: UserRound, match: "prefix" as const },
    { href: "/cart", label: "Cart", icon: ShoppingCart, match: "prefix" as const },
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
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getCartSummary()
      .then((summary) => {
        if (!cancelled) setCartCount(summary.itemCount);
      })
      .catch(() => undefined);

    const refresh = (event: Event) => {
      const custom = event as CustomEvent<CartSummary>;
      if (custom.detail) {
        setCartCount(custom.detail.itemCount);
        return;
      }
      void getCartSummary(true)
        .then((summary) => setCartCount(summary.itemCount))
        .catch(() => undefined);
    };
    window.addEventListener("cart-updated", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("cart-updated", refresh);
    };
  }, []);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] backdrop-blur sm:hidden"
      aria-label="Mobile primary"
    >
      <div className="mx-auto grid max-w-sm grid-cols-4 gap-1">
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
              <span className="relative">
                <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
                {item.href === "/cart" && cartCount > 0 ? (
                  <span className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                ) : null}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
