"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  Download,
  Eye,
  EyeOff,
  FolderTree,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import {
  createCollection,
  createItem,
  deleteCollection,
  deleteItem,
  importCategoryTree,
  invalidateHeaderCache,
  loadCategoryTree,
  loadHeader,
  reorderHeader,
  updateCollection,
  updateItem,
  ApiError,
} from "./api";
import { AddItemDialog, type AddItemTarget } from "./add-item-dialog";
import { AddTabDialog } from "./add-tab-dialog";
import { SortableColumn } from "./sortable-column";
import { SortableTab } from "./sortable-tab";
import type {
  AvailableCategory,
  CategoryNode,
  HeaderAdminCollection,
  HeaderAdminItem,
  HeaderMeta,
} from "./types";
import { dragId, parseDragId } from "./types";
import {
  collectionsToReorderPayload,
  countDescendants,
  itemsToReorderPayload,
  moveItemInCollection,
  normalizeCollections,
  reorderSiblingsInCollection,
} from "./utils";

const measuring = {
  droppable: {
    strategy: MeasuringStrategy.Always,
  },
};

/** Prefer pointer for nested lists; fall back to rect/closest. */
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length > 0) return pointer;
  const rect = rectIntersection(args);
  if (rect.length > 0) return rect;
  return closestCenter(args);
};

function VisibilityBadge({ visible }: { visible: boolean }) {
  return visible ? (
    <Badge variant="secondary" className="gap-1">
      <Eye className="size-3" />
      Visible
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <EyeOff className="size-3" />
      Hidden
    </Badge>
  );
}

type ConfirmState =
  | null
  | {
      kind: "collection" | "item";
      id: string;
      label: string;
      extra?: string;
    };

export function HeaderEditor() {
  const [collections, setCollections] = useState<HeaderAdminCollection[]>([]);
  const [meta, setMeta] = useState<HeaderMeta | null>(null);
  const [availableCategories, setAvailableCategories] = useState<
    AvailableCategory[]
  >([]);
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [addTabOpen, setAddTabOpen] = useState(false);
  const [addItemTarget, setAddItemTarget] = useState<AddItemTarget | null>(
    null
  );
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [activeDrag, setActiveDrag] = useState<{
    kind: "tab" | "column" | "leaf";
    id: string;
    label: string;
  } | null>(null);

  // Snapshot for drag rollback
  const dragSnapshot = useRef<HeaderAdminCollection[] | null>(null);
  const reorderInFlight = useRef(false);

  const canUpdate = meta?.canUpdate ?? false;
  const maxVisible = meta?.maxVisibleCollections ?? 5;
  const maxTotal = meta?.maxTotalCollections ?? 20;
  const maxItems = meta?.maxItemsPerCollection ?? 40;
  const visibleCount = useMemo(
    () => collections.filter((c) => c.isVisible).length,
    [collections]
  );

  const selected = useMemo(
    () => collections.find((c) => c.id === selectedTabId) ?? null,
    [collections, selectedTabId]
  );

  const selectedItemCount = useMemo(
    () => (selected ? countDescendants(selected.items) : 0),
    [selected]
  );

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [headerRes, tree] = await Promise.all([
        loadHeader(),
        loadCategoryTree().catch(() => [] as CategoryNode[]),
      ]);

      const next = normalizeCollections(headerRes.data ?? []);
      setCollections(next);
      setMeta(headerRes.meta);
      setAvailableCategories(headerRes.availableCategories ?? []);
      setCategoryTree(tree);

      setSelectedTabId((prev) => {
        if (prev && next.some((c) => c.id === prev)) return prev;
        return next[0]?.id ?? null;
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load header.";
      setError(message);
      if (!silent) toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const tabIds = useMemo(
    () => collections.map((c) => dragId("tab", c.id)),
    [collections]
  );

  const columnIds = useMemo(
    () => (selected ? selected.items.map((c) => dragId("column", c.id)) : []),
    [selected]
  );

  // ─── Mutations ────────────────────────────────────────────────────────────

  async function handleAddTab(payload: {
    categoryId: string;
    isVisible: boolean;
  }) {
    setBusyKey("tab:new");
    try {
      const res = await createCollection(payload);
      toast.success(res.message || "Tab added.");
      await load(true);
    } catch (err) {
      throw err;
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAddItem(payload: {
    collectionId: string;
    parentId: string;
    mode: "category" | "custom";
    categoryId?: string;
    name?: string;
    href?: string | null;
    isVisible: boolean;
    featured: boolean;
  }) {
    setBusyKey(`item:new:${payload.parentId}`);
    try {
      const body =
        payload.mode === "category"
          ? {
              categoryId: payload.categoryId,
              parentId: payload.parentId,
              isVisible: payload.isVisible,
              featured: payload.featured,
            }
          : {
              name: payload.name,
              href: payload.href,
              parentId: payload.parentId,
              isVisible: payload.isVisible,
              featured: payload.featured,
            };

      const res = await createItem(payload.collectionId, body);
      toast.success(res.message || "Item added.");
      await load(true);
    } catch (err) {
      throw err;
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleCollectionVisible(collection: HeaderAdminCollection) {
    if (!canUpdate) return;
    const next = !collection.isVisible;
    if (next && visibleCount >= maxVisible) {
      toast.error(
        `At most ${maxVisible} tabs can be visible. Hide another first.`
      );
      return;
    }

    setBusyKey(`tab:${collection.id}`);
    // Optimistic
    setCollections((prev) =>
      prev.map((c) =>
        c.id === collection.id ? { ...c, isVisible: next } : c
      )
    );
    try {
      const res = await updateCollection(collection.id, { isVisible: next });
      toast.success(res.message || "Tab updated.");
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update tab.");
      await load(true);
    } finally {
      setBusyKey(null);
    }
  }

  async function patchItem(
    item: HeaderAdminItem,
    patch: { isVisible?: boolean; featured?: boolean }
  ) {
    if (!canUpdate) return;
    setBusyKey(`item:${item.id}`);

    // Optimistic local update
    setCollections((prev) =>
      prev.map((col) => ({
        ...col,
        items: patchTree(col.items, item.id, patch),
      }))
    );

    try {
      const res = await updateItem(item.id, patch);
      toast.success(res.message || "Item updated.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update item."
      );
      await load(true);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleImportTree(collection: HeaderAdminCollection) {
    if (!canUpdate) return;
    if (collection.items.length > 0) {
      toast.error(
        "This tab already has menu items. Clear them first, or add more manually."
      );
      return;
    }
    setBusyKey(`import:${collection.id}`);
    try {
      const res = await importCategoryTree(collection.id);
      toast.success(res.message || "Category tree imported.");
      await load(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to import category tree."
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmDelete() {
    if (!confirm) return;
    const { kind, id, label } = confirm;
    setBusyKey(`delete:${id}`);
    try {
      if (kind === "collection") {
        const res = await deleteCollection(id);
        toast.success(res.message || `"${label}" removed.`);
        if (selectedTabId === id) setSelectedTabId(null);
      } else {
        const res = await deleteItem(id);
        toast.success(res.message || `"${label}" removed.`);
      }
      setConfirm(null);
      await load(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete."
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleInvalidateCache() {
    setBusyKey("cache");
    try {
      const res = await invalidateHeaderCache();
      toast.success(res.message || "Cache invalidated.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to invalidate cache."
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function persistReorder(
    nextCollections: HeaderAdminCollection[],
    options: { collections?: boolean; collectionId?: string }
  ) {
    if (reorderInFlight.current) return;
    reorderInFlight.current = true;
    setBusyKey("reorder");

    try {
      const body: Parameters<typeof reorderHeader>[0] = {};
      if (options.collections) {
        body.collections = collectionsToReorderPayload(nextCollections);
      }
      if (options.collectionId) {
        const col = nextCollections.find((c) => c.id === options.collectionId);
        if (col) body.items = itemsToReorderPayload(col);
      }

      if (!body.collections && !body.items) return;

      const res = await reorderHeader(body);
      if (res.data) {
        setCollections(normalizeCollections(res.data));
      } else {
        await load(true);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save order."
      );
      // Rollback
      if (dragSnapshot.current) {
        setCollections(dragSnapshot.current);
      } else {
        await load(true);
      }
    } finally {
      reorderInFlight.current = false;
      setBusyKey(null);
      dragSnapshot.current = null;
    }
  }

  // ─── Drag handlers ────────────────────────────────────────────────────────

  function onDragStart(event: DragStartEvent) {
    if (!canUpdate) return;
    dragSnapshot.current = collections;
    const parsed = parseDragId(String(event.active.id));
    if (!parsed) return;

    let label = parsed.id;
    if (parsed.kind === "tab") {
      label =
        collections.find((c) => c.id === parsed.id)?.name ?? parsed.id;
    } else {
      for (const col of collections) {
        const found = findInItems(col.items, parsed.id);
        if (found) {
          label = found.name;
          break;
        }
      }
    }
    setActiveDrag({ kind: parsed.kind, id: parsed.id, label });
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !canUpdate) return;

    const activeParsed = parseDragId(String(active.id));
    const overParsed = parseDragId(String(over.id));
    if (!activeParsed || !overParsed) return;

    // Only live-move leaves across columns during drag-over for smooth UX.
    if (activeParsed.kind !== "leaf") return;
    if (overParsed.kind !== "leaf" && overParsed.kind !== "column") return;
    if (!selectedTabId) return;

    setCollections((prev) => {
      const colIndex = prev.findIndex((c) => c.id === selectedTabId);
      if (colIndex < 0) return prev;
      const collection = prev[colIndex]!;

      const activeLoc = locate(collection, activeParsed.id);
      if (!activeLoc) return prev;

      let newParentId: string;
      let newIndex: number;

      if (overParsed.kind === "column") {
        newParentId = overParsed.id;
        const targetCol = collection.items.find((c) => c.id === overParsed.id);
        newIndex = targetCol?.children.length ?? 0;
      } else {
        const overLoc = locate(collection, overParsed.id);
        if (!overLoc) return prev;
        newParentId = overLoc.parentId;
        newIndex = overLoc.index;
      }

      // Same container — let sortable handle visual order; skip tree rewrite
      // until drag end if parent unchanged (avoids fighting dnd-kit).
      if (activeLoc.parentId === newParentId) return prev;

      const moved = moveItemInCollection(
        collection,
        activeParsed.id,
        newParentId,
        newIndex
      );
      if (!moved) return prev;

      const next = [...prev];
      next[colIndex] = moved;
      return next;
    });
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;

    if (!over || !canUpdate) {
      if (dragSnapshot.current) setCollections(dragSnapshot.current);
      dragSnapshot.current = null;
      return;
    }

    const activeParsed = parseDragId(String(active.id));
    const overParsed = parseDragId(String(over.id));
    if (!activeParsed || !overParsed) {
      dragSnapshot.current = null;
      return;
    }

    // ── Tabs ──────────────────────────────────────────────────────────────
    if (activeParsed.kind === "tab" && overParsed.kind === "tab") {
      if (activeParsed.id === overParsed.id) {
        dragSnapshot.current = null;
        return;
      }
      const oldIndex = collections.findIndex((c) => c.id === activeParsed.id);
      const newIndex = collections.findIndex((c) => c.id === overParsed.id);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
        dragSnapshot.current = null;
        return;
      }
      const next = arrayMove(collections, oldIndex, newIndex).map(
        (c, i) => ({ ...c, position: i * 10 })
      );
      setCollections(next);
      void persistReorder(next, { collections: true });
      return;
    }

    // ── Columns (depth-1) ─────────────────────────────────────────────────
    if (activeParsed.kind === "column" && selected) {
      if (overParsed.kind !== "column") {
        dragSnapshot.current = null;
        return;
      }
      if (activeParsed.id === overParsed.id) {
        dragSnapshot.current = null;
        return;
      }
      const oldIndex = selected.items.findIndex(
        (c) => c.id === activeParsed.id
      );
      const newIndex = selected.items.findIndex((c) => c.id === overParsed.id);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
        dragSnapshot.current = null;
        return;
      }

      const reordered = reorderSiblingsInCollection(
        selected,
        selected.id,
        oldIndex,
        newIndex
      );
      if (!reordered) {
        dragSnapshot.current = null;
        return;
      }
      const next = collections.map((c) =>
        c.id === selected.id ? reordered : c
      );
      setCollections(next);
      void persistReorder(next, { collectionId: selected.id });
      return;
    }

    // ── Leaves (depth-2) ──────────────────────────────────────────────────
    if (activeParsed.kind === "leaf" && selected) {
      // Tree may already reflect cross-column move from onDragOver.
      // Finalize same-parent reorders here.
      const current = collections.find((c) => c.id === selected.id) ?? selected;
      const activeLoc = locate(current, activeParsed.id);
      if (!activeLoc) {
        dragSnapshot.current = null;
        return;
      }

      let targetParentId = activeLoc.parentId;
      let targetIndex = activeLoc.index;

      if (overParsed.kind === "leaf") {
        const overLoc = locate(current, overParsed.id);
        if (overLoc) {
          targetParentId = overLoc.parentId;
          targetIndex = overLoc.index;
        }
      } else if (overParsed.kind === "column") {
        targetParentId = overParsed.id;
        const col = current.items.find((c) => c.id === overParsed.id);
        targetIndex = col?.children.length ?? 0;
      }

      let nextCollection = current;
      if (
        activeLoc.parentId !== targetParentId ||
        activeLoc.index !== targetIndex
      ) {
        // If parent already changed via onDragOver, only reorder within new parent.
        if (activeLoc.parentId === targetParentId) {
          const reordered = reorderSiblingsInCollection(
            current,
            targetParentId,
            activeLoc.index,
            targetIndex
          );
          if (reordered) nextCollection = reordered;
        } else {
          const moved = moveItemInCollection(
            current,
            activeParsed.id,
            targetParentId,
            targetIndex
          );
          if (moved) nextCollection = moved;
        }
      }

      const next = collections.map((c) =>
        c.id === selected.id ? nextCollection : c
      );
      setCollections(next);
      void persistReorder(next, { collectionId: selected.id });
      return;
    }

    dragSnapshot.current = null;
  }

  function onDragCancel() {
    setActiveDrag(null);
    if (dragSnapshot.current) {
      setCollections(dragSnapshot.current);
      dragSnapshot.current = null;
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading header editor…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <ShieldAlert className="size-8 text-destructive" />
          <div>
            <p className="font-medium">Could not load header</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isBusy = busyKey !== null;

  return (
    <div className="flex flex-col gap-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {visibleCount}/{maxVisible} visible tabs
            </Badge>
            <Badge variant="outline">
              {collections.length}/{maxTotal} total
            </Badge>
            <Badge variant="outline">{meta?.currentUserRole ?? "admin"}</Badge>
            {selected && (
              <Badge variant="outline">
                {selectedItemCount}/{maxItems} items in tab
              </Badge>
            )}
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Build the storefront mega menu: drag tabs, columns, and links like
            Discord roles. Tabs are root categories; columns are subcategories;
            links are sub-subcategories with slugs used on the storefront.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
            disabled={isBusy || refreshing}
            className="gap-1.5"
          >
            <RefreshCw
              className={cn("size-3.5", refreshing && "animate-spin")}
            />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleInvalidateCache()}
            disabled={!canUpdate || busyKey === "cache"}
            className="gap-1.5"
          >
            <Sparkles className="size-3.5" />
            Invalidate cache
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!canUpdate || collections.length >= maxTotal}
            onClick={() => setAddTabOpen(true)}
          >
            <Plus className="size-3.5" />
            Add tab
          </Button>
        </div>
      </div>

      {!canUpdate && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            You can view the header, but updating it requires the{" "}
            <code className="rounded bg-muted px-1 text-xs">header:update</code>{" "}
            permission or owner role.
          </p>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={measuring}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {/* ── Storefront-style tab bar ──────────────────────────────────── */}
        <Card className="overflow-hidden border-border/80 py-0">
          <div className="flex items-stretch border-b bg-card">
            <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
              {collections.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">
                  No header tabs yet. Add a root category to get started.
                </p>
              ) : (
                <SortableContext
                  items={tabIds}
                  strategy={horizontalListSortingStrategy}
                >
                  <div className="flex items-stretch">
                    {collections.map((collection) => (
                      <SortableTab
                        key={collection.id}
                        collection={collection}
                        active={collection.id === selectedTabId}
                        canUpdate={canUpdate}
                        busy={isBusy}
                        onSelect={setSelectedTabId}
                      />
                    ))}
                  </div>
                </SortableContext>
              )}
            </div>
            {canUpdate && (
              <div className="flex shrink-0 items-center border-l px-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={collections.length >= maxTotal}
                  onClick={() => setAddTabOpen(true)}
                  aria-label="Add tab"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Hint row */}
          <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground">
            <GripVertical className="size-3" />
            Drag tabs to reorder · Click a tab to edit its mega menu columns
          </div>

          {/* ── Mega menu panel ─────────────────────────────────────────── */}
          <CardContent className="p-0">
            {!selected ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <FolderTree className="size-10 text-muted-foreground/50" />
                <p className="font-medium">No tab selected</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Add a root category as a tab, then build subcategory columns
                  and nested links — the same structure the storefront navbar
                  renders.
                </p>
                {canUpdate && (
                  <Button
                    size="sm"
                    className="mt-2 gap-1.5"
                    onClick={() => setAddTabOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    Add first tab
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-4 p-4">
                {/* Tab meta bar */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold tracking-tight">
                        {selected.name}
                      </h2>
                      <VisibilityBadge visible={selected.isVisible} />
                      {selected.usesCategoryFallback && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-amber-500/30 text-amber-700 dark:text-amber-300"
                        >
                          <FolderTree className="size-3" />
                          Category fallback
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Slug{" "}
                      <code className="rounded bg-muted px-1">
                        /{selected.slug}
                      </code>
                      {selected.href && (
                        <>
                          {" · "}
                          <code className="rounded bg-muted px-1">
                            {selected.href}
                          </code>
                        </>
                      )}
                    </p>
                    {selected.usesCategoryFallback && (
                      <p className="max-w-xl text-xs text-amber-700 dark:text-amber-300">
                        This tab has no explicit menu items yet, so the
                        storefront mirrors the linked category tree. Import
                        children or add columns to take full control.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={!canUpdate || isBusy}
                      onClick={() => void toggleCollectionVisible(selected)}
                    >
                      {selected.isVisible ? (
                        <EyeOff className="size-3.5" />
                      ) : (
                        <Eye className="size-3.5" />
                      )}
                      {selected.isVisible ? "Hide tab" : "Show tab"}
                    </Button>
                    {selected.usesCategoryFallback && canUpdate && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={isBusy || busyKey === `import:${selected.id}`}
                        onClick={() => void handleImportTree(selected)}
                      >
                        {busyKey === `import:${selected.id}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Download className="size-3.5" />
                        )}
                        Import category tree
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1.5"
                      disabled={!canUpdate || isBusy}
                      onClick={() =>
                        setConfirm({
                          kind: "collection",
                          id: selected.id,
                          label: selected.name,
                          extra:
                            "All nested columns and links under this tab will be deleted.",
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                      Remove tab
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Columns grid — matches mega menu layout */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Mega menu columns
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Drag columns horizontally · drag links within or across
                        columns
                      </p>
                    </div>
                    {canUpdate && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={
                          isBusy || selectedItemCount >= maxItems
                        }
                        onClick={() =>
                          setAddItemTarget({
                            kind: "column",
                            collection: selected,
                          })
                        }
                      >
                        <Plus className="size-3.5" />
                        Add column
                      </Button>
                    )}
                  </div>

                  {selected.items.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-muted/20 px-6 py-12 text-center">
                      <p className="text-sm font-medium">No columns yet</p>
                      <p className="max-w-md text-xs text-muted-foreground">
                        Add subcategory columns (pink headers) then nest links
                        under them — just like the storefront mega menu.
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {canUpdate && selected.usesCategoryFallback && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={isBusy}
                            onClick={() => void handleImportTree(selected)}
                          >
                            <Download className="size-3.5" />
                            Import from category
                          </Button>
                        )}
                        {canUpdate && (
                          <Button
                            size="sm"
                            className="gap-1.5"
                            disabled={isBusy}
                            onClick={() =>
                              setAddItemTarget({
                                kind: "column",
                                collection: selected,
                              })
                            }
                          >
                            <Plus className="size-3.5" />
                            Add column
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <SortableContext items={columnIds}>
                      <div className="flex gap-3 overflow-x-auto pb-2">
                        {selected.items.map((column) => (
                          <SortableColumn
                            key={column.id}
                            column={column}
                            canUpdate={canUpdate}
                            busy={isBusy}
                            onAddLeaf={(col) =>
                              setAddItemTarget({
                                kind: "leaf",
                                collection: selected,
                                parent: col,
                              })
                            }
                            onToggleColumnVisible={(col) =>
                              void patchItem(col, {
                                isVisible: !col.isVisible,
                              })
                            }
                            onDeleteColumn={(col) =>
                              setConfirm({
                                kind: "item",
                                id: col.id,
                                label: col.name,
                                extra:
                                  col.children.length > 0
                                    ? `Also deletes ${col.children.length} nested link${col.children.length === 1 ? "" : "s"}.`
                                    : undefined,
                              })
                            }
                            onToggleLeafVisible={(item) =>
                              void patchItem(item, {
                                isVisible: !item.isVisible,
                              })
                            }
                            onToggleLeafFeatured={(item) =>
                              void patchItem(item, {
                                featured: !item.featured,
                              })
                            }
                            onDeleteLeaf={(item) =>
                              setConfirm({
                                kind: "item",
                                id: item.id,
                                label: item.name,
                              })
                            }
                          />
                        ))}

                        {canUpdate && (
                          <button
                            type="button"
                            disabled={isBusy || selectedItemCount >= maxItems}
                            onClick={() =>
                              setAddItemTarget({
                                kind: "column",
                                collection: selected,
                              })
                            }
                            className="flex min-w-[10rem] max-w-[12rem] flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-muted/10 px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                          >
                            <Plus className="size-5" />
                            Add column
                          </button>
                        )}
                      </div>
                    </SortableContext>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            <div
              className={cn(
                "rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-xl ring-2 ring-primary/30",
                activeDrag.kind === "tab" && "uppercase tracking-wide",
                activeDrag.kind === "column" &&
                  "font-semibold text-pink-600 dark:text-pink-400"
              )}
            >
              <span className="flex items-center gap-2">
                <GripVertical className="size-3.5 text-muted-foreground" />
                {activeDrag.label}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Dialogs */}
      <AddTabDialog
        open={addTabOpen}
        onOpenChange={setAddTabOpen}
        availableCategories={availableCategories}
        canUpdate={canUpdate}
        maxVisible={maxVisible}
        visibleCount={visibleCount}
        totalCount={collections.length}
        maxTotal={maxTotal}
        busy={busyKey === "tab:new"}
        onSubmit={handleAddTab}
      />

      <AddItemDialog
        open={addItemTarget !== null}
        onOpenChange={(open) => {
          if (!open) setAddItemTarget(null);
        }}
        target={addItemTarget}
        categoryTree={categoryTree}
        canUpdate={canUpdate}
        busy={
          addItemTarget
            ? busyKey ===
              `item:new:${
                addItemTarget.kind === "column"
                  ? addItemTarget.collection.id
                  : addItemTarget.parent.id
              }`
            : false
        }
        maxItems={maxItems}
        currentItemCount={selectedItemCount}
        onSubmit={handleAddItem}
      />

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && busyKey?.startsWith("delete:")) return;
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "collection"
                ? "Remove header tab?"
                : "Delete menu item?"}
            </DialogTitle>
            <DialogDescription>
              {confirm ? (
                <>
                  This will permanently remove{" "}
                  <strong>{confirm.label}</strong>
                  {confirm.extra ? `. ${confirm.extra}` : "."} This cannot be
                  undone.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busyKey?.startsWith("delete:")}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busyKey?.startsWith("delete:")}
              onClick={() => void confirmDelete()}
              className="gap-1.5"
            >
              {busyKey?.startsWith("delete:") ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Local helpers ────────────────────────────────────────────────────────────

function patchTree(
  items: HeaderAdminItem[],
  id: string,
  patch: Partial<HeaderAdminItem>
): HeaderAdminItem[] {
  return items.map((item) => {
    if (item.id === id) return { ...item, ...patch };
    return { ...item, children: patchTree(item.children, id, patch) };
  });
}

function findInItems(
  items: HeaderAdminItem[],
  id: string
): HeaderAdminItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    const nested = findInItems(item.children, id);
    if (nested) return nested;
  }
  return null;
}

function locate(
  collection: HeaderAdminCollection,
  itemId: string
): { parentId: string; index: number } | null {
  const atRoot = collection.items.findIndex((i) => i.id === itemId);
  if (atRoot >= 0) return { parentId: collection.id, index: atRoot };

  for (const col of collection.items) {
    const idx = col.children.findIndex((c) => c.id === itemId);
    if (idx >= 0) return { parentId: col.id, index: idx };
  }
  return null;
}

// Silence unused import if tree-shaken oddly
void ApiError;
