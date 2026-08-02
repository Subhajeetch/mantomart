'use client';

import { GripVertical } from 'lucide-react';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';

import { cn } from '@/lib/utils';

type DragHandleProps = {
  attributes?: DraggableAttributes;
  listeners?: SyntheticListenerMap;
  disabled?: boolean;
  className?: string;
  label?: string;
};

/**
 * Discord-style grip handle — only this surface starts a drag so clicks on
 * labels / menus still work normally.
 */
export function DragHandle({
  attributes,
  listeners,
  disabled,
  className,
  label = 'Drag to reorder',
}: DragHandleProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-7 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-40'
          : 'cursor-grab hover:bg-muted hover:text-foreground active:cursor-grabbing',
        className
      )}
      disabled={disabled}
      aria-label={label}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <GripVertical className="size-4" />
    </button>
  );
}
