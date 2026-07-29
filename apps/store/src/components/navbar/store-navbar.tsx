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
  Folder,
  FolderOpen,
} from "lucide-react";
import type { Session } from "@repo/types/session-client";

import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

import { resolveNavHref } from "./api";
import type { HeaderNavCollection, HeaderNavItem } from "./types";
import { Input } from "../ui/input";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";

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
 * Desktop navigation using Shadcn NavigationMenu.
 * Provides a clean, modern navigation structure.
 */
function DesktopNavigationMenu({
  collections,
  pathname,
}: {
  collections: HeaderNavCollection[];
  pathname: string;
}) {
  if (collections.length === 0) return null;

  return (
    <NavigationMenu className="hidden lg:block">
      <NavigationMenuList className="flex items-center ml-6">
        {collections.map((collection) => {
          const href = navHref(collection);
          const isActive = isPathActive(pathname, href);
          const hasSubMenu = collection.items.length > 0;

          return (
            <NavigationMenuItem key={collection.id} className="text-foreground/60 hover:text-primary">
              {href && !hasSubMenu ? (
                <NavigationMenuLink
                  href={href}
                  className={cn(
                    "px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition-colors",
                    isActive
                      ? "text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
                      : "text-foreground hover:text-primary"
                  )}
                >
                  {collection.name}
                </NavigationMenuLink>
              ) : hasSubMenu ? (
                <div>
                  <NavigationMenuTrigger
                    className={cn(
                      "px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition-colors",
                      isActive && "text-primary"
                    )}
                  >
                    {collection.name}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent className="p-0">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                      {collection.items.slice(0, MAX_MEGA_COLUMNS).map((item) => {
                        const itemHref = navHref(item);
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "space-y-1 rounded-md p-3 text-sm",
                              item.featured && "text-primary"
                            )}
                          >
                            <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                              {item.name}
                            </div>
                            {item.children.length > 0 && (
                              <ul className="mt-2 space-y-1 text-xs">
                                {item.children.map((child) => {
                                  const childHref = navHref(child);
                                  return childHref ? (
                                    <li key={child.id}>
                                      <NavigationMenuLink
                                        href={childHref}
                                        className="flex items-center p-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-background hover:underline"
                                      >
                                        {child.name}
                                      </NavigationMenuLink>
                                    </li>
                                  ) : (
                                    <li key={child.id}>
                                      <span className="text-muted-foreground">
                                        {child.name}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </NavigationMenuContent>
                </div>
              ) : (
                <span className="px-3 py-1.5 text-sm font-semibold uppercase tracking-wide text-foreground">
                  {collection.name}
                </span>
              )}
            </NavigationMenuItem>
          );
        })}
      </NavigationMenuList>
    </NavigationMenu>
  );
}

/**
 * Mobile navigation as a file-tree structure (like VS Code).
 * Supports expand/collapse with proper indentation.
 */
interface MobileTreeNodeProps {
  item: HeaderNavItem;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
}

function MobileTreeNode({
  item,
  depth,
  expanded,
  onToggle,
  onClose,
}: MobileTreeNodeProps) {
  const href = navHref(item);
  const hasChildren = item.children.length > 0;
  const isExpanded = expanded.has(item.id);

  const paddingLeft = depth * 16;

  return (
    <div>
      <div className="flex items-center">
        {/* Expand/Collapse toggle for items with children */}
        {hasChildren && (
          <button
            type="button"
            onClick={() => onToggle(item.id)}
            className="mr-1 flex h-4 w-4 items-center justify-center"
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.name}`}
          >
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Folder className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        )}
        {!hasChildren && <div className="mr-2 w-4" />}

        {/* Item link or text */}
        {href ? (
          <Link
            href={href}
            onClick={onClose}
            className={cn(
              "flex items-center py-1 text-sm",
              item.featured && "text-pink-500 font-semibold",
              "hover:text-foreground"
            )}
            style={{ paddingLeft: `${paddingLeft}px` }}
          >
            {item.name}
          </Link>
        ) : (
          <span
            className={cn(
              "flex items-center py-1 text-sm",
              item.featured && "text-pink-500 font-semibold",
              "text-muted-foreground"
            )}
            style={{ paddingLeft: `${paddingLeft}px` }}
          >
            {item.name}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <ul className="ml-4">
          {item.children.map((child) => (
            <li key={child.id}>
              <MobileTreeNode
                item={child}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                onClose={onClose}
              />
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
  // Track expanded state for each tree node
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const handleToggle = (id: string) => {
    setExpanded((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

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
            <div className="space-y-2">
              {collections.map((collection) => {
                const href = navHref(collection);

                return (
                  <div key={collection.id} className="border-b pb-2">
                    {/* Collection header */}
                    <div className="flex items-center px-2">
                      {href ? (
                        <Link
                          href={href}
                          onClick={onClose}
                          className="text-sm font-semibold uppercase tracking-wide text-foreground hover:text-pink-500"
                        >
                          {collection.name}
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold uppercase tracking-wide text-foreground">
                          {collection.name}
                        </span>
                      )}
                    </div>

                    {/* Collection items as tree */}
                    {collection.items.length > 0 && (
                      <ul className="mt-1 ml-4">
                        {collection.items.map((item) => (
                          <li key={item.id}>
                            <MobileTreeNode
                              item={item}
                              depth={1}
                              expanded={expanded}
                              onToggle={handleToggle}
                              onClose={onClose}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
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

          <DesktopNavigationMenu
            collections={visibleCollections}
            pathname={pathname}
          />

          <div className="h-full w-full flex-1"></div>

          <form
            action="/search"
            method="get"
            role="search"
            className="relative mr-2 hidden min-w-55 max-w-md flex-1 md:block lg:ml-4 lg:flex-none lg:w-72 xl:w-80"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              type="search"
              placeholder="Search for products, brands and more"
              aria-label="Search products"
              className="h-9 w-full pl-9 pr-3"
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

function AccountButton() {
  const { data, isPending } = useSession();
  const session = data as Session | null;
  const user = session?.user;

  if (isPending) {
    return (
      <div className="size-8 animate-pulse rounded-full bg-muted hidden sm:inline-flex" aria-hidden />
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
      className="size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground hidden sm:inline-flex"
    >
      <Avatar>
        <AvatarImage src={user.image ?? undefined} alt={user.name ?? "Profile"} />
        <AvatarFallback>{getInitials(user.name, user.email)}</AvatarFallback>
      </Avatar>
    </Link>
  );
}