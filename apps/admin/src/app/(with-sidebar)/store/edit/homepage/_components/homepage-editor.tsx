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
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
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
import { cn } from "@/lib/utils";

import { AddBlockDialog } from "./add-block-dialog";
import {
  createBlock,
  deleteBlock,
  invalidateHomepageCache,
  loadCategoryTree,
  loadHomepage,
  reorderHomepage,
  updateBlock,
} from "./api";
import { BlockConfigDialog } from "./block-config-dialog";
import { SortableBlock } from "./sortable-block";
import type {
  AvailableCategory,
  CategoryNode,
  HomepageAdminBlock,
  HomepageBlockConfig,
  HomepageBlockType,
  HomepageMeta,
} from "./types";
import { BLOCK_TYPE_LABELS, dragId, parseDragId } from "./types";
import { feedIsLast, normalizeBlocks, withPositions } from "./utils";

const measuring = {
  droppable: {
    strategy: MeasuringStrategy.Always,
  },
};

const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length > 0) return pointer;
  const rect = rectIntersection(args);
  if (rect.length > 0) return rect;
  return closestCenter(args);
};

export function HomepageEditor() {
  const [blocks, setBlocks] = useState<HomepageAdminBlock[]>([]);
  const [meta, setMeta] = useState<HomepageMeta | null>(null);
  const [availableCategories, setAvailableCategories] = useState<
    AvailableCategory[]
  >([]);
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<{
    id: string;
    label: string;
  } | null>(null);

  const dragSnapshot = useRef<HomepageAdminBlock[] | null>(null);
  const reorderInFlight = useRef(false);

  const canUpdate = meta?.canUpdate ?? false;
  const maxBlocks = meta?.maxBlocks ?? 40;
  const visibleCount = useMemo(
    () => blocks.filter((b) => b.isVisible).length,
    [blocks]
  );
  const feedExists = useMemo(
    () => blocks.some((b) => b.blockType === "product_feed"),
    [blocks]
  );
  const editing = useMemo(
    () => blocks.find((b) => b.id === editingId) ?? null,
    [blocks, editingId]
  );
  const confirmBlock = useMemo(
    () => blocks.find((b) => b.id === confirmId) ?? null,
    [blocks, confirmId]
  );

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [homepageRes, tree] = await Promise.all([
        loadHomepage(),
        loadCategoryTree().catch(() => [] as CategoryNode[]),
      ]);
      setBlocks(normalizeBlocks(homepageRes.data ?? []));
      setMeta(homepageRes.meta);
      setAvailableCategories(homepageRes.availableCategories ?? []);
      setCategoryTree(tree);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load homepage.";
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

  const itemIds = useMemo(
    () => blocks.map((b) => dragId("block", b.id)),
    [blocks]
  );

  async function handleAdd(blockType: HomepageBlockType) {
    setBusyKey("block:new");
    try {
      const res = await createBlock({ blockType });
      toast.success(res.message || "Block added.");
      await load(true);
    } catch (err) {
      throw err;
    } finally {
      setBusyKey(null);
    }
  }

  async function handleToggleVisible(id: string) {
    if (!canUpdate) return;
    const current = blocks.find((b) => b.id === id);
    if (!current) return;
    const next = !current.isVisible;
    setBusyKey(`vis:${id}`);
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, isVisible: next } : b))
    );
    try {
      const res = await updateBlock(id, { isVisible: next });
      toast.success(res.message || "Visibility updated.");
      if (res.data) {
        setBlocks((prev) =>
          prev.map((b) => (b.id === id ? { ...b, ...res.data } : b))
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update visibility."
      );
      await load(true);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSaveConfig(id: string, config: HomepageBlockConfig) {
    setBusyKey(`edit:${id}`);
    try {
      const res = await updateBlock(id, { config });
      toast.success(res.message || "Block updated.");
      await load(true);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDelete() {
    if (!confirmBlock) return;
    const id = confirmBlock.id;
    setBusyKey(`delete:${id}`);
    try {
      const res = await deleteBlock(id);
      toast.success(res.message || "Block deleted.");
      setConfirmId(null);
      if (editingId === id) setEditingId(null);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleInvalidateCache() {
    setBusyKey("cache");
    try {
      const res = await invalidateHomepageCache();
      toast.success(res.message || "Cache invalidated.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to invalidate cache."
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function persistReorder(nextBlocks: HomepageAdminBlock[]) {
    if (reorderInFlight.current) return;
    if (!feedIsLast(nextBlocks)) {
      toast.error("The product feed must stay last.");
      if (dragSnapshot.current) setBlocks(dragSnapshot.current);
      dragSnapshot.current = null;
      return;
    }
    reorderInFlight.current = true;
    setBusyKey("reorder");
    try {
      const res = await reorderHomepage({
        orderedIds: nextBlocks.map((b) => b.id),
      });
      if (res.data) {
        setBlocks(normalizeBlocks(res.data));
      } else {
        await load(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save order.");
      if (dragSnapshot.current) {
        setBlocks(dragSnapshot.current);
      } else {
        await load(true);
      }
    } finally {
      reorderInFlight.current = false;
      setBusyKey(null);
      dragSnapshot.current = null;
    }
  }

  function onDragStart(event: DragStartEvent) {
    if (!canUpdate) return;
    dragSnapshot.current = blocks;
    const parsed = parseDragId(String(event.active.id));
    if (!parsed) return;
    const block = blocks.find((b) => b.id === parsed.id);
    setActiveDrag({
      id: parsed.id,
      label: block ? BLOCK_TYPE_LABELS[block.blockType] : parsed.id,
    });
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over || !canUpdate) {
      if (dragSnapshot.current) setBlocks(dragSnapshot.current);
      dragSnapshot.current = null;
      return;
    }
    const activeParsed = parseDragId(String(active.id));
    const overParsed = parseDragId(String(over.id));
    if (!activeParsed || !overParsed) {
      dragSnapshot.current = null;
      return;
    }
    if (activeParsed.id === overParsed.id) {
      dragSnapshot.current = null;
      return;
    }
    const oldIndex = blocks.findIndex((b) => b.id === activeParsed.id);
    const newIndex = blocks.findIndex((b) => b.id === overParsed.id);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
      dragSnapshot.current = null;
      return;
    }
    const next = withPositions(arrayMove(blocks, oldIndex, newIndex));
    setBlocks(next);
    void persistReorder(next);
  }

  function onDragCancel() {
    setActiveDrag(null);
    if (dragSnapshot.current) {
      setBlocks(dragSnapshot.current);
      dragSnapshot.current = null;
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading homepage editor…
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
            <p className="font-medium">Could not load homepage</p>
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {visibleCount}/{blocks.length} visible
            </Badge>
            <Badge variant="outline">
              {blocks.length}/{maxBlocks} total
            </Badge>
            <Badge variant="outline">{meta?.currentUserRole ?? "admin"}</Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Drag sections to reorder them like Shopify homepage blocks. The
            product feed, if present, must stay last.
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
            disabled={!canUpdate || blocks.length >= maxBlocks}
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-3.5" />
            Add block
          </Button>
        </div>
      </div>

      {!canUpdate && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            You can view the homepage, but updating it requires the{" "}
            <code className="rounded bg-muted px-1 text-xs">
              homepage:update
            </code>{" "}
            permission or owner role.
          </p>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={measuring}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <Card className="overflow-hidden py-0">
          {blocks.length === 0 ? (
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No homepage blocks yet. Add a promo slider, product grid, or
              category CTA to get started.
            </CardContent>
          ) : (
            <SortableContext
              items={itemIds}
              strategy={verticalListSortingStrategy}
            >
              {blocks.map((block) => (
                <SortableBlock
                  key={block.id}
                  block={block}
                  canUpdate={canUpdate}
                  busy={isBusy}
                  onEdit={setEditingId}
                  onDelete={setConfirmId}
                  onToggleVisible={handleToggleVisible}
                />
              ))}
            </SortableContext>
          )}
        </Card>

        <DragOverlay>
          {activeDrag ? (
            <div className="rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-xl ring-2 ring-primary/30">
              <span className="flex items-center gap-2">
                <GripVertical className="size-3.5 text-muted-foreground" />
                {activeDrag.label}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <AddBlockDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        canUpdate={canUpdate}
        busy={busyKey === "block:new"}
        feedExists={feedExists}
        atMax={blocks.length >= maxBlocks}
        onSubmit={handleAdd}
      />

      <BlockConfigDialog
        block={editing}
        open={editingId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingId(null);
        }}
        canUpdate={canUpdate}
        busy={editingId ? busyKey === `edit:${editingId}` : false}
        meta={meta}
        categoryTree={
          categoryTree.length > 0
            ? categoryTree
            : availableCategories.map((c) => ({
                id: c.id,
                slug: c.slug,
                name: c.name,
                description: null,
                image: c.image,
                parentId: c.parentId,
                position: c.position,
                depth: 0,
                children: [],
              }))
        }
        onSave={handleSaveConfig}
      />

      <Dialog
        open={confirmId !== null}
        onOpenChange={(open) => {
          if (!open && busyKey?.startsWith("delete:")) return;
          if (!open) setConfirmId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete homepage block?</DialogTitle>
            <DialogDescription>
              {confirmBlock ? (
                <>
                  This will permanently remove the{" "}
                  <strong>{BLOCK_TYPE_LABELS[confirmBlock.blockType]}</strong>{" "}
                  block. This cannot be undone.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busyKey?.startsWith("delete:")}
              onClick={() => setConfirmId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busyKey?.startsWith("delete:")}
              onClick={() => void handleDelete()}
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
