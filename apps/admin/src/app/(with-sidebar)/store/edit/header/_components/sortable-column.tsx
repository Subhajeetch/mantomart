"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Eye,
  EyeOff,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { DragHandle } from "./drag-handle";
import { SortableLeaf } from "./sortable-leaf";
import type { HeaderAdminItem } from "./types";
import { dragId } from "./types";

type SortableColumnProps = {
  column: HeaderAdminItem;
  canUpdate: boolean;
  busy: boolean;
  onAddLeaf: (column: HeaderAdminItem) => void;
  onToggleColumnVisible: (column: HeaderAdminItem) => void;
  onDeleteColumn: (column: HeaderAdminItem) => void;
  onToggleLeafVisible: (item: HeaderAdminItem) => void;
  onToggleLeafFeatured: (item: HeaderAdminItem) => void;
  onDeleteLeaf: (item: HeaderAdminItem) => void;
};

export function SortableColumn({
  column,
  canUpdate,
  busy,
  onAddLeaf,
  onToggleColumnVisible,
  onDeleteColumn,
  onToggleLeafVisible,
  onToggleLeafFeatured,
  onDeleteLeaf,
}: SortableColumnProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: dragId("column", column.id),
    disabled: !canUpdate || busy,
    data: {
      kind: "column" as const,
      itemId: column.id,
      parentId: column.parentId,
    },
  });

  // Dedicated drop zone so empty columns still accept leaf drops.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dragId("colzone", column.id),
    disabled: !canUpdate || busy,
    data: {
      kind: "colzone" as const,
      itemId: column.id,
      parentId: column.parentId,
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.45 : 1,
  };

  const leafIds = column.children.map((c) => dragId("leaf", c.id));

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex min-w-[12rem] max-w-[15rem] flex-1 flex-col gap-1 rounded-xl border bg-card/70 p-2.5 shadow-sm backdrop-blur-sm",
        isDragging && "ring-2 ring-primary/40 shadow-lg",
        isOver && !isDragging && "ring-2 ring-pink-500/40 bg-pink-500/5",
        !column.isVisible && "border-dashed opacity-70"
      )}
      data-column-id={column.id}
    >
      {/* Column header — pink like the storefront mega menu */}
      <div className="group/col flex items-start gap-0.5 border-b border-border/60 pb-2">
        <DragHandle
          attributes={attributes}
          listeners={listeners}
          disabled={!canUpdate || busy}
          className="mt-0.5"
          label={`Drag column ${column.name}`}
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-semibold",
              column.isVisible
                ? "text-pink-600 dark:text-pink-400"
                : "text-muted-foreground line-through"
            )}
            title={column.name}
          >
            {column.name}
          </p>
          <p
            className="truncate text-[10px] text-muted-foreground"
            title={`/${column.slug}`}
          >
            /{column.slug}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!canUpdate || busy}
              className="mt-0.5 opacity-60 hover:opacity-100"
              aria-label="Column actions"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onAddLeaf(column)}>
              <Plus className="size-3.5" />
              Add link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleColumnVisible(column)}>
              {column.isVisible ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
              {column.isVisible ? "Hide column" : "Show column"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDeleteColumn(column)}
            >
              <Trash2 className="size-3.5" />
              Delete column
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nested leaf links */}
      <div
        ref={setDropRef}
        className={cn(
          "flex min-h-[2.5rem] flex-1 flex-col gap-0.5 rounded-md py-1 transition-colors",
          isOver && "bg-pink-500/5"
        )}
        data-droppable-parent={column.id}
      >
        <SortableContext items={leafIds} strategy={verticalListSortingStrategy}>
          {column.children.length === 0 ? (
            <p className="px-1 py-3 text-center text-[11px] text-muted-foreground">
              {canUpdate ? "Drop links here" : "No links"}
            </p>
          ) : (
            column.children.map((leaf) => (
              <SortableLeaf
                key={leaf.id}
                item={leaf}
                canUpdate={canUpdate}
                busy={busy}
                onToggleVisible={onToggleLeafVisible}
                onToggleFeatured={onToggleLeafFeatured}
                onDelete={onDeleteLeaf}
              />
            ))
          )}
        </SortableContext>
      </div>

      {canUpdate && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="mt-auto h-7 justify-start gap-1 text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={() => onAddLeaf(column)}
        >
          <Plus className="size-3" />
          Add link
        </Button>
      )}
    </div>
  );
}
