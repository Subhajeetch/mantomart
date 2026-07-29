import { asc, eq } from 'drizzle-orm';
import {
  categories,
  headerMenuNodes,
  type Category,
  type Database,
  type HeaderMenuNode,
} from '@repo/db';
import kvManager from '@/utils/kvManager';

/** Public storefront nav cache key. */
export const HEADER_NAV_KV_KEY = 'store:header:nav';

/** 5 days in seconds — collections rarely change. */
export const HEADER_NAV_CACHE_TTL_SECONDS = 5 * 24 * 60 * 60;

/** Soft cap for visible top-level collections in the storefront navbar. */
export const MAX_VISIBLE_HEADER_COLLECTIONS = 5;

export type HeaderNavItem = {
  id: string;
  name: string;
  slug: string;
  /**
   * Resolved navigation target.
   * - customUrl when set
   * - `/category/{slug}` when linked to a category
   * - null for pure grouping labels (no destination)
   */
  href: string | null;
  position: number;
  featured: boolean;
  /** Nested subcategories (e.g. Men → Shirts). */
  children: HeaderNavItem[];
};

export type HeaderNavCollection = {
  id: string;
  name: string;
  slug: string;
  /**
   * Resolved navigation target for the top tab.
   * Same rules as HeaderNavItem.href.
   */
  href: string | null;
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

export type HeaderAdminItem = {
  id: string;
  parentId: string | null;
  categoryId: string | null;
  name: string;
  slug: string;
  href: string | null;
  position: number;
  featured: boolean;
  isVisible: boolean;
  /** Depth under the root tab: 1 = subcategory, 2 = sub-subcategory. */
  depth: number;
  createdAt: Date | string | number | null;
  updatedAt: Date | string | number | null;
  children: HeaderAdminItem[];
};

export type HeaderAdminCollection = {
  id: string;
  categoryId: string | null;
  name: string;
  slug: string;
  href: string | null;
  position: number;
  isVisible: boolean;
  /** True when the storefront still falls back to the category tree. */
  usesCategoryFallback: boolean;
  createdAt: Date | string | number | null;
  updatedAt: Date | string | number | null;
  items: HeaderAdminItem[];
};

/** Max nesting under a root tab: subcategory → sub-subcategory. */
export const MAX_HEADER_ITEM_DEPTH = 2;

function slugifyFallback(input: string, fallback: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 140);
  return slug || fallback;
}

function categoryHref(slug: string): string {
  return `/category/${slug}`;
}

function resolveNode(
  node: HeaderMenuNode,
  categoriesById: Map<string, Category>
) {
  const category = node.categoryId
    ? (categoriesById.get(node.categoryId) ?? null)
    : null;
  const name = node.title?.trim() || category?.name || 'Untitled';
  const slug = category?.slug ?? slugifyFallback(name, node.id);
  const customUrl = node.customUrl?.trim() || null;
  const href = customUrl
    ? customUrl
    : category
      ? categoryHref(category.slug)
      : null;

  return { category, name, slug, href };
}

function sortByPosition<T extends { position: number; id: string }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });
}

function getUpdatedTime(value: Date | string | number | null): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
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
    children: sortByPosition(childrenByParent.get(category.id) ?? []).map(
      (child) => serializeCategoryItem(child, childrenByParent)
    ),
  };
}

function serializeNodeItem(
  node: HeaderMenuNode,
  categoriesById: Map<string, Category>,
  nodeChildrenByParent: Map<string | null, HeaderMenuNode[]>,
  categoryChildrenByParent: Map<string | null, Category[]>
): HeaderNavItem {
  const resolved = resolveNode(node, categoriesById);
  const explicitChildren = sortByPosition(
    (nodeChildrenByParent.get(node.id) ?? []).filter((child) => child.isVisible)
  );
  const children =
    explicitChildren.length > 0
      ? explicitChildren.map((child) =>
          serializeNodeItem(
            child,
            categoriesById,
            nodeChildrenByParent,
            categoryChildrenByParent
          )
        )
      : resolved.category
        ? sortByPosition(
            categoryChildrenByParent.get(resolved.category.id) ?? []
          ).map((child) =>
            serializeCategoryItem(child, categoryChildrenByParent)
          )
        : [];

  return {
    id: node.id,
    name: resolved.name,
    slug: resolved.slug,
    href: resolved.href,
    position: node.position,
    featured: node.featured,
    children,
  };
}

function serializeAdminNodeItem(
  node: HeaderMenuNode,
  categoriesById: Map<string, Category>,
  nodeChildrenByParent: Map<string | null, HeaderMenuNode[]>,
  depth: number
): HeaderAdminItem {
  const resolved = resolveNode(node, categoriesById);
  const explicitChildren = sortByPosition(
    nodeChildrenByParent.get(node.id) ?? []
  );

  return {
    id: node.id,
    parentId: node.parentId,
    categoryId: resolved.category?.id ?? node.categoryId,
    name: resolved.name,
    slug: resolved.slug,
    href: resolved.href,
    position: node.position,
    featured: node.featured,
    isVisible: node.isVisible,
    depth,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    children: explicitChildren.map((child) =>
      serializeAdminNodeItem(
        child,
        categoriesById,
        nodeChildrenByParent,
        depth + 1
      )
    ),
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
 * Explicit child menu nodes are used first. If a node mirrors a category and
 * has no explicit children, the mega-menu falls back to that category's
 * descendants (e.g. Fashion → Men / Women → …).
 */
export async function loadPublicHeaderNavFromDb(
  db: Database
): Promise<HeaderNavPayload> {
  const [nodes, categoryRows] = await Promise.all([
    db
      .select()
      .from(headerMenuNodes)
      .where(eq(headerMenuNodes.isVisible, true))
      .orderBy(asc(headerMenuNodes.position), asc(headerMenuNodes.id)),
    db
      .select()
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.name)),
  ]);

  const topLevelNodes = sortByPosition(
    nodes.filter((node) => node.parentId === null)
  );
  const limited = topLevelNodes.slice(0, MAX_VISIBLE_HEADER_COLLECTIONS);
  const categoriesById = new Map(categoryRows.map((row) => [row.id, row]));
  const categoryChildrenByParent = groupCategoriesByParent(categoryRows);
  const nodeChildrenByParent = groupNodesByParent(nodes);

  let latestUpdated: number | null = null;

  for (const node of nodes) {
    latestUpdated = trackLatest(latestUpdated, node.updatedAt);
    if (node.categoryId) {
      latestUpdated = trackLatest(
        latestUpdated,
        categoriesById.get(node.categoryId)?.updatedAt ?? null
      );
    }
  }

  const navCollections: HeaderNavCollection[] = limited.map((col) => {
    const resolved = resolveNode(col, categoriesById);
    const explicitItems = sortByPosition(
      nodeChildrenByParent.get(col.id) ?? []
    );
    const items =
      explicitItems.length > 0
        ? explicitItems.map((item) =>
            serializeNodeItem(
              item,
              categoriesById,
              nodeChildrenByParent,
              categoryChildrenByParent
            )
          )
        : resolved.category
          ? sortByPosition(
              categoryChildrenByParent.get(resolved.category.id) ?? []
            ).map((child) =>
              serializeCategoryItem(child, categoryChildrenByParent)
            )
          : [];
    return {
      id: col.id,
      name: resolved.name,
      slug: resolved.slug,
      href: resolved.href,
      position: col.position,
      items,
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
 *
 * Only explicit menu nodes are returned so the editor can control structure.
 * When a root tab has no explicit children, `usesCategoryFallback` is true and
 * the storefront still mirrors that category's tree until items are added.
 */
export async function loadAdminHeaderFromDb(
  db: Database
): Promise<HeaderAdminCollection[]> {
  const [nodes, categoryRows] = await Promise.all([
    db
      .select()
      .from(headerMenuNodes)
      .orderBy(asc(headerMenuNodes.position), asc(headerMenuNodes.id)),
    db
      .select()
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.name)),
  ]);

  const topLevelNodes = sortByPosition(
    nodes.filter((node) => node.parentId === null)
  );
  const categoriesById = new Map(categoryRows.map((row) => [row.id, row]));
  const nodeChildrenByParent = groupNodesByParent(nodes);

  return topLevelNodes.map((col) => {
    const resolved = resolveNode(col, categoriesById);
    const explicitItems = sortByPosition(
      nodeChildrenByParent.get(col.id) ?? []
    );

    return {
      id: col.id,
      categoryId: resolved.category?.id ?? col.categoryId,
      name: resolved.name,
      slug: resolved.slug,
      href: resolved.href,
      position: col.position,
      isVisible: col.isVisible,
      usesCategoryFallback: explicitItems.length === 0 && !!resolved.category,
      createdAt: col.createdAt,
      updatedAt: col.updatedAt,
      items: explicitItems.map((item) =>
        serializeAdminNodeItem(item, categoriesById, nodeChildrenByParent, 1)
      ),
    };
  });
}

/**
 * Walk ancestors of a menu node and return depth under the root tab
 * (1 for direct child of root, 2 for grandchild, …).
 * Returns null if the node chain is broken.
 */
export function getNodeDepthFromMap(
  nodeId: string,
  nodesById: Map<string, Pick<HeaderMenuNode, 'id' | 'parentId'>>
): number | null {
  let depth = 0;
  let currentId: string | null = nodeId;
  const seen = new Set<string>();

  while (currentId) {
    if (seen.has(currentId)) return null;
    seen.add(currentId);
    const node = nodesById.get(currentId);
    if (!node) return null;
    if (node.parentId === null) return depth;
    depth += 1;
    if (depth > 20) return null;
    currentId = node.parentId;
  }

  return null;
}

/**
 * Resolve href for public payloads.
 * - string → trimmed
 * - null → keep null (explicit grouping-only node)
 * - undefined / missing (legacy KV) → backfill from slug
 */
function coalesceHref(
  href: string | null | undefined,
  slug: string | null | undefined
): string | null {
  if (typeof href === 'string') {
    const trimmed = href.trim();
    return trimmed || null;
  }
  if (href === null) return null;
  if (typeof slug === 'string' && slug.trim()) {
    return categoryHref(slug);
  }
  return null;
}

/**
 * Ensure every public node has a consistent shape (backfills older KV payloads
 * that only stored slug before href was part of the public contract).
 */
function ensurePublicHref(
  item: HeaderNavItem & { href?: string | null }
): HeaderNavItem {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    href: coalesceHref(item.href, item.slug),
    position: typeof item.position === 'number' ? item.position : 0,
    featured: Boolean(item.featured),
    children: Array.isArray(item.children)
      ? item.children.map((child) => ensurePublicHref(child))
      : [],
  };
}

function normalizePublicPayload(raw: HeaderNavPayload): HeaderNavPayload {
  const collections = Array.isArray(raw.collections)
    ? raw.collections
        .filter(
          (collection): collection is HeaderNavCollection =>
            !!collection &&
            typeof collection === 'object' &&
            typeof collection.id === 'string' &&
            typeof collection.name === 'string' &&
            typeof collection.slug === 'string'
        )
        .map((collection) => ({
          id: collection.id,
          name: collection.name,
          slug: collection.slug,
          href: coalesceHref(collection.href, collection.slug),
          position:
            typeof collection.position === 'number' ? collection.position : 0,
          items: Array.isArray(collection.items)
            ? collection.items.map((item) => ensurePublicHref(item))
            : [],
        }))
        .slice(0, MAX_VISIBLE_HEADER_COLLECTIONS)
    : [];

  return {
    collections,
    updatedAt: raw.updatedAt ?? null,
    cachedAt: raw.cachedAt || new Date().toISOString(),
  };
}

/**
 * Resolve public nav: KV first, then D1. Re-populates KV on miss.
 */
export async function getPublicHeaderNav(
  db: Database,
  kv: KVNamespace
): Promise<{ data: HeaderNavPayload; source: 'kv' | 'db' }> {
  const manager = kvManager(kv);

  try {
    const cached = await manager.getJson<HeaderNavPayload>(HEADER_NAV_KV_KEY);
    if (
      cached &&
      typeof cached === 'object' &&
      Array.isArray(cached.collections)
    ) {
      return { data: normalizePublicPayload(cached), source: 'kv' };
    }
  } catch (error) {
    console.error('Failed to read header nav from KV:', error);
  }

  const data = normalizePublicPayload(await loadPublicHeaderNavFromDb(db));

  try {
    await manager.setJson(HEADER_NAV_KV_KEY, data, {
      expirationTtl: HEADER_NAV_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.error('Failed to write header nav to KV:', error);
  }

  return { data, source: 'db' };
}

/** Drop the public nav cache so the next store request rebuilds from D1. */
export async function invalidateHeaderNavCache(kv: KVNamespace): Promise<void> {
  try {
    await kvManager(kv).delete(HEADER_NAV_KV_KEY);
  } catch (error) {
    console.error('Failed to invalidate header nav KV cache:', error);
  }
}

export function countVisibleCollections(
  collections: Array<Pick<HeaderMenuNode, 'isVisible'>>
): number {
  return collections.filter((c) => c.isVisible).length;
}

function groupNodesByParent(rows: HeaderMenuNode[]) {
  const byParent = new Map<string | null, HeaderMenuNode[]>();
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }
  return byParent;
}
