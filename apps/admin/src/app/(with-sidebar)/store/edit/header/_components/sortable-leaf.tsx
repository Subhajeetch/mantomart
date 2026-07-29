"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Eye,
  EyeOff,
  MoreHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { DragHandle } from "./drag-handle";
import type { HeaderAdminItem } from "./types";
import { dragId } from "./types";

type SortableLeafProps = {
  item: HeaderAdminItem;
  canUpdate: boolean;
  busy: boolean;
  onToggleVisible: (item: HeaderAdminItem) => void;
  onToggleFeatured: (item: HeaderAdminItem) => void;
  onDelete: (item: HeaderAdminItem) => void;
};

export function SortableLeaf({
  item,
  canUpdate,
  busy,
  onToggleVisible,
  onToggleFeatured,
  onDelete,
}: SortableLeafProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: dragId("leaf", item.id),
    disabled: !canUpdate || busy,
    data: {
      kind: "leaf" as const,
      itemId: item.id,
      parentId: item.parentId,
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-0.5 rounded-md px-0.5 py-0.5 transition-colors",
        isDragging && "bg-muted/60 ring-1 ring-primary/30 shadow-md",
        !item.isVisible && "opacity-55"
      )}
      data-leaf-id={item.id}
    >
      <DragHandle
        attributes={attributes}
        listeners={listeners}
        disabled={!canUpdate || busy}
        className={cn(
          "size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
          isDragging && "opacity-100"
        )}
        label={`Drag ${item.name}`}
      />

      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate text-sm leading-snug",
              item.isVisible
                ? "text-foreground"
                : "text-muted-foreground line-through decoration-muted-foreground/40"
            )}
            title={item.name}
          >
            {item.name}
          </span>
          {item.featured && (
            <Badge
              variant="secondary"
              className="h-4 shrink-0 gap-0.5 px-1 text-[9px] font-semibold uppercase tracking-wide text-pink-600 dark:text-pink-400"
            >
              New
            </Badge>
          )}
        </div>
        <p className="truncate text-[11px] text-muted-foreground" title={item.slug}>
          /{item.slug}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!canUpdate || busy}
              onClick={() => onToggleVisible(item)}
              aria-label={item.isVisible ? "Hide" : "Show"}
            >
              {item.isVisible ? (
                <Eye className="size-3.5" />
              ) : (
                <EyeOff className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {item.isVisible ? "Hide from menu" : "Show in menu"}
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!canUpdate || busy}
              aria-label="More actions"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onToggleFeatured(item)}>
              <Sparkles className="size-3.5" />
              {item.featured ? "Unmark featured" : "Mark featured (NEW)"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleVisible(item)}>
              {item.isVisible ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
              {item.isVisible ? "Hide" : "Show"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(item)}
            >
              <Trash2 className="size-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
