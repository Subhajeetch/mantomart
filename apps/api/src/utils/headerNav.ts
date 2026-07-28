import { asc, and, eq, inArray } from "drizzle-orm";
import {
  categories,
  headerCollectionItems,
  headerCollections,
  type Category,
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
  position: number;
  featured: boolean;
  /** Nested subcategories (e.g. Men → Shirts). */
  children: HeaderNavItem[];
};

export type HeaderNavCollection = {
  id: string;
  name: string;
  slug: string;
  href: string;
  position: number;
  /**
   * First-level children of the root category.
   * Typical shape: Men / Women columns in the mega menu.
   */
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
  categoryId: string | null;
  name: string;
  slug: string;
  href: string | null;
  position: number;
  isVisible: boolean;
  createdAt: Date | string | number | null;
  updatedAt: Date | string | number | null;
  items: HeaderAdminItem[];
};

function categoryHref(slug: string): string {
  return `/category/${slug}`;
}

function defaultCollectionHref(slug: string): string {
  return categoryHref(slug);
}

function defaultItemHref(itemSlug: string, collectionSlug: string): string {
  return categoryHref(itemSlug || collectionSlug);
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

function getUpdatedTime(value: Date | string | number | null): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function groupCategoriesByParent(rows: Category[]) {
  const byParent = new Map<string | null, Category[]>();
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }
  return byParent;
}

function serializeItem(
  item: HeaderCollectionItem,
  collectionSlug: string
): HeaderNavItem {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    href: defaultItemHref(item.slug, collectionSlug),
    position: item.position,
    featured: item.featured,
    children: [],
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

function serializeCategoryItem(
  category: Category,
  childrenByParent: Map<string | null, Category[]>
): HeaderNavItem {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    href: categoryHref(category.slug),
    position: category.position,
    featured: false,
    children: (childrenByParent.get(category.id) ?? []).map((child) =>
      serializeCategoryItem(child, childrenByParent)
    ),
  };
}

function serializeCategoryAdminItem(
  category: Category,
  childrenByParent: Map<string | null, Category[]>
): HeaderAdminItem {
  return {
    ...serializeCategoryItem(category, childrenByParent),
    isVisible: true,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

function trackLatest(
  current: number | null,
  value: Date | string | number | null
): number | null {
  const next = getUpdatedTime(value);
  if (next === null) return current;
  if (current === null) return next;
  return Math.max(current, next);
}

/**
 * Load visible collections (+ category tree) from D1 for the public storefront.
 * Caps at MAX_VISIBLE_HEADER_COLLECTIONS.
 *
 * When a header collection slug matches a category, the mega-menu is built
 * from that category's descendants (e.g. Fashion → Men / Women → …).
 * Legacy free-form header items are used only as a fallback.
 */
export async function loadPublicHeaderNavFromDb(
  db: Database
): Promise<HeaderNavPayload> {
  const [collections, categoryRows] = await Promise.all([
    db
      .select()
      .from(headerCollections)
      .where(eq(headerCollections.isVisible, true))
      .orderBy(asc(headerCollections.position), asc(headerCollections.name)),
    db
      .select()
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.name)),
  ]);

  const limited = collections.slice(0, MAX_VISIBLE_HEADER_COLLECTIONS);
  const categoriesBySlug = new Map(categoryRows.map((row) => [row.slug, row]));
  const categoriesById = new Map(categoryRows.map((row) => [row.id, row]));
  const childrenByParent = groupCategoriesByParent(categoryRows);

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
    const category = categoriesBySlug.get(col.slug) ?? null;
    latestUpdated = trackLatest(
      latestUpdated,
      category?.updatedAt ?? col.updatedAt
    );

    if (category) {
      const categoryItems = (childrenByParent.get(category.id) ?? []).map(
        (child) => {
          latestUpdated = trackLatest(latestUpdated, child.updatedAt);
          return serializeCategoryItem(child, childrenByParent);
        }
      );

      // Also track nested descendants lightly via the category map.
      for (const item of categoryItems) {
        const row = categoriesById.get(item.id);
        latestUpdated = trackLatest(latestUpdated, row?.updatedAt ?? null);
      }

      return {
        id: col.id,
        name: category.name,
        slug: category.slug,
        href: categoryHref(category.slug),
        position: col.position,
        items: categoryItems,
      };
    }

    // Legacy free-form header rows (no matching category).
    const colItems = (itemsByCollection.get(col.id) ?? []).map((item) => {
      latestUpdated = trackLatest(latestUpdated, item.updatedAt);
      return serializeItem(item, col.slug);
    });

    return {
      id: col.id,
      name: col.name,
      slug: col.slug,
      href: defaultCollectionHref(col.slug),
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
 * Linked categories drive names, hrefs, and mega-menu structure.
 */
export async function loadAdminHeaderFromDb(
  db: Database
): Promise<HeaderAdminCollection[]> {
  const [collections, items, categoryRows] = await Promise.all([
    db
      .select()
      .from(headerCollections)
      .orderBy(asc(headerCollections.position), asc(headerCollections.name)),
    db
      .select()
      .from(headerCollectionItems)
      .orderBy(
        asc(headerCollectionItems.position),
        asc(headerCollectionItems.name)
      ),
    db
      .select()
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.name)),
  ]);

  const itemsByCollection = new Map<string, HeaderCollectionItem[]>();
  for (const item of items) {
    const list = itemsByCollection.get(item.collectionId) ?? [];
    list.push(item);
    itemsByCollection.set(item.collectionId, list);
  }

  const categoriesBySlug = new Map(categoryRows.map((row) => [row.slug, row]));
  const childrenByParent = groupCategoriesByParent(categoryRows);

  return collections.map((col) => {
    const category = categoriesBySlug.get(col.slug) ?? null;
    return {
      id: col.id,
      categoryId: category?.id ?? null,
      name: category?.name ?? col.name,
      slug: category?.slug ?? col.slug,
      href: category ? categoryHref(category.slug) : defaultCollectionHref(col.slug),
      position: col.position,
      isVisible: col.isVisible,
      createdAt: col.createdAt,
      updatedAt: col.updatedAt,
      items: category
        ? (childrenByParent.get(category.id) ?? []).map((child) =>
            serializeCategoryAdminItem(child, childrenByParent)
          )
        : (itemsByCollection.get(col.id) ?? []).map((item) =>
            serializeAdminItem(item, col.slug)
          ),
    };
  });
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
