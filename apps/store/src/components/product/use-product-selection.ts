'use client';

import { useCallback, useMemo, useState } from 'react';

import type { PublicProduct, PublicSku } from './types';

export type ProductSelection = {
  selected: Record<string, string>;
  sku: PublicSku | null;
  quantity: number;
  maxQuantity: number;
  setQuantity: (next: number) => void;
  selectOption: (name: string, value: string) => void;
  matchingSkus: PublicSku[];
  isOptionAvailable: (name: string, value: string) => boolean;
};

function skuMatches(
  sku: PublicSku,
  selected: Record<string, string>,
  ignoreName?: string
): boolean {
  for (const [name, value] of Object.entries(selected)) {
    if (!value) continue;
    if (ignoreName && name === ignoreName) continue;
    if (sku.options[name] !== value) return false;
  }
  return true;
}

function defaultSku(skus: PublicSku[]): PublicSku | null {
  return skus.find((sku) => sku.stock > 0) ?? skus[0] ?? null;
}

export function useProductSelection(product: PublicProduct): ProductSelection {
  const skus = Array.isArray(product.skus) ? product.skus : [];
  const initial = defaultSku(skus);

  const [selected, setSelected] = useState<Record<string, string>>(
    () => initial?.options ?? {}
  );
  const [quantity, setQuantityState] = useState(1);

  const matchingSkus = useMemo(
    () => skus.filter((sku) => skuMatches(sku, selected)),
    [skus, selected]
  );

  const sku = useMemo(() => {
    const exact = matchingSkus.find((item) => {
      const keys = product.optionGroups.map((group) => group.name);
      return keys.every((name) => item.options[name] === selected[name]);
    });
    if (exact) return exact;
    if (product.optionGroups.length === 0) return matchingSkus[0] ?? null;
    const complete = product.optionGroups.every((group) => selected[group.name]);
    return complete ? matchingSkus[0] ?? null : null;
  }, [matchingSkus, product.optionGroups, selected]);

  const maxQuantity = Math.max(1, sku?.stock ?? 1);

  const setQuantity = useCallback(
    (next: number) => {
      const cap = Math.max(1, sku?.stock ?? 1);
      const value = Number.isFinite(next) ? Math.floor(next) : 1;
      setQuantityState(Math.min(cap, Math.max(1, value)));
    },
    [sku?.stock]
  );

  const isOptionAvailable = useCallback(
    (name: string, value: string) => {
      return skus.some(
        (item) =>
          item.stock > 0 &&
          item.options[name] === value &&
          skuMatches(item, selected, name)
      );
    },
    [selected, skus]
  );

  const selectOption = useCallback(
    (name: string, value: string) => {
      setSelected((prev) => {
        const next = { ...prev, [name]: value };
        const match =
          skus.find(
            (item) =>
              item.stock > 0 &&
              item.options[name] === value &&
              skuMatches(item, next)
          ) ??
          skus.find(
            (item) => item.stock > 0 && item.options[name] === value
          ) ??
          skus.find((item) => item.options[name] === value);
        return match?.options ?? next;
      });
      setQuantityState(1);
    },
    [skus]
  );

  return {
    selected,
    sku,
    quantity: Math.min(quantity, maxQuantity),
    maxQuantity,
    setQuantity,
    selectOption,
    matchingSkus,
    isOptionAvailable,
  };
}
