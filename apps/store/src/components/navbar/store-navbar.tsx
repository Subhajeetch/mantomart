'use client';

import { useEffect, useMemo, useState } from 'react';
import config from '@/mine.config';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronRight,
  Heart,
  Bell,
  MapPin,
  Menu,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  UserRound,
  X,
} from 'lucide-react';
import type { Session } from '@repo/types/session-client';

import { useSession } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { useNeedLogin } from '@/components/need-login-context';
import { useWishlist, WishlistPicker } from '@/components/wishlist-context';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  useCart,
} from '@/components/cart-context';

import { resolveNavHref } from './api';
import type { HeaderNavCollection, HeaderNavItem } from './types';
import { Input } from '../ui/input';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/components/ui/navigation-menu';

type StoreNavbarProps = {
  collections: HeaderNavCollection[];
};

const MAX_VISIBLE_COLLECTIONS = 5;
const MAX_MEGA_COLUMNS = 5;

/** Stable id so Base UI Field.Control does not emit mismatched SSR/client useId values. */
const SEARCH_INPUT_ID = 'store-navbar-search';

function getInitials(name: string | null | undefined, email: string) {
  const source = name?.trim() || email;
  return source
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
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
  if (!href || href.startsWith('http') || href.startsWith('//')) return false;
  const path = href.split('?')[0]?.split('#')[0] ?? href;
  if (!path || path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Outline "New" badge for featured leaf categories (primary border + text). */
function FeaturedNewBadge() {
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-primary text-primary text-[11px]"
    >
      New
    </Badge>
  );
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
    position: typeof item.position === 'number' ? item.position : 0,
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
        typeof collection === 'object' &&
        typeof collection.id === 'string' &&
        typeof collection.name === 'string'
    )
    .map((collection) => ({
      id: collection.id,
      name: collection.name,
      slug: collection.slug ?? collection.id,
      href: navHref(collection),
      position:
        typeof collection.position === 'number' ? collection.position : 0,
      items: (collection.items ?? []).map(withChildren).sort((a, b) => {
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
    <Link
      href="/"
      className="flex shrink-0 items-center"
      aria-label={`${config.brandName} home`}
    >
      <Image
        src={config.logoLong}
        alt={config.brandName}
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
 * Depth mirrors the product taxonomy: Collection → Item → Leaf.
 * Leaf links are the primary crawlable destinations in the interactive menu;
 * the full tree is also exposed via SeoNavTree.
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
          const columns = collection.items.slice(0, MAX_MEGA_COLUMNS);
          const columnCount = Math.min(Math.max(columns.length, 1), 3);

          return (
            <NavigationMenuItem
              key={collection.id}
              className="text-foreground/60 hover:text-primary"
            >
              {href && !hasSubMenu ? (
                <NavigationMenuLink
                  href={href}
                  className={cn(
                    'px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition-colors',
                    isActive
                      ? 'text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary'
                      : 'text-foreground hover:text-primary'
                  )}
                >
                  {collection.name}
                </NavigationMenuLink>
              ) : hasSubMenu ? (
                <div>
                  <NavigationMenuTrigger
                    className={cn(
                      'px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition-colors',
                      isActive && 'text-primary'
                    )}
                  >
                    {collection.name}
                  </NavigationMenuTrigger>
                  <NavigationMenuContent className="p-0">
                    {/*
                      w-max + whitespace-nowrap keep intrinsic width stable so labels
                      never reflow to two lines while the popup resizes between triggers.
                    */}
                    <div
                      className="grid w-max gap-x-6 gap-y-4 p-4"
                      style={{
                        gridTemplateColumns: `repeat(${columnCount}, minmax(10.5rem, max-content))`,
                      }}
                    >
                      {columns.map((item) => {
                        const itemHref = navHref(item);
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              'min-w-[10.5rem] space-y-1 rounded-md text-sm',
                              item.featured && 'text-primary'
                            )}
                          >
                            {itemHref ? (
                              <NavigationMenuLink
                                href={itemHref}
                                className="block whitespace-nowrap p-0 text-xs font-semibold uppercase tracking-wide text-primary hover:underline hover:bg-transparent"
                              >
                                {item.name}
                              </NavigationMenuLink>
                            ) : (
                              <div className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-primary">
                                {item.name}
                              </div>
                            )}
                            {item.children.length > 0 && (
                              <ul className="mt-2 space-y-1 text-xs">
                                {item.children.map((child) => {
                                  const childHref = navHref(child);
                                  return (
                                    <li key={child.id}>
                                      {childHref ? (
                                        <NavigationMenuLink
                                          href={childHref}
                                          title={child.name}
                                          className="group/child flex max-w-[14rem] items-center gap-1.5 rounded-md p-0 text-muted-foreground no-underline hover:bg-transparent hover:text-foreground hover:no-underline"
                                        >
                                          <span className="min-w-0 truncate group-hover/child:underline">
                                            {child.name}
                                          </span>
                                          {child.featured && (
                                            <FeaturedNewBadge />
                                          )}
                                        </NavigationMenuLink>
                                      ) : (
                                        <span
                                          title={child.name}
                                          className="flex max-w-[14rem] items-center gap-1.5 text-muted-foreground"
                                        >
                                          <span className="min-w-0 truncate">
                                            {child.name}
                                          </span>
                                          {child.featured && (
                                            <FeaturedNewBadge />
                                          )}
                                        </span>
                                      )}
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
 * Mobile category row: Collection → Item → Leaf (3 levels, same as desktop).
 * Only leaf destinations are links. Parents toggle expand/collapse with a chevron.
 */
function MobileTreeNode({
  item,
  expanded,
  onToggle,
  onClose,
}: {
  item: HeaderNavItem;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const href = navHref(item);
  const hasChildren = item.children.length > 0;
  const isExpanded = expanded.has(item.id);

  // Branch node: expand/collapse only — never a link (matches desktop column headers).
  if (hasChildren) {
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          aria-expanded={isExpanded}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md px-2 py-2.5 text-left text-sm transition-colors',
            'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            item.featured && 'font-semibold text-primary',
            isExpanded ? 'text-foreground' : 'text-foreground/90'
          )}
        >
          <span className="min-w-0 flex-1 truncate font-medium">
            {item.name}
          </span>
          <ChevronRight
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out',
              isExpanded && 'rotate-90'
            )}
          />
        </button>

        {isExpanded && (
          <ul className="ml-3 space-y-0.5 border-l border-border/60 pl-2">
            {item.children.map((child) => {
              const childHref = navHref(child);
              // Desktop only surfaces one level under each column — no deeper nesting.
              return (
                <li key={child.id}>
                  {childHref ? (
                    <Link
                      href={childHref}
                      onClick={onClose}
                      title={child.name}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors',
                        'hover:bg-muted/60 hover:text-foreground'
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {child.name}
                      </span>
                      {child.featured && <FeaturedNewBadge />}
                    </Link>
                  ) : (
                    <span
                      title={child.name}
                      className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {child.name}
                      </span>
                      {child.featured && <FeaturedNewBadge />}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // Leaf item with no children: link when a destination exists.
  if (href) {
    return (
      <Link
        href={href}
        onClick={onClose}
        className={cn(
          'flex items-center rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-muted/60 hover:text-foreground',
          item.featured ? 'font-semibold text-primary' : 'text-foreground/90'
        )}
      >
        {item.name}
      </Link>
    );
  }

  return (
    <span className="flex items-center px-2 py-2.5 text-sm text-muted-foreground">
      {item.name}
    </span>
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const handleToggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Reset expand state when the drawer closes so the next open starts clean.
  useEffect(() => {
    if (!open) {
      setExpanded(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 lg:hidden',
        open ? 'pointer-events-auto' : 'pointer-events-none'
      )}
      aria-hidden={!open}
    >
      <Button
        type="button"
        variant="outline"
        aria-label="Close menu"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        className={cn(
          // Full-screen scrim: override size/border/hover from outline so it stays a backdrop.
          'absolute inset-0 size-auto h-auto w-auto rounded-none border-0 bg-black/20 p-0 shadow-none backdrop-blur-[2px] transition-opacity duration-200',
          'hover:bg-black/20 hover:text-inherit focus-visible:border-transparent focus-visible:ring-0',
          open ? 'opacity-100' : 'opacity-0'
        )}
      />
      <aside
        className={cn(
          'relative flex h-full w-[min(86vw,360px)] flex-col border-r bg-background shadow-2xl transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : '-translate-x-full'
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
            variant="outline"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="size-5" />
          </Button>
        </div>

        <nav
          className="flex-1 overflow-y-auto px-3 py-4"
          aria-label="Mobile categories"
        >
          {collections.length === 0 ? (
            <p className="px-2 py-8 text-sm text-muted-foreground">
              Categories are not available right now.
            </p>
          ) : (
            <div className="space-y-1">
              {collections.map((collection) => {
                const collectionExpanded = expanded.has(collection.id);
                const hasItems = collection.items.length > 0;

                return (
                  <div
                    key={collection.id}
                    className="border-b border-border/50 last:border-b-0"
                  >
                    {hasItems ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleToggle(collection.id)}
                          aria-expanded={collectionExpanded}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-md px-2 py-3 text-left transition-colors',
                            'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                          )}
                        >
                          <span className="text-sm font-semibold uppercase tracking-wide text-foreground">
                            {collection.name}
                          </span>
                          <ChevronRight
                            aria-hidden
                            className={cn(
                              'size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out',
                              collectionExpanded && 'rotate-90'
                            )}
                          />
                        </button>

                        {collectionExpanded && (
                          <ul className="space-y-0.5 pb-2 pl-1">
                            {collection.items.map((item) => (
                              <li key={item.id}>
                                <MobileTreeNode
                                  item={item}
                                  expanded={expanded}
                                  onToggle={handleToggle}
                                  onClose={onClose}
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    ) : (
                      (() => {
                        const href = navHref(collection);
                        return href ? (
                          <Link
                            href={href}
                            onClick={onClose}
                            className="flex items-center rounded-md px-2 py-3 text-sm font-semibold uppercase tracking-wide text-foreground transition-colors hover:bg-muted/60 hover:text-primary"
                          >
                            {collection.name}
                          </Link>
                        ) : (
                          <span className="flex items-center px-2 py-3 text-sm font-semibold uppercase tracking-wide text-foreground">
                            {collection.name}
                          </span>
                        );
                      })()
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
        {item.children.length > 0 && <ul>{item.children.map(renderItem)}</ul>}
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
  const router = useRouter();
  const { data: session } = useSession();
  const { openNeedLogin } = useNeedLogin();
  const { pulse } = useWishlist();
  const { summary: cartSummary } = useCart();
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
        <div className="relative mx-auto flex h-16 max-w-7xl items-center gap-3 px-3 sm:px-4 lg:px-6">
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
              id={SEARCH_INPUT_ID}
              name="q"
              type="search"
              placeholder="Search for products, brands and more"
              aria-label="Search products"
              className="h-9 w-full pl-9 pr-3"
            />
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2 md:ml-0">
            <div className="hidden sm:flex">
              <AccountButton />
            </div>
            <button
              type="button"
              aria-label="Wishlist"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'icon' }),
                'sm:hidden'
              )}
              onClick={() => {
                if (!session?.user?.id) {
                  openNeedLogin({
                    title: 'Login to continue',
                    description:
                      'Log in to view and manage the products you’ve saved. We’ll bring you right back.',
                    returnTo:
                      typeof window !== 'undefined'
                        ? window.location.href
                        : undefined,
                  });
                  return;
                }
                router.push('/user/wishlists');
              }}
            >
              <Heart
                className={cn(
                  'size-5 transition-colors',
                  pulse &&
                    'animate-[wishlist-pop_650ms_ease-in-out] fill-[#ff3f6c] text-[#ff3f6c]'
                )}
              />
            </button>
            <div className="hidden sm:flex">
              <button
                type="button"
                aria-label="Wishlist"
                className={cn(
                  buttonVariants({ variant: 'ghost' }),
                  'h-auto flex-col items-center gap-0.5 px-2 py-1.5 text-[11px] font-medium leading-none text-muted-foreground hover:text-foreground'
                )}
                onClick={() => {
                  if (!session?.user?.id) {
                    openNeedLogin({
                      title: 'Log in to continue',
                      description:
                        'Log in to view and manage the products you’ve saved. We’ll bring you right back.',
                      returnTo:
                        typeof window !== 'undefined'
                          ? window.location.href
                          : undefined,
                    });
                    return;
                  }
                  router.push('/user/wishlists');
                }}
              >
                <span className="flex h-6 items-center justify-center">
                  <Heart
                    className={cn(
                      'size-5 transition-colors',
                      pulse &&
                        'animate-[wishlist-pop_650ms_ease-in-out] fill-[#ff3f6c] text-[#ff3f6c]'
                    )}
                  />
                </span>
                <span className="font-bold">Wishlist</span>
              </button>
            </div>
            <Link
              href="/cart"
              aria-label="Cart"
              className={cn(
                buttonVariants({ variant: 'ghost' }),
                // The cart lives in the bottom nav on small screens — hide this
                // one while the mobile bar is visible (< sm) to avoid duplicates.
                'relative hidden h-auto flex-col items-center gap-0.5 px-2 py-1.5 text-[11px] font-medium leading-none text-muted-foreground hover:text-foreground sm:inline-flex'
              )}
            >
              <span className="flex h-6 items-center justify-center">
                <ShoppingCart className="size-5" />
              </span>
              <span className="font-bold">Cart</span>
              {cartSummary && cartSummary.itemCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
                  {cartSummary.itemCount > 99 ? '99+' : cartSummary.itemCount}
                </span>
              ) : null}
            </Link>
          </div>
          <WishlistPicker />
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

  // Gate on a mounted flag so the server render and the first client render
  // are identical. Without it, better-auth resolves the session from storage
  // during hydration, so the client paints the login link while the server
  // painted the loading skeleton — causing a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isPending) {
    return (
      <div
        className="size-8 animate-pulse rounded-full bg-muted hidden sm:inline-flex"
        aria-hidden
      />
    );
  }

  return (
    <Popover open={accountOpen} onOpenChange={setAccountOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Open account menu"
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              'h-auto flex-col items-center gap-0.5 px-2 py-1.5 text-[11px] font-medium leading-none text-muted-foreground hover:text-foreground'
            )}
          />
        }
      >
        <span className="flex h-6 items-center justify-center">
          {user ? (
            <Avatar size="sm">
              <AvatarImage
                src={user.image ?? undefined}
                alt={user.name ?? 'Profile'}
              />
              <AvatarFallback>
                {getInitials(user.name, user.email)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <UserRound className="size-5" />
          )}
        </span>
        <span className="font-bold">Profile</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        {user ? (
          <Link
            href="/user/profile"
            onClick={() => setAccountOpen(false)}
            className="flex items-center gap-3 rounded-md p-3 transition-colors hover:bg-muted"
          >
            <Avatar size="lg">
              <AvatarImage
                src={user.image ?? undefined}
                alt={user.name ?? 'Profile'}
              />
              <AvatarFallback>
                {getInitials(user.name, user.email)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {user.name || 'Your account'}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            </span>
          </Link>
        ) : (
          <PopoverHeader className="p-3">
            <PopoverTitle>Access your account</PopoverTitle>
            <PopoverDescription>
              Log in to manage your profile, orders, wishlists, and more.
            </PopoverDescription>
            <Link
              href="/login?returnTo=%2Fuser"
              onClick={() => setAccountOpen(false)}
              className={cn(buttonVariants(), 'mt-2 w-full')}
            >
              Log in
            </Link>
          </PopoverHeader>
        )}
        <div className="my-1 h-px bg-border" />
        <PopoverHeader className="px-3 pb-1 pt-2">
          <PopoverTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Account
          </PopoverTitle>
        </PopoverHeader>
        <nav aria-label="Account links" className="grid gap-0.5">
          <AccountMenuLink
            href="/user/orders"
            icon={ShoppingBag}
            label="Orders"
            onClick={() => setAccountOpen(false)}
          />
          <AccountMenuLink
            href="/user/wishlists"
            icon={Heart}
            label="Wishlist"
            onClick={() => setAccountOpen(false)}
          />
          <AccountMenuLink
            href="/user/addresses"
            icon={MapPin}
            label="Saved addresses"
            onClick={() => setAccountOpen(false)}
          />
          <AccountMenuLink
            href="/user/notifications"
            icon={Bell}
            label="Notifications"
            onClick={() => setAccountOpen(false)}
          />
          <AccountMenuLink
            href="/user/sessions"
            icon={ShieldCheck}
            label="Manage sessions"
            onClick={() => setAccountOpen(false)}
          />
        </nav>
      </PopoverContent>
    </Popover>
  );
}

function AccountMenuLink({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href: string;
  icon: typeof UserRound;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-muted"
    >
      <Icon className="size-4 text-muted-foreground" />
      <span>{label}</span>
      <ChevronRight className="ml-auto size-4 text-muted-foreground" />
    </Link>
  );
}
