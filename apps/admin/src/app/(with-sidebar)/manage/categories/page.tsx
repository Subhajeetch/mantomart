'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import {
  FolderTree,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

import {
  CategoryFormDialog,
  type CategoryFormValues,
} from './components/category-form-dialog';
import {
  DeleteCategoryDialog,
  type DeleteDialogState,
} from './components/delete-category-dialog';
import {
  CategoryTreeItem,
  CategoryTreeSkeleton,
} from './components/category-tree-item';
import {
  ApiError,
  countNodes,
  requestJson,
  reorderSiblingsInTree,
  type CategoryNode,
  type TreeMeta,
} from './utils';

function filterTree(nodes: CategoryNode[], query: string): CategoryNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  function walk(list: CategoryNode[]): CategoryNode[] {
    const result: CategoryNode[] = [];
    for (const node of list) {
      const children = walk(node.children);
      const matches =
        node.name.toLowerCase().includes(q) ||
        node.slug.toLowerCase().includes(q);
      if (matches || children.length > 0) {
        result.push({ ...node, children });
      }
    }
    return result;
  }

  return walk(nodes);
}

export default function ManageCategoriesPage() {
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [meta, setMeta] = useState<TreeMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Form dialog
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<
    'create-root' | 'create-child' | 'edit'
  >('create-root');
  const [formParent, setFormParent] = useState<CategoryNode | null>(null);
  const [formCategory, setFormCategory] = useState<CategoryNode | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<CategoryNode | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteDialogState>({
    status: 'idle',
  });

  const reorderInFlight = useRef(false);
  const dragSnapshot = useRef<CategoryNode[] | null>(null);

  const canCreate = meta?.canCreate ?? false;
  const canUpdate = meta?.canUpdate ?? false;
  const canDelete = meta?.canDelete ?? false;
  const maxDepth = meta?.maxDepth ?? 4;
  const total = meta?.total ?? countNodes(tree);

  const isFiltering = Boolean(search.trim());
  const dragEnabled = canUpdate && !isFiltering && !loading;

  const filteredTree = useMemo(
    () => filterTree(tree, search),
    [tree, search]
  );

  const rootIds = useMemo(
    () => filteredTree.map((n) => n.id),
    [filteredTree]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadTree = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const res = await requestJson<{
        success: true;
        data: CategoryNode[];
        meta: TreeMeta;
      }>('/tree');
      setTree(res.data);
      setMeta(res.meta);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load categories.';
      setError(message);
      if (!silent) toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  function openCreateRoot() {
    setFormMode('create-root');
    setFormParent(null);
    setFormCategory(null);
    setFormOpen(true);
  }

  function openCreateChild(parent: CategoryNode) {
    if (parent.depth >= maxDepth) {
      toast.error(`Categories can only nest up to ${maxDepth} levels.`);
      return;
    }
    setFormMode('create-child');
    setFormParent(parent);
    setFormCategory(null);
    setFormOpen(true);
  }

  function openEdit(category: CategoryNode) {
    setFormMode('edit');
    setFormParent(null);
    setFormCategory(category);
    setFormOpen(true);
  }

  async function handleFormSubmit(values: CategoryFormValues) {
    setFormLoading(true);
    try {
      if (formMode === 'edit' && formCategory) {
        const res = await requestJson<{
          success: true;
          message?: string;
        }>(`/${formCategory.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: values.name,
            slug: values.slug,
            description: values.description || null,
            image: values.image || null,
          }),
        });
        toast.success(res.message || 'Category updated.');
      } else {
        const res = await requestJson<{
          success: true;
          message?: string;
        }>('/', {
          method: 'POST',
          body: JSON.stringify({
            name: values.name,
            slug: values.slug,
            description: values.description || null,
            image: values.image || null,
            parentId:
              formMode === 'create-child' && formParent
                ? formParent.id
                : null,
          }),
        });
        toast.success(res.message || 'Category created.');
      }
      setFormOpen(false);
      await loadTree(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save category.'
      );
    } finally {
      setFormLoading(false);
    }
  }

  async function beginDelete(category: CategoryNode) {
    setDeleteTarget(category);
    setDeleteState({ status: 'checking' });

    try {
      await requestJson(`/${category.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: false }),
      });
      setDeleteState({ status: 'confirm', linkedProductCount: 0 });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'CONFIRM_REQUIRED') {
          setDeleteState({
            status: 'confirm',
            linkedProductCount: err.meta?.linkedProductCount ?? 0,
          });
          return;
        }

        if (err.code === 'HAS_SOLE_PRODUCTS') {
          setDeleteState({
            status: 'blocked',
            reason: 'HAS_SOLE_PRODUCTS',
            message: err.message,
            soleProductCount: err.meta?.soleProductCount,
            linkedProductCount: err.meta?.linkedProductCount,
          });
          return;
        }

        if (err.code === 'HAS_CHILDREN') {
          setDeleteState({
            status: 'blocked',
            reason: 'HAS_CHILDREN',
            message: err.message,
          });
          return;
        }

        setDeleteState({
          status: 'blocked',
          reason: 'OTHER',
          message: err.message,
        });
        return;
      }

      setDeleteState({
        status: 'blocked',
        reason: 'OTHER',
        message:
          err instanceof Error ? err.message : 'Failed to check category.',
      });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setBusyId(id);
    setDeleteState({ status: 'deleting' });

    try {
      const res = await requestJson<{ success: true; message?: string }>(
        `/${id}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ confirm: true }),
        }
      );
      toast.success(res.message || 'Category deleted.');
      setDeleteTarget(null);
      setDeleteState({ status: 'idle' });
      await loadTree(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to delete category.';
      toast.error(message);
      if (err instanceof ApiError && err.code === 'HAS_SOLE_PRODUCTS') {
        setDeleteState({
          status: 'blocked',
          reason: 'HAS_SOLE_PRODUCTS',
          message,
          soleProductCount: err.meta?.soleProductCount,
          linkedProductCount: err.meta?.linkedProductCount,
        });
      } else if (err instanceof ApiError && err.code === 'HAS_CHILDREN') {
        setDeleteState({
          status: 'blocked',
          reason: 'HAS_CHILDREN',
          message,
        });
      } else {
        setDeleteState({
          status: 'blocked',
          reason: 'OTHER',
          message,
        });
      }
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Optimistically reorder siblings in the tree, then persist.
   * parentId null = root level.
   */
  async function handleReorder(
    parentId: string | null,
    orderedIds: string[]
  ) {
    if (!canUpdate || reorderInFlight.current || isFiltering) return;

    dragSnapshot.current = tree;
    const nextTree = reorderSiblingsInTree(tree, parentId, orderedIds);
    if (!nextTree) return;

    setTree(nextTree);
    reorderInFlight.current = true;
    setBusyId('reorder');

    try {
      const res = await requestJson<{
        success: true;
        message?: string;
        data?: CategoryNode[];
      }>('/reorder', {
        method: 'PUT',
        body: JSON.stringify({ parentId, orderedIds }),
      });

      if (res.data) {
        setTree(res.data);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save order.'
      );
      if (dragSnapshot.current) {
        setTree(dragSnapshot.current);
      } else {
        await loadTree(true);
      }
    } finally {
      reorderInFlight.current = false;
      setBusyId(null);
      dragSnapshot.current = null;
    }
  }

  function onRootDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !dragEnabled) return;

    const oldIndex = rootIds.indexOf(String(active.id));
    const newIndex = rootIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

    const nextIds = arrayMove(rootIds, oldIndex, newIndex);
    void handleReorder(null, nextIds);
  }

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-7"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Category Management</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="sr-only text-2xl font-semibold tracking-tight">
              Category Management
            </h1>
            <p className="text-muted-foreground max-w-xl text-sm">
              Organise products in a folder-style tree. Nest up to {maxDepth}{' '}
              levels (e.g. Fashion → Women → Accessories → Bags). Drag the grip
              handle to reorder siblings. Products can belong to multiple
              categories.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadTree(true)}
              disabled={loading || refreshing}
              className="gap-1.5"
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
            <Button
              size="sm"
              disabled={!canCreate}
              onClick={openCreateRoot}
              className="gap-1.5"
            >
              <Plus className="size-3.5" />
              New root category
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter categories…"
              className="pl-8"
              disabled={loading}
            />
          </div>
          <p className="text-muted-foreground text-xs tabular-nums">
            {total} categor{total === 1 ? 'y' : 'ies'}
            {search.trim()
              ? ` · showing matches for “${search.trim()}”`
              : canUpdate
                ? ' · drag grips to reorder'
                : ''}
          </p>
        </div>

        {loading ? (
          <Card>
            <CardContent className="p-2">
              <CategoryTreeSkeleton />
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <ShieldAlert className="text-destructive size-8" />
              <div>
                <p className="font-medium">Could not load categories</p>
                <p className="text-muted-foreground mt-1 text-sm">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadTree()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : tree.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="bg-muted flex size-12 items-center justify-center rounded-full">
                <FolderTree className="text-muted-foreground size-6" />
              </div>
              <div>
                <p className="font-medium">No categories yet</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Create a root category to start building your tree.
                </p>
              </div>
              {canCreate && (
                <Button
                  size="sm"
                  onClick={openCreateRoot}
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  New root category
                </Button>
              )}
            </CardContent>
          </Card>
        ) : filteredTree.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="font-medium">No matches</p>
              <p className="text-muted-foreground text-sm">
                No categories match “{search.trim()}”.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-2 sm:p-3">
              <div
                className="text-muted-foreground mb-2 flex items-center gap-2 border-b px-2 pb-2 text-xs"
                aria-hidden
              >
                <FolderTree className="size-3.5" />
                <span>Category tree</span>
                {isFiltering && (
                  <span className="text-amber-600 dark:text-amber-400">
                    · reordering disabled while filtering
                  </span>
                )}
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onRootDragEnd}
              >
                <SortableContext
                  items={rootIds}
                  strategy={verticalListSortingStrategy}
                >
                  {filteredTree.map((node) => (
                    <CategoryTreeItem
                      key={node.id}
                      node={node}
                      maxDepth={maxDepth}
                      canCreate={canCreate}
                      canUpdate={canUpdate}
                      canDelete={canDelete}
                      busyId={busyId}
                      dragEnabled={dragEnabled}
                      onAddChild={openCreateChild}
                      onEdit={openEdit}
                      onDelete={(cat) => void beginDelete(cat)}
                      onReorder={handleReorder}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </CardContent>
          </Card>
        )}
      </main>

      <CategoryFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        parent={formParent}
        category={formCategory}
        maxDepth={maxDepth}
        loading={formLoading}
        onSubmit={(values) => void handleFormSubmit(values)}
      />

      <DeleteCategoryDialog
        category={deleteTarget}
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteState({ status: 'idle' });
          }
        }}
        state={deleteState}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
