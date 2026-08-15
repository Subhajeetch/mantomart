'use client';

import { useEffect, useMemo, useState } from 'react';
import Confetti from 'react-confetti';
import { Check, Sparkles } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

import {
  getCelebrationVisibleMs,
  getProgressAnimationMs,
  TODO_CONFETTI_DURATION_MS,
} from './constants';
import {
  getProgressTone,
  remainingLabel,
  toneLabelClass,
} from './tones';
import { TodoProgressBar } from './todo-progress-bar';

export type TodoCelebrationUser = {
  name: string;
  email: string;
  avatar: string;
};

export type TodoCelebrationProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: TodoCelebrationUser | null;
  from: number;
  to: number;
  goal: number;
  /** Bumps to restart the fill / confetti if the same counts play again. */
  nonce?: number;
  title?: string;
  itemLabel?: string;
};

function userInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  return initials || '?';
}

function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const update = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return size;
}

function copyForProgress(to: number, goal: number, itemLabel: string) {
  const reachedGoal = to >= goal && goal > 0;
  const isOver = to > goal;

  if (isOver) {
    return {
      title: "You're on a roll",
      description: `+${to - goal} past your ${itemLabel} goal.`,
    };
  }
  if (reachedGoal) {
    return {
      title: 'Catalog goal reached',
      description: `You added ${goal} ${itemLabel}.`,
    };
  }
  return {
    title: 'Product added',
    description: `Nice — ${to} of ${goal} ${itemLabel} are live.`,
  };
}

function CelebrationBody({
  user,
  from,
  to,
  goal,
  nonce,
  title: titleOverride,
  itemLabel,
}: {
  user: TodoCelebrationUser | null;
  from: number;
  to: number;
  goal: number;
  nonce: number;
  title?: string;
  itemLabel: string;
}) {
  const safeGoal = Math.max(1, goal);
  const progressMs = getProgressAnimationMs();
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  const [barCount, setBarCount] = useState(from);
  const [shownCount, setShownCount] = useState(from);

  useEffect(() => {
    setBarCount(from);
    setShownCount(from);

    if (prefersReduced) {
      setBarCount(to);
      setShownCount(to);
      return;
    }

    let frameTwo = 0;
    const frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => {
        setBarCount(to);
      });
    });
    const flip = window.setTimeout(() => {
      setShownCount(to);
    }, Math.min(420, Math.round(progressMs / 2)));

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
      window.clearTimeout(flip);
    };
  }, [from, to, nonce, prefersReduced, progressMs]);

  const tone = getProgressTone(to, safeGoal);
  const isOver = to > safeGoal;
  const copy = copyForProgress(to, safeGoal, itemLabel);
  const title = titleOverride ?? copy.title;
  const displayName = user?.name?.trim() || 'Admin';
  const displayEmail = user?.email?.trim() || '';
  const avatar = user?.avatar || '/avatars/default.jpg';

  return (
    <div className="space-y-5">
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border bg-muted/40 p-3',
          'ring-1 ring-foreground/5'
        )}
      >
        <Avatar size="lg" className="size-12 rounded-xl after:rounded-xl">
          <AvatarImage src={avatar} alt={displayName} className="rounded-xl" />
          <AvatarFallback className="rounded-xl text-sm font-medium">
            {userInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-tight">{displayName}</p>
          {displayEmail ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {displayEmail}
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full border',
            tone === 'over' || tone === 'complete'
              ? 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
              : 'border-border bg-background text-muted-foreground'
          )}
        >
          {isOver ? (
            <Sparkles className="size-4" />
          ) : (
            <Check className="size-4" />
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium leading-none">{title}</p>
            <p className={cn('mt-1.5 text-xs', toneLabelClass(tone))}>
              {remainingLabel(shownCount, safeGoal)}
            </p>
          </div>
          <p
            className={cn(
              'shrink-0 text-2xl font-semibold tabular-nums tracking-tight',
              isOver && shownCount === to && 'animate-in zoom-in-90 duration-300'
            )}
          >
            {shownCount}
            <span className="text-base font-medium text-muted-foreground">
              {' '}
              / {safeGoal}
            </span>
          </p>
        </div>

        <TodoProgressBar
          count={barCount}
          goal={safeGoal}
          durationMs={prefersReduced ? 0 : progressMs}
          tone={tone}
          className="h-2.5"
        />

        <p className="text-xs text-muted-foreground">{copy.description}</p>
      </div>
    </div>
  );
}

export function TodoCelebration({
  open,
  onOpenChange,
  user,
  from,
  to,
  goal,
  nonce = 0,
  title,
  itemLabel = 'products',
}: TodoCelebrationProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const { width, height } = useViewportSize();

  const safeGoal = Math.max(1, goal);
  const reachedGoal = from < safeGoal && to >= safeGoal;
  const isOver = to > safeGoal;
  const showConfetti = open && !prefersReduced && (reachedGoal || isOver);
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    if (!showConfetti) {
      setBurst(false);
      return;
    }
    setBurst(true);
    const stop = window.setTimeout(() => setBurst(false), TODO_CONFETTI_DURATION_MS);
    return () => window.clearTimeout(stop);
  }, [showConfetti, nonce]);

  const confettiColors = useMemo(
    () =>
      isOver
        ? ['#34d399', '#fbbf24', '#f59e0b', '#a3e635', '#ffffff']
        : ['#22c55e', '#4ade80', '#86efac', '#bbf7d0', '#ffffff'],
    [isOver]
  );

  useEffect(() => {
    if (!open) return;

    const visibleMs = prefersReduced
      ? Math.min(900, getCelebrationVisibleMs())
      : getCelebrationVisibleMs();

    const closeTimer = window.setTimeout(() => {
      onOpenChange(false);
    }, visibleMs);

    return () => window.clearTimeout(closeTimer);
  }, [open, nonce, prefersReduced, onOpenChange]);

  const copy = copyForProgress(to, safeGoal, itemLabel);
  const heading = title ?? copy.title;

  const lockDismiss = {
    onPointerDownOutside: (event: Event) => event.preventDefault(),
    onInteractOutside: (event: Event) => event.preventDefault(),
    onEscapeKeyDown: (event: KeyboardEvent) => event.preventDefault(),
    onFocusOutside: (event: Event) => event.preventDefault(),
  };

  const body = (
    <CelebrationBody
      user={user}
      from={from}
      to={to}
      goal={safeGoal}
      nonce={nonce}
      title={title}
      itemLabel={itemLabel}
    />
  );

  return (
    <>
      {showConfetti && burst && width > 0 ? (
        <Confetti
          width={width}
          height={height}
          recycle={false}
          numberOfPieces={isOver ? 70 : 140}
          gravity={0.28}
          tweenDuration={380}
          colors={confettiColors}
          confettiSource={{ x: 0, y: 0, w: width, h: 0 }}
          initialVelocityY={14}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {isDesktop ? (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (next) onOpenChange(true);
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="sm:max-w-md p-6"
            {...lockDismiss}
          >
            <DialogHeader className="sr-only">
              <DialogTitle>{heading}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer
          open={open}
          onOpenChange={(next) => {
            if (next) onOpenChange(true);
          }}
          dismissible={false}
        >
          <DrawerContent className="pb-6">
            <DrawerHeader className="sr-only">
              <DrawerTitle>{heading}</DrawerTitle>
              <DrawerDescription>{copy.description}</DrawerDescription>
            </DrawerHeader>
            <div className="px-4 pb-2 pt-1">{body}</div>
            <div className="h-[70px] w-full"></div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}
