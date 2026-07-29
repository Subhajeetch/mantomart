"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

import type { HeaderAdminCollection } from "./types";
import { dragId } from "./types";

type SortableTabProps = {
  collection: HeaderAdminCollection;
  active: boolean;
  canUpdate: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
};

export function SortableTab({
  collection,
  active,
  canUpdate,
  busy,
  onSelect,
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: dragId("tab", collection.id),
    disabled: !canUpdate || busy,
    data: {
      kind: "tab" as const,
      collectionId: collection.id,
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(
      transform
        ? {
            ...transform,
            // Keep tabs on a horizontal axis visually
            scaleX: 1,
            scaleY: 1,
          }
        : null
    ),
    transition,
    zIndex: isDragging ? 40 : undefined,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex shrink-0 touch-none items-stretch",
        isDragging && "cursor-grabbing"
      )}
    >
      {/* Discord-style grip — only this starts the drag */}
      {canUpdate && (
        <button
          type="button"
          className={cn(
            "flex w-0 items-center justify-center overflow-hidden text-muted-foreground transition-all",
            "group-hover:w-5 group-focus-within:w-5",
            isDragging && "w-5",
            busy
              ? "cursor-not-allowed opacity-40"
              : "cursor-grab hover:text-foreground active:cursor-grabbing"
          )}
          disabled={busy}
          aria-label={`Drag ${collection.name} tab`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5 shrink-0" />
        </button>
      )}

      <button
        type="button"
        className={cn(
          "relative flex items-center gap-1.5 px-3.5 py-3 text-sm font-semibold tracking-wide uppercase transition-colors",
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
          !collection.isVisible && "opacity-50"
        )}
        onClick={() => onSelect(collection.id)}
        aria-pressed={active}
        aria-label={`${collection.name} tab${!collection.isVisible ? " (hidden)" : ""}`}
      >
        <span className="max-w-[9rem] truncate">{collection.name}</span>
        {!collection.isVisible && (
          <EyeOff className="size-3 shrink-0 text-muted-foreground" />
        )}
        {/* Active underline like storefront mega menu */}
        <span
          className={cn(
            "absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-all",
            active
              ? "bg-pink-500"
              : "bg-transparent group-hover:bg-muted-foreground/25"
          )}
        />
      </button>
    </div>
  );
}
