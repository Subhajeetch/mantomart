import type {
  CategoryNode,
  HeaderAdminCollection,
  HeaderAdminItem,
  ReorderCollectionPayload,
  ReorderItemPayload,
} from "./types";

export function normalizeItem(item: HeaderAdminItem): HeaderAdminItem {
  return {
    ...item,
    children: Array.isArray(item.children)
      ? item.children.map(normalizeItem)
      : [],
  };
}

export function normalizeCollections(
  collections: HeaderAdminCollection[]
): HeaderAdminCollection[] {
  return collections.map((collection) => ({
    ...collection,
    items: (collection.items ?? []).map(normalizeItem),
  }));
}

export function countDescendants(items: HeaderAdminItem[]): number {
  let total = 0;
  for (const item of items) {
    total += 1;
    total += countDescendants(item.children);
  }
  return total;
}

export function findItemInTree(
  items: HeaderAdminItem[],
  id: string
): HeaderAdminItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    const nested = findItemInTree(item.children, id);
    if (nested) return nested;
  }
  return null;
}

export function findParentOfItem(
  items: HeaderAdminItem[],
  id: string,
  parent: HeaderAdminItem | null = null
): HeaderAdminItem | null | undefined {
  for (const item of items) {
    if (item.id === id) return parent;
    const nested = findParentOfItem(item.children, id, item);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** Locate an item and its sibling list + index within a collection. */
export function locateItem(
  collection: HeaderAdminCollection,
  itemId: string
): {
  item: HeaderAdminItem;
  siblings: HeaderAdminItem[];
  index: number;
  parentId: string;
  parent: HeaderAdminItem | null;
} | null {
  const walk = (
    siblings: HeaderAdminItem[],
    parentId: string,
    parent: HeaderAdminItem | null
  ): ReturnType<typeof locateItem> => {
    for (let i = 0; i < siblings.length; i++) {
      const item = siblings[i]!;
      if (item.id === itemId) {
        return { item, siblings, index: i, parentId, parent };
      }
      const nested = walk(item.children, item.id, item);
      if (nested) return nested;
    }
    return null;
  };

  return walk(collection.items, collection.id, null);
}

export function reorderList<T>(list: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return list;
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (!moved) return list;
  next.splice(to, 0, moved);
  return next;
}

export function withPositions<T extends { position: number }>(
  list: T[],
  step = 10
): T[] {
  return list.map((entry, index) => ({ ...entry, position: index * step }));
}

export function collectionsToReorderPayload(
  collections: HeaderAdminCollection[]
): ReorderCollectionPayload[] {
  return collections.map((collection, index) => ({
    id: collection.id,
    position: index * 10,
  }));
}

/**
 * Build a flat reorder payload for every item under a collection after a
 * local tree mutation (same parent positions + optional parent changes).
 */
export function itemsToReorderPayload(
  collection: HeaderAdminCollection
): ReorderItemPayload[] {
  const payload: ReorderItemPayload[] = [];

  const walk = (items: HeaderAdminItem[], parentId: string) => {
    items.forEach((item, index) => {
      payload.push({
        id: item.id,
        position: index * 10,
        parentId,
      });
      walk(item.children, item.id);
    });
  };

  walk(collection.items, collection.id);
  return payload;
}

export function moveItemInCollection(
  collection: HeaderAdminCollection,
  itemId: string,
  newParentId: string,
  newIndex: number
): HeaderAdminCollection | null {
  const located = locateItem(collection, itemId);
  if (!located) return null;

  // Prevent moving under itself or a descendant.
  if (itemId === newParentId) return null;
  if (findItemInTree(located.item.children, newParentId)) return null;

  // Depth rules: max depth under tab is 2.
  // newParentId === collection.id → depth 1
  // newParentId is a depth-1 item → depth 2
  // newParentId is a depth-2 item → invalid
  let newDepth = 1;
  if (newParentId !== collection.id) {
    const parent = findItemInTree(collection.items, newParentId);
    if (!parent) return null;
    if (parent.depth >= 2) return null;
    newDepth = parent.depth + 1;
  }

  // Cannot move a parent with children to deepest level.
  if (newDepth >= 2 && located.item.children.length > 0) return null;

  // Remove from old siblings.
  const strip = (
    items: HeaderAdminItem[]
  ): { items: HeaderAdminItem[]; removed: HeaderAdminItem | null } => {
    const result: HeaderAdminItem[] = [];
    let removed: HeaderAdminItem | null = null;
    for (const item of items) {
      if (item.id === itemId) {
        removed = item;
        continue;
      }
      const child = strip(item.children);
      result.push({ ...item, children: child.items });
      if (child.removed) removed = child.removed;
    }
    return { items: result, removed };
  };

  const stripped = strip(collection.items);
  if (!stripped.removed) return null;

  const moved: HeaderAdminItem = {
    ...stripped.removed,
    parentId: newParentId,
    depth: newDepth,
  };

  const insert = (items: HeaderAdminItem[], parentId: string): HeaderAdminItem[] => {
    if (parentId === collection.id) {
      const next = [...items];
      const idx = Math.max(0, Math.min(newIndex, next.length));
      next.splice(idx, 0, moved);
      return withPositions(next);
    }
    return items.map((item) => {
      if (item.id === parentId) {
        const kids = [...item.children];
        const idx = Math.max(0, Math.min(newIndex, kids.length));
        kids.splice(idx, 0, moved);
        return { ...item, children: withPositions(kids) };
      }
      return { ...item, children: insert(item.children, parentId) };
    });
  };

  return {
    ...collection,
    items: withPositions(insert(stripped.items, newParentId)),
    usesCategoryFallback: false,
  };
}

export function reorderSiblingsInCollection(
  collection: HeaderAdminCollection,
  parentId: string,
  fromIndex: number,
  toIndex: number
): HeaderAdminCollection | null {
  if (parentId === collection.id) {
    return {
      ...collection,
      items: withPositions(reorderList(collection.items, fromIndex, toIndex)),
    };
  }

  const apply = (items: HeaderAdminItem[]): HeaderAdminItem[] =>
    items.map((item) => {
      if (item.id === parentId) {
        return {
          ...item,
          children: withPositions(
            reorderList(item.children, fromIndex, toIndex)
          ),
        };
      }
      return { ...item, children: apply(item.children) };
    });

  return { ...collection, items: apply(collection.items) };
}

export function findCategoryNode(
  tree: CategoryNode[],
  id: string
): CategoryNode | null {
  for (const node of tree) {
    if (node.id === id) return node;
    const nested = findCategoryNode(node.children, id);
    if (nested) return nested;
  }
  return null;
}

/** Flatten category tree for selects (with indentation labels). */
export function flattenCategories(
  tree: CategoryNode[],
  options?: {
    rootId?: string | null;
    maxDepth?: number;
    excludeIds?: Set<string>;
  }
): Array<{ id: string; name: string; slug: string; depth: number; label: string }> {
  const result: Array<{
    id: string;
    name: string;
    slug: string;
    depth: number;
    label: string;
  }> = [];
  const maxDepth = options?.maxDepth ?? 99;
  const exclude = options?.excludeIds ?? new Set<string>();

  const startNodes = options?.rootId
    ? (() => {
        const root = findCategoryNode(tree, options.rootId!);
        return root?.children ?? [];
      })()
    : tree;

  const walk = (nodes: CategoryNode[], depth: number) => {
    if (depth > maxDepth) return;
    for (const node of nodes) {
      if (!exclude.has(node.id)) {
        result.push({
          id: node.id,
          name: node.name,
          slug: node.slug,
          depth,
          label: `${"— ".repeat(Math.max(0, depth))}${node.name}`,
        });
      }
      walk(node.children, depth + 1);
    }
  };

  walk(startNodes, 0);
  return result;
}

export function usedCategoryIdsInCollection(
  collection: HeaderAdminCollection
): Set<string> {
  const used = new Set<string>();
  if (collection.categoryId) used.add(collection.categoryId);

  const walk = (items: HeaderAdminItem[]) => {
    for (const item of items) {
      if (item.categoryId) used.add(item.categoryId);
      walk(item.children);
    }
  };
  walk(collection.items);
  return used;
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 100);
}
