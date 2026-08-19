"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { DragHandle } from "./drag-handle";
import type { HomepageAdminBlock } from "./types";
import { BLOCK_TYPE_LABELS, dragId } from "./types";
import { blockNeedsRepair, blockSummary } from "./utils";

type SortableBlockProps = {
  block: HomepageAdminBlock;
  canUpdate: boolean;
  busy: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleVisible: (id: string) => void;
};

export function SortableBlock({
  block,
  canUpdate,
  busy,
  onEdit,
  onDelete,
  onToggleVisible,
}: SortableBlockProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: dragId("block", block.id),
    disabled: !canUpdate || busy,
    data: { kind: "block" as const, blockId: block.id },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(
      transform ? { ...transform, scaleX: 1, scaleY: 1 } : null
    ),
    transition,
    zIndex: isDragging ? 40 : undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  const needsRepair = blockNeedsRepair(block);
  const label = BLOCK_TYPE_LABELS[block.blockType] ?? block.blockType;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 border-b bg-card px-2 py-2 last:border-b-0",
        isDragging && "cursor-grabbing",
        !block.isVisible && "opacity-70"
      )}
    >
      <DragHandle
        attributes={attributes}
        listeners={listeners}
        disabled={!canUpdate || busy}
        label={`Drag ${label}`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{label}</Badge>
          {needsRepair ? (
            <Badge variant="destructive">Needs repair</Badge>
          ) : null}
          {!block.isVisible ? (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <EyeOff className="size-3" />
              Hidden
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Eye className="size-3" />
              Visible
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {blockSummary(block)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Switch
          size="sm"
          checked={block.isVisible}
          disabled={!canUpdate || busy}
          onCheckedChange={() => onToggleVisible(block.id)}
          aria-label={`Toggle ${label} visibility`}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!canUpdate || busy}
          onClick={() => onEdit(block.id)}
          aria-label={`Edit ${label}`}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!canUpdate || busy}
          onClick={() => onDelete(block.id)}
          aria-label={`Delete ${label}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
