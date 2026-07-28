import { asc, and, eq, inArray } from "drizzle-orm";
import {
  headerCollectionItems,
  headerCollections,
  type Database,
  type HeaderCollection,
  type HeaderCollectionItem,
} from "@repo/db";
import kvManager from "@/utils/kvManager";

/** Public storefront nav cache key. */
export const HEADER_NAV_KV_KEY = "store:header:nav";

/** 5 days in seconds — collections rarely change. */
export const HEADER_NAV_CACHE_TTL_SECONDS = 5 * 24 * 60 * 60;

/** Soft cap for visible top-level collections in the storefront navbar. */
export const MAX_VISIBLE_HEADER_COLLECTIONS = 5;

export type HeaderNavItem = {
  id: string;
  name: string;
  slug: string;
  href: string;
  description: string | null;
  image: string | null;
  position: number;
  featured: boolean;
};

export type HeaderNavCollection = {
  id: string;
  name: string;
  slug: string;
  href: string;
  description: string | null;
  image: string | null;
  position: number;
  items: HeaderNavItem[];
};

export type HeaderNavPayload = {
  collections: HeaderNavCollection[];
  updatedAt: string | null;
  cachedAt: string;
};

export type HeaderAdminItem = HeaderNavItem & {
  isVisible: boolean;
  createdAt: Date | string | number | null;
  updatedAt: Date | string | number | null;
};

export type HeaderAdminCollection = {
  id: string;
  name: string;
  slug: string;
  href: string | null;
  description: string | null;
  image: string | null;
  position: number;
  isVisible: boolean;
  createdAt: Date | string | number | null;
  updatedAt: Date | string | number | null;
  items: HeaderAdminItem[];
};

function defaultCollectionHref(slug: string): string {
  return `/c/${slug}`;
}

function defaultItemHref(collectionSlug: string, itemSlug: string): string {
  return `/c/${collectionSlug}/${itemSlug}`;
}

function resolveHref(
  href: string | null | undefined,
  fallback: string
): string {
  if (typeof href === "string" && href.trim()) {
    return href.trim();
  }
  return fallback;
}

function serializeItem(
  item: HeaderCollectionItem,
  collectionSlug: string
): HeaderNavItem {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    href: resolveHref(item.href, defaultItemHref(collectionSlug, item.slug)),
    description: item.description,
    image: item.image,
    position: item.position,
    featured: item.featured,
  };
}

function serializeAdminItem(
  item: HeaderCollectionItem,
  collectionSlug: string
): HeaderAdminItem {
  return {
    ...serializeItem(item, collectionSlug),
    isVisible: item.isVisible,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * Load visible collections (+ visible items) from D1 for the public storefront.
 * Caps at MAX_VISIBLE_HEADER_COLLECTIONS.
 */
export async function loadPublicHeaderNavFromDb(
  db: Database
): Promise<HeaderNavPayload> {
  const collections = await db
    .select()
    .from(headerCollections)
    .where(eq(headerCollections.isVisible, true))
    .orderBy(asc(headerCollections.position), asc(headerCollections.name));

  const limited = collections.slice(0, MAX_VISIBLE_HEADER_COLLECTIONS);

  const items =
    limited.length === 0
      ? []
      : await db
          .select()
          .from(headerCollectionItems)
          .where(
            and(
              eq(headerCollectionItems.isVisible, true),
              inArray(
                headerCollectionItems.collectionId,
                limited.map((collection) => collection.id)
              )
            )
          )
          .orderBy(
            asc(headerCollectionItems.position),
            asc(headerCollectionItems.name)
          );

  const itemsByCollection = new Map<string, HeaderCollectionItem[]>();
  for (const item of items) {
    const list = itemsByCollection.get(item.collectionId) ?? [];
    list.push(item);
    itemsByCollection.set(item.collectionId, list);
  }

  let latestUpdated: number | null = null;

  const navCollections: HeaderNavCollection[] = limited.map((col) => {
    const colUpdated =
      col.updatedAt instanceof Date
        ? col.updatedAt.getTime()
        : typeof col.updatedAt === "number"
          ? col.updatedAt
          : null;
    if (colUpdated !== null) {
      latestUpdated =
        latestUpdated === null
          ? colUpdated
          : Math.max(latestUpdated, colUpdated);
    }

    const colItems = (itemsByCollection.get(col.id) ?? []).map((item) => {
      const itemUpdated =
        item.updatedAt instanceof Date
          ? item.updatedAt.getTime()
          : typeof item.updatedAt === "number"
            ? item.updatedAt
            : null;
      if (itemUpdated !== null) {
        latestUpdated =
          latestUpdated === null
            ? itemUpdated
            : Math.max(latestUpdated, itemUpdated);
      }
      return serializeItem(item, col.slug);
    });

    return {
      id: col.id,
      name: col.name,
      slug: col.slug,
      href: resolveHref(col.href, defaultCollectionHref(col.slug)),
      description: col.description,
      image: col.image,
      position: col.position,
      items: colItems,
    };
  });

  return {
    collections: navCollections,
    updatedAt:
      latestUpdated !== null ? new Date(latestUpdated).toISOString() : null,
    cachedAt: new Date().toISOString(),
  };
}

/**
 * Full header tree for admin (includes hidden rows, no visibility cap).
 */
export async function loadAdminHeaderFromDb(
  db: Database
): Promise<HeaderAdminCollection[]> {
  const collections = await db
    .select()
    .from(headerCollections)
    .orderBy(asc(headerCollections.position), asc(headerCollections.name));

  const items = await db
    .select()
    .from(headerCollectionItems)
    .orderBy(
      asc(headerCollectionItems.position),
      asc(headerCollectionItems.name)
    );

  const itemsByCollection = new Map<string, HeaderCollectionItem[]>();
  for (const item of items) {
    const list = itemsByCollection.get(item.collectionId) ?? [];
    list.push(item);
    itemsByCollection.set(item.collectionId, list);
  }

  return collections.map((col) => ({
    id: col.id,
    name: col.name,
    slug: col.slug,
    href: col.href,
    description: col.description,
    image: col.image,
    position: col.position,
    isVisible: col.isVisible,
    createdAt: col.createdAt,
    updatedAt: col.updatedAt,
    items: (itemsByCollection.get(col.id) ?? []).map((item) =>
      serializeAdminItem(item, col.slug)
    ),
  }));
}

/**
 * Resolve public nav: KV first, then D1. Re-populates KV on miss.
 */
export async function getPublicHeaderNav(
  db: Database,
  kv: KVNamespace
): Promise<{ data: HeaderNavPayload; source: "kv" | "db" }> {
  const manager = kvManager(kv);

  try {
    const cached = await manager.getJson<HeaderNavPayload>(HEADER_NAV_KV_KEY);
    if (
      cached &&
      typeof cached === "object" &&
      Array.isArray(cached.collections)
    ) {
      return { data: cached, source: "kv" };
    }
  } catch (error) {
    console.error("Failed to read header nav from KV:", error);
  }

  const data = await loadPublicHeaderNavFromDb(db);

  try {
    await manager.setJson(HEADER_NAV_KV_KEY, data, {
      expirationTtl: HEADER_NAV_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.error("Failed to write header nav to KV:", error);
  }

  return { data, source: "db" };
}

/** Drop the public nav cache so the next store request rebuilds from D1. */
export async function invalidateHeaderNavCache(
  kv: KVNamespace
): Promise<void> {
  try {
    await kvManager(kv).delete(HEADER_NAV_KV_KEY);
  } catch (error) {
    console.error("Failed to invalidate header nav KV cache:", error);
  }
}

export function countVisibleCollections(
  collections: Array<Pick<HeaderCollection, "isVisible">>
): number {
  return collections.filter((c) => c.isVisible).length;
}
