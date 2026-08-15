'use client';

/**
 * Browser-local todo counters.
 * Counts belong to the local calendar day and reset at midnight.
 * Same-tab custom events + cross-tab `storage` keep the sidebar in sync.
 */

const STORAGE_KEY = 'admin:todo-counts:v1';
const CHANGE_EVENT = 'admin:todo-counts:change';
export const TODO_CELEBRATE_EVENT = 'admin:todo:celebrate';

export type TodoCounts = Record<string, number>;

type StoredPayload = {
  date: string;
  counts: TodoCounts;
};

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

function sanitizeCounts(value: unknown): TodoCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const counts: TodoCounts = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue;
    counts[key] = sanitizeCount(entry);
  }
  return counts;
}

/** Local calendar day, e.g. `2026-08-15`. */
export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function msUntilNextLocalMidnight(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1_000, next.getTime() - now.getTime());
}

function parseStored(raw: string): { payload: StoredPayload; migrated: boolean } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;

    // Current shape: { date, counts }
    if (typeof record.date === 'string' && record.counts && typeof record.counts === 'object') {
      return {
        payload: {
          date: record.date,
          counts: sanitizeCounts(record.counts),
        },
        migrated: false,
      };
    }

    // Pre-daily shape was a flat { [todoId]: number }. Stamp as today once.
    return {
      payload: {
        date: localDateKey(),
        counts: sanitizeCounts(record),
      },
      migrated: true,
    };
  } catch {
    return null;
  }
}

function readPayload(): StoredPayload {
  const today = localDateKey();
  if (!isBrowser()) return { date: today, counts: {} };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: today, counts: {} };

    const stored = parseStored(raw);
    if (!stored) return { date: today, counts: {} };

    if (stored.payload.date !== today) {
      const reset: StoredPayload = { date: today, counts: {} };
      writePayload(reset);
      notifyCountsChanged(reset.counts);
      return reset;
    }

    if (stored.migrated) {
      writePayload(stored.payload);
    }

    return stored.payload;
  } catch {
    return { date: today, counts: {} };
  }
}

function writePayload(payload: StoredPayload): void {
  if (!isBrowser()) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — in-memory listeners still update.
  }
}

function readAll(): TodoCounts {
  return readPayload().counts;
}

function writeAll(counts: TodoCounts): void {
  writePayload({ date: localDateKey(), counts });
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

  const emit = () => {
    listener(readAll());
  };

  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<TodoCounts>).detail;
    if (!detail || typeof detail !== 'object') return;
    listener(detail);
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    emit();
  };

  // Tab left open overnight, or a laptop waking after sleep.
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    emit();
  };

  let midnightTimer: number | undefined;
  const armMidnightReset = () => {
    window.clearTimeout(midnightTimer);
    midnightTimer = window.setTimeout(() => {
      emit();
      armMidnightReset();
    }, msUntilNextLocalMidnight());
  };

  window.addEventListener(CHANGE_EVENT, onCustom as EventListener);
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisible);
  armMidnightReset();

  return () => {
    window.removeEventListener(CHANGE_EVENT, onCustom as EventListener);
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisible);
    window.clearTimeout(midnightTimer);
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
