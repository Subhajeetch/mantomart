'use client';

import { useEffect, useState } from 'react';

import { getTodoCount, subscribeTodoCounts } from './store';

export function useTodoCount(id: string): {
  count: number;
  hydrated: boolean;
} {
  const [count, setCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCount(getTodoCount(id));
    setHydrated(true);

    return subscribeTodoCounts((counts) => {
      setCount(counts[id] ?? 0);
    });
  }, [id]);

  return { count, hydrated };
}
