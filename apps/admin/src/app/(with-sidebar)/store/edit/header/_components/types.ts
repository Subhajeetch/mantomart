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
  createdAt: string | Date | number | null;
  updatedAt: string | Date | number | null;
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
  usesCategoryFallback: boolean;
  createdAt: string | Date | number | null;
  updatedAt: string | Date | number | null;
  items: HeaderAdminItem[];
};

export type HeaderMeta = {
  totalCollections: number;
  visibleCollections: number;
  maxVisibleCollections: number;
  maxTotalCollections: number;
  maxItemsPerCollection: number;
  maxItemDepth: number;
  currentUserId?: string;
  currentUserRole: string;
  canUpdate: boolean;
};

export type AvailableCategory = {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  position: number;
  childCount: number;
};

export type CategoryNode = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  parentId: string | null;
  position: number;
  depth: number;
  children: CategoryNode[];
};

export type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

export type ReorderItemPayload = {
  id: string;
  position: number;
  parentId?: string;
};

export type ReorderCollectionPayload = {
  id: string;
  position: number;
};

/**
 * Drag identity prefixes so tabs / columns / leaves / drop zones never collide.
 * - tab: top-level navbar tab
 * - column: depth-1 subcategory (mega-menu column header)
 * - leaf: depth-2 link under a column
 * - colzone: empty droppable body of a column (for dropping leaves into empty cols)
 */
export type DragKind = "tab" | "column" | "leaf" | "colzone";

export function dragId(kind: DragKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseDragId(
  value: string | null | undefined
): { kind: DragKind; id: string } | null {
  if (!value) return null;
  const sep = value.indexOf(":");
  if (sep <= 0) return null;
  const kind = value.slice(0, sep) as DragKind;
  const id = value.slice(sep + 1);
  if (
    !id ||
    (kind !== "tab" &&
      kind !== "column" &&
      kind !== "leaf" &&
      kind !== "colzone")
  ) {
    return null;
  }
  return { kind, id };
}
