/**
 * Admin settings registry + client storage.
 *
 * Add new settings here (name, description, default, type). The settings page
 * renders from this list — no UI rewrite needed for simple toggles.
 *
 * Image proxy helpers live here so product pages can resolve AliExpress CDN
 * URLs through the authenticated Worker proxy when the setting is on.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SettingType = 'toggle';

export type SettingCategoryId = 'media' | 'general' | 'advanced';

export type SettingDefinition = {
  /** Stable machine id — used as the storage key suffix. */
  id: string;
  name: string;
  description: string;
  type: SettingType;
  defaultValue: boolean;
  category: SettingCategoryId;
  /** Optional badge / hint shown next to the name. */
  badge?: string;
};

export type SettingCategory = {
  id: SettingCategoryId;
};

export type SettingsValues = Record<string, boolean>;

// ─── Categories ───────────────────────────────────────────────────────────────

export const SETTING_CATEGORIES: SettingCategory[] = [
  {
    id: 'media',
  },
  {
    id: 'general',
  },
  {
    id: 'advanced',
  },
];

// ─── Settings registry ────────────────────────────────────────────────────────

/**
 * Single source of truth for every admin setting.
 * To add a setting later: push an entry here — the page picks it up automatically.
 */
export const SETTINGS: SettingDefinition[] = [
  {
    id: 'image-proxy',
    name: 'Image proxy',
    description: 'Used for Aliexpress images',
    type: 'toggle',
    defaultValue: false,
    category: 'media',
  },
  {
    id: 'todo-animations',
    name: 'Todo Animations',
    description: 'eg: Todo animation when adding a product',
    type: 'toggle',
    defaultValue: true,
    category: 'general',
  },
];

export const IMAGE_PROXY_SETTING_ID = 'image-proxy' as const;
export const TODO_ANIMATIONS_SETTING_ID = 'todo-animations' as const;

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'admin:settings:v1:';
const STORAGE_EVENT = 'admin:settings:change';

export function settingStorageKey(id: string): string {
  return `${STORAGE_PREFIX}${id}`;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function parseBoolean(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return fallback;
}

/** Read one setting from localStorage (SSR-safe — returns default on server). */
export function getSettingValue(id: string): boolean {
  const def = SETTINGS.find((s) => s.id === id);
  const fallback = def?.defaultValue ?? false;
  if (!isBrowser()) return fallback;

  try {
    return parseBoolean(localStorage.getItem(settingStorageKey(id)), fallback);
  } catch {
    return fallback;
  }
}

/** Persist one setting and notify other hooks / tabs. */
export function setSettingValue(id: string, value: boolean): void {
  if (!isBrowser()) return;

  try {
    localStorage.setItem(settingStorageKey(id), value ? 'true' : 'false');
  } catch {
    // Quota / private mode — still dispatch so in-memory UI updates.
  }

  window.dispatchEvent(
    new CustomEvent(STORAGE_EVENT, {
      detail: { id, value },
    })
  );
}

/** Snapshot of all registered settings. */
export function getAllSettingsValues(): SettingsValues {
  const values: SettingsValues = {};
  for (const setting of SETTINGS) {
    values[setting.id] = getSettingValue(setting.id);
  }
  return values;
}

/** Reset every setting to its default. */
export function resetAllSettings(): void {
  for (const setting of SETTINGS) {
    setSettingValue(setting.id, setting.defaultValue);
  }
}

export function getSettingsByCategory(
  categoryId: SettingCategoryId
): SettingDefinition[] {
  return SETTINGS.filter((s) => s.category === categoryId);
}

/** Subscribe to setting changes (same tab + cross-tab storage). Returns unsubscribe. */
export function subscribeToSettings(
  listener: (id: string, value: boolean) => void
): () => void {
  if (!isBrowser()) return () => undefined;

  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<{ id?: string; value?: boolean }>).detail;
    if (!detail || typeof detail.id !== 'string' || typeof detail.value !== 'boolean') {
      return;
    }
    listener(detail.id, detail.value);
  };

  const onStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith(STORAGE_PREFIX)) return;
    const id = event.key.slice(STORAGE_PREFIX.length);
    if (!id) return;
    const def = SETTINGS.find((s) => s.id === id);
    listener(id, parseBoolean(event.newValue, def?.defaultValue ?? false));
  };

  window.addEventListener(STORAGE_EVENT, onCustom as EventListener);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(STORAGE_EVENT, onCustom as EventListener);
    window.removeEventListener('storage', onStorage);
  };
}

// ─── Image proxy (AliExpress CDN only) ────────────────────────────────────────

/**
 * Hosts we will send through the Worker proxy.
 * Keep tight — the API enforces the same allowlist server-side.
 */
const ALIEXPRESS_IMAGE_HOST_RE =
  /^(?:[a-z0-9-]+\.)*(?:alicdn\.com|aliexpress-media\.com|aliexpress\.com|alibaba\.com)$/i;

export function isAliExpressImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;

  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return false;
  }

  try {
    const absolute = normalizeToAbsoluteUrl(trimmed);
    if (!absolute) return false;
    const parsed = new URL(absolute);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return ALIEXPRESS_IMAGE_HOST_RE.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** Protocol-relative and bare hosts → https absolute URL. */
export function normalizeToAbsoluteUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('/')) return null;
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  return `https://${raw}`;
}

function getImageProxyApiBase(): string {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  // Prefer absolute API origin so session cookies (host-only on the API in
  // local dev, shared Domain cookie in prod) are attached to <img> requests.
  return origin ? `${origin}/api/admin/image-proxy` : '/api/admin/image-proxy';
}

/**
 * Build the authenticated proxy URL for an AliExpress image.
 * Does not check the setting — callers decide when to use this.
 */
export function buildImageProxyUrl(sourceUrl: string): string | null {
  const absolute = normalizeToAbsoluteUrl(sourceUrl);
  if (!absolute || !isAliExpressImageUrl(absolute)) return null;

  const base = getImageProxyApiBase();
  const params = new URLSearchParams();
  params.set('url', absolute);
  return `${base}?${params.toString()}`;
}

/**
 * Resolve a product image URL for display.
 * When the image-proxy setting is on and the URL is an AliExpress CDN image,
 * returns the Worker proxy URL; otherwise returns the original (normalized) URL.
 */
export function resolveProductImageSrc(
  sourceUrl: string | null | undefined,
  options?: { proxyEnabled?: boolean }
): string {
  if (!sourceUrl) return '';

  const absolute = normalizeToAbsoluteUrl(sourceUrl) ?? sourceUrl.trim();
  const proxyEnabled =
    options?.proxyEnabled ?? getSettingValue(IMAGE_PROXY_SETTING_ID);

  if (!proxyEnabled || !isAliExpressImageUrl(absolute)) {
    return absolute;
  }

  return buildImageProxyUrl(absolute) ?? absolute;
}

export function isImageProxyEnabled(): boolean {
  return getSettingValue(IMAGE_PROXY_SETTING_ID);
}
