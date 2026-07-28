"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
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

import type { HeaderNavCollection, HeaderNavItem } from "./types";

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
  if (!href) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Normalize API payloads that may omit `children` (older cache). */
function withChildren(item: HeaderNavItem): HeaderNavItem {
  return {
    ...item,
    children: Array.isArray(item.children)
      ? item.children.map(withChildren)
      : [],
  };
}

function normalizeCollections(
  collections: HeaderNavCollection[]
): HeaderNavCollection[] {
  return collections.map((collection) => ({
    ...collection,
    items: (collection.items ?? []).map(withChildren),
  }));
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

/**
 * SEO-friendly desktop mega menu.
 *
 * - Every category is a real <a> (Next Link) so crawlers see the full tree.
 * - Root items with children open a multi-column panel (e.g. Men | Women).
 * - Hover + keyboard focus open the panel; Escape / click-outside close it.
 */
function DesktopCollections({
  collections,
  pathname,
}: {
  collections: HeaderNavCollection[];
  pathname: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const menuId = useId();

  useEffect(() => {
    setOpenId(null);
  }, [pathname]);

  useEffect(() => {
    if (!openId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.(`[data-nav-root="${menuId}"]`)) {
        setOpenId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [menuId, openId]);

  if (collections.length === 0) return null;

  return (
    <nav
      data-nav-root={menuId}
      aria-label="Main categories"
      className="hidden min-w-0 flex-none lg:block"
    >
      <ul className="flex items-center gap-0.5">
        {collections.map((collection) => {
          const active = isActive(pathname, collection.href);
          const hasMenu = collection.items.length > 0;
          const isOpen = openId === collection.id;
          const panelId = `${menuId}-${collection.id}-panel`;

          // Multi-column when first-level items themselves have children
          // (Fashion → Men / Women columns). Otherwise a flat link grid.
          const useSectionColumns = collection.items.some(
            (item) => item.children.length > 0
          );

          return (
            <li
              key={collection.id}
              className="relative"
              onMouseEnter={() => hasMenu && setOpenId(collection.id)}
              onMouseLeave={() => setOpenId((current) => (current === collection.id ? null : current))}
            >
              <div className="flex items-center">
                <Link
                  href={collection.href}
                  className={cn(
                    "inline-flex h-9 items-center px-2.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                    active && "bg-muted text-foreground",
                    isOpen && "bg-muted/70"
                  )}
                  aria-current={active ? "page" : undefined}
                  aria-expanded={hasMenu ? isOpen : undefined}
                  aria-controls={hasMenu ? panelId : undefined}
                  onFocus={() => hasMenu && setOpenId(collection.id)}
                >
                  {collection.name}
                </Link>
                {hasMenu && (
                  <button
                    type="button"
                    className={cn(
                      "inline-flex size-7 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                      isOpen && "bg-muted text-foreground"
                    )}
                    aria-label={`${collection.name} menu`}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() =>
                      setOpenId((current) =>
                        current === collection.id ? null : collection.id
                      )
                    }
                  >
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform duration-200",
                        isOpen && "rotate-180"
                      )}
                    />
                  </button>
                )}
              </div>

              {hasMenu && (
                <div
                  id={panelId}
                  role="region"
                  aria-label={`${collection.name} subcategories`}
                  hidden={!isOpen}
                  className={cn(
                    "absolute top-full left-0 z-50 mt-0 min-w-[280px] border border-border/60 bg-background shadow-lg ring-1 ring-foreground/5",
                    !isOpen && "pointer-events-none"
                  )}
                >
                  {/* Always keep links in the DOM for SEO; hide visually when closed. */}
                  <div className={cn("p-4", !isOpen && "sr-only")}>
                    <div className="mb-3 flex items-center justify-between gap-4 border-b border-border/50 pb-2">
                      <Link
                        href={collection.href}
                        className="text-sm font-semibold text-foreground hover:text-primary"
                      >
                        Shop all {collection.name}
                      </Link>
                    </div>

                    {useSectionColumns ? (
                      <div
                        className={cn(
                          "grid gap-6",
                          collection.items.length === 1 && "grid-cols-1",
                          collection.items.length === 2 && "grid-cols-2 min-w-[440px]",
                          collection.items.length >= 3 && "grid-cols-3 min-w-[640px]"
                        )}
                      >
                        {collection.items.map((section) => (
                          <MegaSection key={section.id} section={section} />
                        ))}
                      </div>
                    ) : (
                      <ul className="grid min-w-[240px] grid-cols-2 gap-1">
                        {collection.items.map((item) => (
                          <li key={item.id}>
                            <Link
                              href={item.href}
                              className="block px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              {item.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function MegaSection({ section }: { section: HeaderNavItem }) {
  return (
    <div className="min-w-[140px]">
      <Link
        href={section.href}
        className="mb-2 block text-sm font-semibold tracking-tight text-foreground hover:text-primary"
      >
        {section.name}
      </Link>
      {section.children.length > 0 ? (
        <ul className="space-y-0.5">
          {section.children.map((child) => (
            <li key={child.id}>
              <Link
                href={child.href}
                className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {child.name}
              </Link>
              {child.children.length > 0 && (
                <ul className="ml-2 border-l border-border/50 pl-2">
                  {child.children.map((grand) => (
                    <li key={grand.id}>
                      <Link
                        href={grand.href}
                        className="block py-0.5 text-xs text-muted-foreground/90 transition-colors hover:text-foreground"
                      >
                        {grand.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground/70">View all</p>
      )}
    </div>
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
        role="dialog"
        aria-modal="true"
        aria-label="Categories"
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

        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Mobile categories">
          <Link
            href="/"
            onClick={onClose}
            className="mb-2 flex h-10 items-center border-b px-2 text-sm font-medium"
          >
            Home
          </Link>
          {collections.length === 0 ? (
            <p className="px-2 py-8 text-sm text-muted-foreground">
              Categories are not available right now.
            </p>
          ) : (
            <div className="space-y-5">
              {collections.map((collection) => (
                <section key={collection.id} className="space-y-1">
                  <Link
                    href={collection.href}
                    onClick={onClose}
                    className="flex min-h-10 items-center px-2 text-sm font-semibold text-foreground hover:bg-muted"
                  >
                    {collection.name}
                  </Link>
                  {collection.items.length > 0 && (
                    <div className="space-y-3 pl-2">
                      {collection.items.map((section) => (
                        <div key={section.id} className="space-y-1">
                          <Link
                            href={section.href}
                            onClick={onClose}
                            className="flex min-h-9 items-center px-2 text-sm font-medium text-foreground hover:bg-muted"
                          >
                            {section.name}
                          </Link>
                          {section.children.length > 0 && (
                            <ul className="grid gap-0.5 border-l border-border/60 pl-3">
                              {section.children.map((child) => (
                                <li key={child.id}>
                                  <Link
                                    href={child.href}
                                    onClick={onClose}
                                    className="flex min-h-8 items-center px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                                  >
                                    {child.name}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
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

/**
 * Visually hidden full category link tree for crawlers / screen readers
 * that may not expand interactive mega menus.
 */
function SeoNavTree({ collections }: { collections: HeaderNavCollection[] }) {
  if (collections.length === 0) return null;

  return (
    <nav className="sr-only" aria-label="All store categories">
      <ul>
        {collections.map((collection) => (
          <li key={collection.id}>
            <Link href={collection.href}>{collection.name}</Link>
            {collection.items.length > 0 && (
              <ul>
                {collection.items.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href}>{item.name}</Link>
                    {item.children.length > 0 && (
                      <ul>
                        {item.children.map((child) => (
                          <li key={child.id}>
                            <Link href={child.href}>{child.name}</Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function StoreNavbar({ collections }: StoreNavbarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleCollections = useMemo(
    () => normalizeCollections(collections).slice(0, 5),
    [collections]
  );

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
            method="get"
            role="search"
            className="relative ml-auto mr-2 hidden min-w-55 max-w-md flex-1 md:block"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              type="search"
              placeholder="Search products"
              aria-label="Search products"
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

        <SeoNavTree collections={visibleCollections} />
      </header>

      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        collections={visibleCollections}
      />
    </>
  );
}
