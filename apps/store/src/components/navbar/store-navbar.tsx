"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Heart,
  Menu,
  Search,
  ShoppingCart,
  UserRound,
  X,
} from "lucide-react";
import type { Session } from "@repo/types/session-client";

import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";

import type { HeaderNavCollection } from "./types";

type StoreNavbarProps = {
  collections: HeaderNavCollection[];
};

function getInitials(name: string | null | undefined, email: string) {
  const source = name?.trim() || email;
  return source
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center" aria-label="Mantomart home">
      <Image
        src="/logos/mantomart-logo.png"
        alt="Mantomart"
        width={158}
        height={40}
        priority
        className="h-9 w-auto object-contain"
      />
    </Link>
  );
}

function DesktopCollections({
  collections,
  pathname,
}: StoreNavbarProps & { pathname: string }) {
  if (collections.length === 0) {
    return null;
  }

  return (
    <NavigationMenu className="hidden min-w-0 flex-none lg:flex">
      <NavigationMenuList>
        {collections.map((collection) => {
          const active = isActive(pathname, collection.href);

          return (
            <NavigationMenuItem key={collection.id}>
              {collection.items.length > 0 ? (
                <>
                  <NavigationMenuTrigger
                    className={cn(active && "bg-muted text-foreground")}
                  >
                    {collection.name}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-[520px] grid-cols-[180px_1fr] gap-2 p-2">
                      <NavigationMenuLink
                        href={collection.href}
                        className="flex h-full flex-col items-start justify-end gap-2 bg-muted/60 p-4"
                      >
                        <span className="text-sm font-semibold text-foreground">
                          {collection.name}
                        </span>
                        {collection.description && (
                          <span className="line-clamp-3 text-xs leading-5 text-muted-foreground">
                            {collection.description}
                          </span>
                        )}
                      </NavigationMenuLink>
                      <div className="grid grid-cols-2 gap-1">
                        {collection.items.slice(0, 10).map((item) => (
                          <NavigationMenuLink
                            key={item.id}
                            href={item.href}
                            className={cn(
                              "items-start gap-2 p-3",
                              item.featured && "bg-primary/5"
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {item.name}
                              </span>
                              {item.description && (
                                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                                  {item.description}
                                </span>
                              )}
                            </span>
                          </NavigationMenuLink>
                        ))}
                      </div>
                    </div>
                  </NavigationMenuContent>
                </>
              ) : (
                <NavigationMenuLink
                  href={collection.href}
                  active={active}
                  className="h-9 px-2.5"
                >
                  {collection.name}
                </NavigationMenuLink>
              )}
            </NavigationMenuItem>
          );
        })}
      </NavigationMenuList>
    </NavigationMenu>
  );
}

function AccountButton() {
  const { data, isPending } = useSession();
  const session = data as Session | null;
  const user = session?.user;

  if (isPending) {
    return (
      <div className="size-8 animate-pulse rounded-full bg-muted" aria-hidden />
    );
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex")}
      >
        <UserRound className="size-3.5" />
        Login
      </Link>
    );
  }

  return (
    <Link
      href="/profile"
      aria-label="Profile"
      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      {user.image ? (
        <img
          src={user.image}
          alt={user.name ?? "Profile"}
          className="size-full object-cover"
        />
      ) : (
        getInitials(user.name, user.email)
      )}
    </Link>
  );
}

function MobileMenu({
  open,
  onClose,
  collections,
}: {
  open: boolean;
  onClose: () => void;
  collections: HeaderNavCollection[];
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 lg:hidden",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/20 backdrop-blur-[2px] transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0"
        )}
      />
      <aside
        className={cn(
          "relative flex h-full w-[min(86vw,360px)] flex-col border-r bg-background shadow-2xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between border-b px-4">
          <Logo />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="size-5" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <Link
            href="/"
            onClick={onClose}
            className="mb-2 flex h-10 items-center border-b px-2 text-sm font-medium"
          >
            All collections
          </Link>
          {collections.length === 0 ? (
            <p className="px-2 py-8 text-sm text-muted-foreground">
              Collections are not available right now.
            </p>
          ) : (
            <div className="space-y-4">
              {collections.map((collection) => (
                <section key={collection.id} className="space-y-1">
                  <Link
                    href={collection.href}
                    onClick={onClose}
                    className="flex min-h-10 items-center justify-between px-2 text-sm font-semibold text-foreground hover:bg-muted"
                  >
                    {collection.name}
                  </Link>
                  {collection.items.length > 0 && (
                    <div className="grid gap-1 pl-3">
                      {collection.items.map((item) => (
                        <Link
                          key={item.id}
                          href={item.href}
                          onClick={onClose}
                          className="flex min-h-9 items-center px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          {item.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </nav>
      </aside>
    </div>
  );
}

export function StoreNavbar({ collections }: StoreNavbarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleCollections = useMemo(() => collections.slice(0, 5), [collections]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="mx-auto flex h-16 max-w-450 items-center gap-3 px-3 sm:px-4 lg:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
          >
            <Menu className="size-5" />
          </Button>

          <Logo />

          <DesktopCollections
            collections={visibleCollections}
            pathname={pathname}
          />

          <form
            action="/search"
            className="relative ml-auto hidden min-w-55 max-w-md flex-1 md:block mr-2"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              type="search"
              placeholder="Search products"
              className="h-9 w-full border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/50"
            />
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
            <AccountButton />
            <Link
              href="/wishlist"
              aria-label="Wishlist"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <Heart className="size-5" />
            </Link>
            <Link
              href="/cart"
              aria-label="Cart"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <ShoppingCart className="size-5" />
            </Link>
          </div>
        </div>
      </header>

      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        collections={visibleCollections}
      />
    </>
  );
}
