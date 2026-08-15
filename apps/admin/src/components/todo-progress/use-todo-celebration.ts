'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  getSettingValue,
  TODO_ANIMATIONS_SETTING_ID,
} from '@/app/(with-sidebar)/settings/settings';

import {
  PRODUCT_TODO_DEMO_FROM,
  PRODUCT_TODO_DEMO_TO,
  TODO_CELEBRATION_OPEN_DELAY_MS,
} from './constants';
import { subscribeTodoCelebrate } from './store';

type UseTodoCelebrationOptions = {
  todoId: string;
  /** Hidden Ctrl/Cmd+M preview. */
  enableHotkey?: boolean;
  demoFrom?: number;
  demoTo?: number;
  /** When true (default), the settings toggle can suppress the UI. */
  respectSetting?: boolean;
};

export function useTodoCelebration({
  todoId,
  enableHotkey = false,
  demoFrom = PRODUCT_TODO_DEMO_FROM,
  demoTo = PRODUCT_TODO_DEMO_TO,
  respectSetting = true,
}: UseTodoCelebrationOptions): {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: number;
  to: number;
  nonce: number;
  play: (nextFrom: number, nextTo: number) => void;
} {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [nonce, setNonce] = useState(0);

  const play = useCallback(
    (nextFrom: number, nextTo: number) => {
      if (respectSetting && !getSettingValue(TODO_ANIMATIONS_SETTING_ID)) {
        return;
      }
      setFrom(nextFrom);
      setTo(nextTo);
      setNonce((value) => value + 1);
      setOpen(true);
    },
    [respectSetting]
  );

  useEffect(() => {
    let timeout: number | undefined;

    const unsubscribe = subscribeTodoCelebrate((detail) => {
      if (detail.id !== todoId) return;
      if (respectSetting && !getSettingValue(TODO_ANIMATIONS_SETTING_ID)) {
        return;
      }

      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        setFrom(detail.from);
        setTo(detail.to);
        setNonce((value) => value + 1);
        setOpen(true);
      }, TODO_CELEBRATION_OPEN_DELAY_MS);
    });

    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, [todoId, respectSetting]);

  useEffect(() => {
    if (!enableHotkey) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() !== 'm') return;
      if (event.repeat) return;

      event.preventDefault();
      play(demoFrom, demoTo);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enableHotkey, demoFrom, demoTo, play]);

  return {
    open,
    onOpenChange: setOpen,
    from,
    to,
    nonce,
    play,
  };
}
