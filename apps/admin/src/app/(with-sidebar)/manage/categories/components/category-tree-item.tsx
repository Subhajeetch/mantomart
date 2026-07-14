'use client';

import { useState } from 'react';
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
  onAddChild,
  onEdit,
  onDelete,
}: {
  node: CategoryNode;
  maxDepth: number;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  busyId: string | null;
  depth?: number;
  onAddChild: (parent: CategoryNode) => void;
  onEdit: (category: CategoryNode) => void;
  onDelete: (category: CategoryNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const canNestMore = node.depth < maxDepth;
  const isBusy = busyId === node.id;

  return (
    <div className="select-none">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className={cn(
            'group hover:bg-muted/60 flex items-center gap-1 rounded-md pr-1 transition-colors',
            isBusy && 'opacity-60'
          )}
          style={{ paddingLeft: `${depth * 1.25 + 0.25}rem` }}
        >
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
          </div>
        </div>

        {hasChildren && (
          <CollapsibleContent>
            <div className="border-border/60 ml-[calc(0.875rem+0.25rem)] border-l pl-0">
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
                  onAddChild={onAddChild}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
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
