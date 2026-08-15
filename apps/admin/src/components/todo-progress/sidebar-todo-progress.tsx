'use client';

import { PackageCheck } from 'lucide-react';

import {
  SidebarGroup,
  SidebarGroupContent,
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { PRODUCT_TODO_GOAL, PRODUCT_TODO_ID } from './constants';
import {
  getProgressTone,
  remainingLabel,
  toneLabelClass,
} from './tones';
import { TodoProgressBar } from './todo-progress-bar';
import { useTodoCount } from './use-todo-count';

type SidebarTodoProgressProps = {
  todoId?: string;
  goal?: number;
  title?: string;
};

export function SidebarTodoProgress({
  todoId = PRODUCT_TODO_ID,
  goal = PRODUCT_TODO_GOAL,
  title = 'Products added',
}: SidebarTodoProgressProps) {
  const { count, hydrated } = useTodoCount(todoId);
  const tone = getProgressTone(count, goal);
  const safeGoal = Math.max(1, goal);

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupContent>
        <div
          className={cn(
            'rounded-xl border border-sidebar-border/80 bg-sidebar-accent/30 px-3 py-3',
            'shadow-xs'
          )}
        >
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <PackageCheck className="size-3.5 shrink-0 text-sidebar-foreground/70" />
                <p className="truncate text-xs font-medium text-sidebar-foreground">
                  {title}
                </p>
              </div>
              <p
                className={cn(
                  'mt-1 text-[11px] leading-none',
                  hydrated ? toneLabelClass(tone) : 'text-sidebar-foreground/50'
                )}
              >
                {hydrated ? remainingLabel(count, safeGoal) : 'Loading…'}
              </p>
            </div>
            <div className="shrink-0 text-xs font-semibold tabular-nums text-sidebar-foreground">
              {hydrated ? (
                <>
                  {count}
                  <span className="font-medium text-sidebar-foreground/50">
                    {' '}
                    / {safeGoal}
                  </span>
                </>
              ) : (
                <Skeleton className="h-3.5 w-10" />
              )}
            </div>
          </div>

          {hydrated ? (
            <TodoProgressBar
              count={count}
              goal={safeGoal}
              durationMs={600}
              className="h-1.5"
            />
          ) : (
            <Skeleton className="h-1.5 w-full rounded-full" />
          )}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
