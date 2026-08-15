'use client';

import type { CSSProperties } from 'react';

import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import {
  getProgressPercent,
  getProgressTone,
  toneIndicatorClass,
  toneTrackClass,
  type ProgressTone,
} from './tones';

type TodoProgressBarProps = {
  count: number;
  goal: number;
  durationMs?: number;
  className?: string;
  /** Force a tone (e.g. keep the destination color while the bar fills). */
  tone?: ProgressTone;
};

export function TodoProgressBar({
  count,
  goal,
  durationMs = 500,
  className,
  tone: toneOverride,
}: TodoProgressBarProps) {
  const tone = toneOverride ?? getProgressTone(count, goal);
  const value = getProgressPercent(count, goal);
  const glowing = tone === 'complete' || tone === 'over';

  return (
    <Progress
      value={value}
      data-tone={tone}
      style={
        {
          '--todo-progress-duration': `${durationMs}ms`,
        } as CSSProperties
      }
      className={cn(
        'h-2 overflow-hidden rounded-full',
        '[&_[data-slot=progress-indicator]]:transition-transform',
        '[&_[data-slot=progress-indicator]]:ease-out',
        '[&_[data-slot=progress-indicator]]:duration-(--todo-progress-duration)',
        toneTrackClass(tone),
        toneIndicatorClass(tone),
        glowing && 'shadow-[0_0_12px_-2px] shadow-green-500/40',
        tone === 'over' && 'animate-pulse',
        className
      )}
    />
  );
}
