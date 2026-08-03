'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  SETTINGS,
  getAllSettingsValues,
  getSettingValue,
  setSettingValue,
  subscribeToSettings,
  resolveProductImageSrc,
  isImageProxyEnabled,
  IMAGE_PROXY_SETTING_ID,
  type SettingsValues,
} from './settings';

/**
 * Live map of every registered setting. Updates on toggle + cross-tab storage.
 */
export function useSettings(): {
  values: SettingsValues;
  setValue: (id: string, value: boolean) => void;
  hydrated: boolean;
} {
  const [hydrated, setHydrated] = useState(false);
  const [values, setValues] = useState<SettingsValues>(() => {
    const defaults: SettingsValues = {};
    for (const s of SETTINGS) defaults[s.id] = s.defaultValue;
    return defaults;
  });

  useEffect(() => {
    setValues(getAllSettingsValues());
    setHydrated(true);

    return subscribeToSettings((id, value) => {
      setValues((prev) => {
        if (prev[id] === value) return prev;
        return { ...prev, [id]: value };
      });
    });
  }, []);

  const setValue = useCallback((id: string, value: boolean) => {
    setSettingValue(id, value);
    setValues((prev) => ({ ...prev, [id]: value }));
  }, []);

  return { values, setValue, hydrated };
}

/** Single setting boolean with live updates. */
export function useSetting(id: string): {
  value: boolean;
  setValue: (next: boolean) => void;
  hydrated: boolean;
} {
  const { values, setValue: setAll, hydrated } = useSettings();
  const def = SETTINGS.find((s) => s.id === id);
  const value = values[id] ?? def?.defaultValue ?? false;

  const setValue = useCallback(
    (next: boolean) => {
      setAll(id, next);
    },
    [id, setAll]
  );

  return { value, setValue, hydrated };
}

/**
 * Resolve an image `src` for product UIs.
 * Re-renders when the image-proxy setting flips so cards update immediately.
 */
export function useProxiedImageSrc(
  sourceUrl: string | null | undefined
): string {
  const proxyEnabled = useSyncExternalStore(
    subscribeImageProxy,
    isImageProxyEnabled,
    () => false
  );

  return resolveProductImageSrc(sourceUrl, { proxyEnabled });
}

function subscribeImageProxy(onStoreChange: () => void): () => void {
  return subscribeToSettings((id) => {
    if (id === IMAGE_PROXY_SETTING_ID) onStoreChange();
  });
}

/** Batch-resolve many URLs with the current proxy setting (non-reactive). */
export function resolveProductImageSrcList(
  urls: Array<string | null | undefined>
): string[] {
  const proxyEnabled = getSettingValue(IMAGE_PROXY_SETTING_ID);
  return urls.map((url) => resolveProductImageSrc(url, { proxyEnabled }));
}
