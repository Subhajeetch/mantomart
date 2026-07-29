"use client";

import { useEffect, useId, useMemo, useState } from "react";
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

import { resolveNavHref } from "./api";
import type { HeaderNavCollection, HeaderNavItem } from "./types";

type StoreNavbarProps = {
  collections: HeaderNavCollection[];
};

const MAX_VISIBLE_COLLECTIONS = 5;
const MAX_MEGA_COLUMNS = 5;

function getInitials(name: string | null | undefined, email: string) {
  const source = name?.trim() || email;
  return source
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function navHref(item: {
  href?: string | null;
  slug?: string | null;
}): string | null {
  return resolveNavHref(item.href, item.slug);
}

function isPathActive(pathname: string, href: string | null) {
  if (!href || href.startsWith("http") || href.startsWith("//")) return false;
  const path = href.split("?")[0]?.split("#")[0] ?? href;
  if (!path || path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isLeaf(item: HeaderNavItem) {
  return !item.children || item.children.length === 0;
}

/** Normalize + sort API payloads (defensive against partial / older cache). */
function withChildren(item: HeaderNavItem): HeaderNavItem {
  const children = Array.isArray(item.children)
    ? item.children.map(withChildren).sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.name.localeCompare(b.name);
      })
    : [];

  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    href: navHref(item),
    position: typeof item.position === "number" ? item.position : 0,
    featured: Boolean(item.featured),
    children,
  };
}

function normalizeCollections(
  collections: HeaderNavCollection[]
): HeaderNavCollection[] {
  if (!Array.isArray(collections)) return [];

  return collections
    .filter(
      (collection): collection is HeaderNavCollection =>
        !!collection &&
        typeof collection === "object" &&
        typeof collection.id === "string" &&
        typeof collection.name === "string"
    )
    .map((collection) => ({
      id: collection.id,
      name: collection.name,
      slug: collection.slug ?? collection.id,
      href: navHref(collection),
      position:
        typeof collection.position === "number" ? collection.position : 0,
      items: (collection.items ?? [])
        .map(withChildren)
        .sort((a, b) => {
          if (a.position !== b.position) return a.position - b.position;
          return a.name.localeCompare(b.name);
        }),
    }))
    .sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_VISIBLE_COLLECTIONS);
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
 * Pink section title — link when the node has a destination, plain text otherwise.
 * Matches the Myntra-style mega menu headers in the design screenshot.
 */
function SectionTitle({
  item,
  className,
}: {
  item: HeaderNavItem;
  className?: string;
}) {
  const href = navHref(item);
  const classes = cn(
    "mb-2 block text-sm font-semibold text-pink-500 transition-colors",
    href && "hover:text-pink-600",
    item.featured && "uppercase tracking-wide",
    className
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {item.name}
        {item.featured ? (
          <span className="ml-1 align-super text-[9px] font-bold text-red-500">
            NEW
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <p className={classes}>
      {item.name}
      {item.featured ? (
        <span className="ml-1 align-super text-[9px] font-bold text-red-500">
          NEW
        </span>
      ) : null}
    </p>
  );
}

function LeafLink({ item }: { item: HeaderNavItem }) {
  const href = navHref(item);

  // Featured leaves render as pink standalone entries (e.g. "Plus Size").
  if (item.featured) {
    if (!href) {
      return (
        <span className="block py-1 text-sm font-semibold text-pink-500">
          {item.name}
        </span>
      );
    }
    return (
      <Link
        href={href}
        className="block py-1 text-sm font-semibold text-pink-500 transition-colors hover:text-pink-600"
      >
        {item.name}
      </Link>
    );
  }

  if (!href) {
    return (
      <span className="block py-0.5 text-sm text-muted-foreground">
        {item.name}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="block py-0.5 text-sm text-foreground/90 transition-colors hover:text-pink-500"
    >
      {item.name}
    </Link>
  );
}

/**
 * One mega-menu column.
 *
 * - Leaf-only section → pink link (standalone category)
 * - Section with children → pink header + dark links
 * - Nested grandchildren → pink sub-header + links (category-tree fallback)
 */
function MegaSection({ section }: { section: HeaderNavItem }) {
  if (isLeaf(section)) {
    return (
      <div className="min-w-0 px-6 py-5 lg:px-8">
        <SectionTitle item={section} className="mb-0" />
      </div>
    );
  }

  // Split children into regular links vs nested groups (have their own kids).
  const linkChildren = section.children.filter(isLeaf);
  const groupChildren = section.children.filter((child) => !isLeaf(child));

  return (
    <div className="min-w-0 px-6 py-5 lg:px-8">
      <SectionTitle item={section} />

      {linkChildren.length > 0 && (
        <ul className="space-y-0.5">
          {linkChildren.map((child) => (
            <li key={child.id}>
              <LeafLink item={child} />
            </li>
          ))}
        </ul>
      )}

      {groupChildren.map((group, index) => (
        <div
          key={group.id}
          className={cn(
            index === 0 && linkChildren.length > 0 && "mt-3 border-t border-border/50 pt-3",
            index > 0 && "mt-3 border-t border-border/50 pt-3"
          )}
        >
          <SectionTitle item={group} />
          {group.children.length > 0 && (
            <ul className="space-y-0.5">
              {group.children.map((grand) => (
                <li key={grand.id}>
                  {isLeaf(grand) ? (
                    <LeafLink item={grand} />
                  ) : (
                    <>
                      <SectionTitle item={grand} className="mb-1 mt-2" />
                      <ul className="space-y-0.5">
                        {grand.children.map((deep) => (
                          <li key={deep.id}>
                            <LeafLink item={deep} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * SEO-friendly desktop mega menu.
 *
 * - Every destination is a real <a> (Next Link) so crawlers see the full tree.
 * - Root tabs with children open a multi-column panel (e.g. Men | Women).
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
      className="hidden min-w-0 flex-1 lg:block"
    >
      <ul className="flex items-center gap-0.5">
        {collections.map((collection) => {
          const href = navHref(collection);
          const active = isPathActive(pathname, href);
          const hasMenu = collection.items.length > 0;
          const isOpen = openId === collection.id;
          const panelId = `${menuId}-${collection.id}-panel`;
          const columnCount = Math.min(
            Math.max(collection.items.length, 1),
            MAX_MEGA_COLUMNS
          );

          return (
            <li
              key={collection.id}
              className="static"
              onMouseEnter={() => hasMenu && setOpenId(collection.id)}
              onMouseLeave={() =>
                setOpenId((current) =>
                  current === collection.id ? null : current
                )
              }
            >
              <div className="flex items-center">
                {href ? (
                  <Link
                    href={href}
                    className={cn(
                      "relative inline-flex h-12 items-center px-3 text-xs font-bold uppercase tracking-wide text-foreground transition-colors hover:text-pink-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                      (active || isOpen) &&
                        "text-pink-500 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-pink-500"
                    )}
                    aria-current={active ? "page" : undefined}
                    aria-expanded={hasMenu ? isOpen : undefined}
                    aria-controls={hasMenu ? panelId : undefined}
                    onFocus={() => hasMenu && setOpenId(collection.id)}
                    onClick={() => {
                      // Keep panel open on click so keyboard users can tab in.
                      if (hasMenu) setOpenId(collection.id);
                    }}
                  >
                    {collection.name}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={cn(
                      "relative inline-flex h-12 items-center px-3 text-xs font-bold uppercase tracking-wide text-foreground transition-colors hover:text-pink-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                      isOpen &&
                        "text-pink-500 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-pink-500"
                    )}
                    aria-expanded={hasMenu ? isOpen : undefined}
                    aria-controls={hasMenu ? panelId : undefined}
                    onFocus={() => hasMenu && setOpenId(collection.id)}
                    onClick={() =>
                      hasMenu &&
                      setOpenId((current) =>
                        current === collection.id ? null : collection.id
                      )
                    }
                  >
                    {collection.name}
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
                    "absolute left-0 top-full z-50 mt-0 w-screen border-t border-border/40 bg-background shadow-xl ring-1 ring-foreground/5",
                    !isOpen && "pointer-events-none"
                  )}
                >
                  {/* Keep links in the DOM for SEO; hide visually when closed. */}
                  <div
                    className={cn(
                      "mx-auto grid max-w-7xl divide-x divide-border/40",
                      !isOpen && "sr-only"
                    )}
                    style={{
                      gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                    }}
                  >
                    {collection.items.slice(0, MAX_MEGA_COLUMNS).map((section) => (
                      <MegaSection key={section.id} section={section} />
                    ))}
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
      href="/home"
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

function MobileMenuItem({
  item,
  depth,
  onClose,
}: {
  item: HeaderNavItem;
  depth: number;
  onClose: () => void;
}) {
  const href = navHref(item);
  const hasChildren = item.children.length > 0;
  const padding =
    depth === 0 ? "min-h-10 px-2 text-sm font-semibold" : depth === 1
      ? "min-h-9 px-2 text-sm font-medium"
      : "min-h-8 px-2 text-sm text-muted-foreground";

  return (
    <div className={cn(depth > 0 && "space-y-0.5")}>
      {href ? (
        <Link
          href={href}
          onClick={onClose}
          className={cn(
            "flex items-center hover:bg-muted hover:text-foreground",
            padding,
            item.featured && "text-pink-500"
          )}
        >
          {item.name}
        </Link>
      ) : (
        <p className={cn("flex items-center text-foreground", padding)}>
          {item.name}
        </p>
      )}

      {hasChildren && (
        <ul
          className={cn(
            "grid gap-0.5",
            depth === 0 && "space-y-1 pl-1",
            depth >= 1 && "border-l border-border/60 pl-3"
          )}
        >
          {item.children.map((child) => (
            <li key={child.id}>
              <MobileMenuItem item={child} depth={depth + 1} onClose={onClose} />
            </li>
          ))}
        </ul>
      )}
    </div>
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

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
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
              {collections.map((collection) => {
                const href = navHref(collection);
                return (
                  <section key={collection.id} className="space-y-1">
                    {href ? (
                      <Link
                        href={href}
                        onClick={onClose}
                        className="flex min-h-10 items-center px-2 text-sm font-semibold uppercase tracking-wide text-foreground hover:bg-muted"
                      >
                        {collection.name}
                      </Link>
                    ) : (
                      <p className="flex min-h-10 items-center px-2 text-sm font-semibold uppercase tracking-wide text-foreground">
                        {collection.name}
                      </p>
                    )}
                    {collection.items.length > 0 && (
                      <div className="space-y-3 pl-1">
                        {collection.items.map((section) => (
                          <MobileMenuItem
                            key={section.id}
                            item={section}
                            depth={1}
                            onClose={onClose}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
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

  const renderItem = (item: HeaderNavItem) => {
    const href = navHref(item);
    return (
      <li key={item.id}>
        {href ? <Link href={href}>{item.name}</Link> : <span>{item.name}</span>}
        {item.children.length > 0 && (
          <ul>{item.children.map(renderItem)}</ul>
        )}
      </li>
    );
  };

  return (
    <nav className="sr-only" aria-label="All store categories">
      <ul>
        {collections.map((collection) => {
          const href = navHref(collection);
          return (
            <li key={collection.id}>
              {href ? (
                <Link href={href}>{collection.name}</Link>
              ) : (
                <span>{collection.name}</span>
              )}
              {collection.items.length > 0 && (
                <ul>{collection.items.map(renderItem)}</ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function StoreNavbar({ collections }: StoreNavbarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleCollections = useMemo(
    () => normalizeCollections(collections),
    [collections]
  );

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="relative mx-auto flex h-16 max-w-450 items-center gap-3 px-3 sm:px-4 lg:px-6">
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
            className="relative ml-auto mr-2 hidden min-w-55 max-w-md flex-1 md:block lg:ml-4 lg:flex-none lg:w-72 xl:w-80"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              type="search"
              placeholder="Search for products, brands and more"
              aria-label="Search products"
              className="h-9 w-full border border-transparent bg-muted/70 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:bg-background focus:ring-1 focus:ring-ring/50"
            />
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2 md:ml-0">
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
