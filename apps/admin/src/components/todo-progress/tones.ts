import { cn } from '@/lib/utils';

export type ProgressTone = 'low' | 'mid' | 'high' | 'complete' | 'over';

export function getProgressRatio(count: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.max(0, count) / goal;
}

export function getProgressPercent(count: number, goal: number): number {
  return Math.min(100, getProgressRatio(count, goal) * 100);
}

export function getProgressTone(count: number, goal: number): ProgressTone {
  if (count > goal) return 'over';
  if (goal > 0 && count >= goal) return 'complete';

  const ratio = getProgressRatio(count, goal);
  if (ratio >= 0.7) return 'high';
  if (ratio >= 0.35) return 'mid';
  return 'low';
}

/** Indicator fill — warmer while early, green as the goal gets close. */
export function toneIndicatorClass(tone: ProgressTone): string {
  switch (tone) {
    case 'low':
      return '[&_[data-slot=progress-indicator]]:bg-amber-500 dark:[&_[data-slot=progress-indicator]]:bg-amber-400';
    case 'mid':
      return '[&_[data-slot=progress-indicator]]:bg-sky-500 dark:[&_[data-slot=progress-indicator]]:bg-sky-400';
    case 'high':
      return '[&_[data-slot=progress-indicator]]:bg-emerald-500 dark:[&_[data-slot=progress-indicator]]:bg-emerald-400';
    case 'complete':
      return '[&_[data-slot=progress-indicator]]:bg-green-500 dark:[&_[data-slot=progress-indicator]]:bg-green-400';
    case 'over':
      return cn(
        '[&_[data-slot=progress-indicator]]:bg-gradient-to-r',
        '[&_[data-slot=progress-indicator]]:from-emerald-400',
        '[&_[data-slot=progress-indicator]]:via-green-400',
        '[&_[data-slot=progress-indicator]]:to-amber-400'
      );
  }
}

export function toneTrackClass(tone: ProgressTone): string {
  switch (tone) {
    case 'low':
      return 'bg-amber-500/15';
    case 'mid':
      return 'bg-sky-500/15';
    case 'high':
      return 'bg-emerald-500/15';
    case 'complete':
      return 'bg-green-500/15';
    case 'over':
      return 'bg-amber-400/20';
  }
}

export function toneLabelClass(tone: ProgressTone): string {
  switch (tone) {
    case 'low':
      return 'text-amber-700 dark:text-amber-300';
    case 'mid':
      return 'text-sky-700 dark:text-sky-300';
    case 'high':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'complete':
      return 'text-green-700 dark:text-green-300';
    case 'over':
      return 'text-amber-700 dark:text-amber-300';
  }
}

export function remainingLabel(count: number, goal: number): string {
  if (count > goal) {
    const extra = count - goal;
    return `+${extra} past goal 🔥`;
  }
  if (count >= goal) return 'Goal reached';
  const left = Math.max(0, goal - count);
  return left === 1 ? '1 more to go' : `${left} more to go`;
}
