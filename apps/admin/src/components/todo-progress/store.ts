'use client';

/**
 * Browser-local todo counters.
 * Same-tab custom events + cross-tab `storage` keep the sidebar in sync.
 */

const STORAGE_KEY = 'admin:todo-counts:v1';
const CHANGE_EVENT = 'admin:todo-counts:change';
export const TODO_CELEBRATE_EVENT = 'admin:todo:celebrate';

export type TodoCounts = Record<string, number>;

export type TodoCelebrateDetail = {
  id: string;
  from: number;
  to: number;
};

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function readAll(): TodoCounts {
  if (!isBrowser()) return {};

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const counts: TodoCounts = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key) continue;
      counts[key] = sanitizeCount(value);
    }
    return counts;
  } catch {
    return {};
  }
}

function writeAll(counts: TodoCounts): void {
  if (!isBrowser()) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
  } catch {
    // Quota / private mode — in-memory listeners still update.
  }
}

function notifyCountsChanged(counts: TodoCounts): void {
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, {
      detail: counts,
    })
  );
}

export function getTodoCount(id: string): number {
  return readAll()[id] ?? 0;
}

export function getAllTodoCounts(): TodoCounts {
  return readAll();
}

export function setTodoCount(id: string, count: number): number {
  const nextValue = sanitizeCount(count);
  const counts = readAll();
  counts[id] = nextValue;
  writeAll(counts);
  notifyCountsChanged(counts);
  return nextValue;
}

export function incrementTodoCount(
  id: string,
  by = 1
): { from: number; to: number } {
  const from = getTodoCount(id);
  const step = Number.isFinite(by) ? Math.floor(by) : 1;
  const to = setTodoCount(id, from + step);
  return { from, to };
}

export function dispatchTodoCelebrate(detail: TodoCelebrateDetail): void {
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent<TodoCelebrateDetail>(TODO_CELEBRATE_EVENT, { detail })
  );
}

/** Persist a +1 and notify celebration hosts. */
export function recordTodoIncrement(
  id: string,
  by = 1
): { from: number; to: number } {
  const result = incrementTodoCount(id, by);
  dispatchTodoCelebrate({ id, ...result });
  return result;
}

export function subscribeTodoCounts(
  listener: (counts: TodoCounts) => void
): () => void {
  if (!isBrowser()) return () => undefined;

  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<TodoCounts>).detail;
    if (!detail || typeof detail !== 'object') return;
    listener(detail);
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    listener(readAll());
  };

  window.addEventListener(CHANGE_EVENT, onCustom as EventListener);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(CHANGE_EVENT, onCustom as EventListener);
    window.removeEventListener('storage', onStorage);
  };
}

export function subscribeTodoCelebrate(
  listener: (detail: TodoCelebrateDetail) => void
): () => void {
  if (!isBrowser()) return () => undefined;

  const onCelebrate = (event: Event) => {
    const detail = (event as CustomEvent<TodoCelebrateDetail>).detail;
    if (!detail || typeof detail.id !== 'string') return;
    if (typeof detail.from !== 'number' || typeof detail.to !== 'number') {
      return;
    }
    listener({
      id: detail.id,
      from: sanitizeCount(detail.from),
      to: sanitizeCount(detail.to),
    });
  };

  window.addEventListener(TODO_CELEBRATE_EVENT, onCelebrate as EventListener);
  return () => {
    window.removeEventListener(TODO_CELEBRATE_EVENT, onCelebrate as EventListener);
  };
}
