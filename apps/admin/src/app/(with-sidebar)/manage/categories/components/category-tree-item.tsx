'use client';

import { useState } from 'react';
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
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { CategoryNode } from '../utils';
import { DragHandle } from './drag-handle';

function CategoryIcon({
  image,
  open,
}: {
  image: string | null;
  open: boolean;
}) {
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        className="size-5 shrink-0 rounded-sm object-cover ring-1 ring-border"
      />
    );
  }

  const Icon = open ? FolderOpen : Folder;
  return (
    <Icon
      className={cn(
        'size-4 shrink-0',
        open ? 'text-amber-600 dark:text-amber-400' : 'text-amber-500/90'
      )}
    />
  );
}

export function CategoryTreeItem({
  node,
  maxDepth,
  canCreate,
  canUpdate,
  canDelete,
  busyId,
  depth = 0,
  dragEnabled,
  onAddChild,
  onEdit,
  onDelete,
  onReorder,
}: {
  node: CategoryNode;
  maxDepth: number;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  busyId: string | null;
  depth?: number;
  /** When false (e.g. while filtering), hide grips and disable DnD. */
  dragEnabled: boolean;
  onAddChild: (parent: CategoryNode) => void;
  onEdit: (category: CategoryNode) => void;
  onDelete: (category: CategoryNode) => void;
  onReorder: (
    parentId: string | null,
    orderedIds: string[]
  ) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const canNestMore = node.depth < maxDepth;
  const isBusy = busyId === node.id || busyId === 'reorder';
  const hasCategoryActions = canCreate || canUpdate || canDelete;
  const canDrag = dragEnabled && canUpdate && !isBusy;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.id,
    disabled: !canDrag,
    data: {
      parentId: node.parentId,
      depth: node.depth,
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.45 : 1,
    paddingLeft: `${depth * 1.25 + 0.25}rem`,
  };

  const childIds = node.children.map((c) => c.id);

  const childSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleChildDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = childIds.indexOf(String(active.id));
    const newIndex = childIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

    const next = [...childIds];
    const [moved] = next.splice(oldIndex, 1);
    if (!moved) return;
    next.splice(newIndex, 0, moved);
    void onReorder(node.id, next);
  }

  return (
    <div ref={setNodeRef} style={style} className="select-none">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className={cn(
            'group hover:bg-muted/60 flex items-center gap-0.5 rounded-md pr-1 transition-colors',
            isBusy && 'opacity-60',
            isDragging && 'bg-muted/80 ring-2 ring-primary/30 shadow-md'
          )}
        >
          {canDrag ? (
            <DragHandle
              attributes={attributes}
              listeners={listeners}
              disabled={!canDrag}
              label={`Drag to reorder ${node.name}`}
            />
          ) : (
            <span className="inline-flex size-7 shrink-0" aria-hidden />
          )}

          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground size-7 shrink-0"
                aria-label={open ? 'Collapse' : 'Expand'}
              >
                <ChevronRight
                  className={cn(
                    'size-3.5 transition-transform',
                    open && 'rotate-90'
                  )}
                />
              </Button>
            </CollapsibleTrigger>
          ) : (
            <span className="inline-flex size-7 shrink-0" aria-hidden />
          )}

          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
            onClick={() => {
              if (hasChildren) setOpen((v) => !v);
            }}
          >
            <CategoryIcon image={node.image} open={open && hasChildren} />
            <span className="truncate text-sm font-medium">{node.name}</span>
            <span className="text-muted-foreground hidden truncate font-mono text-xs sm:inline">
              /{node.slug}
            </span>
            {hasChildren && (
              <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums sm:ml-0">
                {node.children.length}
              </span>
            )}
          </button>

          <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            {canCreate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      disabled={!canNestMore || isBusy}
                      onClick={() => onAddChild(node)}
                      aria-label="Add subcategory"
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {canNestMore
                    ? 'Add subcategory'
                    : `Max nesting is ${maxDepth} levels`}
                </TooltipContent>
              </Tooltip>
            )}

            {hasCategoryActions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7"
                    disabled={isBusy}
                    aria-label="Category actions"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {canCreate && (
                    <DropdownMenuItem
                      disabled={!canNestMore}
                      onClick={() => onAddChild(node)}
                    >
                      <Plus className="size-3.5" />
                      Add subcategory
                    </DropdownMenuItem>
                  )}
                  {canUpdate && (
                    <DropdownMenuItem onClick={() => onEdit(node)}>
                      <Pencil className="size-3.5" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {(canCreate || canUpdate) && canDelete && (
                    <DropdownMenuSeparator />
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onDelete(node)}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {hasChildren && (
          <CollapsibleContent>
            <div className="border-border/60 ml-[calc(0.875rem+0.25rem)] border-l pl-0">
              {/* Nested DndContext so children only reorder among siblings */}
              <DndContext
                sensors={childSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleChildDragEnd}
              >
                <SortableContext
                  items={childIds}
                  strategy={verticalListSortingStrategy}
                >
                  {node.children.map((child) => (
                    <CategoryTreeItem
                      key={child.id}
                      node={child}
                      maxDepth={maxDepth}
                      canCreate={canCreate}
                      canUpdate={canUpdate}
                      canDelete={canDelete}
                      busyId={busyId}
                      depth={depth + 1}
                      dragEnabled={dragEnabled}
                      onAddChild={onAddChild}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onReorder={onReorder}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}

export function CategoryTreeSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-muted/50 h-9 animate-pulse rounded-md"
          style={{ marginLeft: `${(i % 3) * 1.25}rem` }}
        />
      ))}
    </div>
  );
}
