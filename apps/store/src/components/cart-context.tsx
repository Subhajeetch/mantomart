'use client';

import * as React from 'react';

import {
  cacheCartSummary,
  getCart,
  getCartSummary,
  removeCartItem,
  updateCartItem,
  type CartData,
  type CartItem,
  type CartSummary,
} from '@/app/(with-navbar)/cart/api';

export type CartItemUpdate = Parameters<typeof updateCartItem>[1];

type CartContextValue = {
  summary: CartSummary | null;
  cart: CartData | null;
  items: CartItem[];
  summaryLoading: boolean;
  cartLoading: boolean;
  error: string | null;
  busyIds: ReadonlySet<string>;
  refreshSummary: (force?: boolean) => Promise<CartSummary>;
  refreshCart: () => Promise<CartData>;
  updateItem: (itemId: string, update: CartItemUpdate) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  isItemBusy: (itemId: string) => boolean;
  clearError: () => void;
};

const CartContext = React.createContext<CartContextValue | null>(null);

function getErrorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function useCart() {
  const value = React.useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside CartProvider');
  return value;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [summary, setSummary] = React.useState<CartSummary | null>(null);
  const [cart, setCart] = React.useState<CartData | null>(null);
  const [summaryLoading, setSummaryLoading] = React.useState(true);
  const [cartLoading, setCartLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busyIds, setBusyIds] = React.useState<ReadonlySet<string>>(() => new Set());

  const refreshSummary = React.useCallback(async (force = false) => {
    const next = await getCartSummary(force);
    setSummary(next);
    return next;
  }, []);

  const refreshCart = React.useCallback(async () => {
    setCartLoading(true);
    try {
      const next = await getCart();
      setCart(next);
      setSummary(next.summary);
      cacheCartSummary(next.summary);
      setError(null);
      return next;
    } catch (reason) {
      const message = getErrorMessage(reason, 'Unable to load your cart.');
      setError(message);
      throw reason;
    } finally {
      setCartLoading(false);
    }
  }, []);

  const setBusy = React.useCallback((itemId: string, busy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);

  const updateItem = React.useCallback(async (itemId: string, update: CartItemUpdate) => {
    setBusy(itemId, true);
    try {
      const result = await updateCartItem(itemId, update);
      setSummary(result.summary);
      cacheCartSummary(result.summary);
      await refreshCart();
      setError(null);
    } catch (reason) {
      setError(getErrorMessage(reason, 'Unable to update the item.'));
      throw reason;
    } finally {
      setBusy(itemId, false);
    }
  }, [refreshCart, setBusy]);

  const removeItem = React.useCallback(async (itemId: string) => {
    setBusy(itemId, true);
    try {
      const result = await removeCartItem(itemId);
      setSummary(result.summary);
      cacheCartSummary(result.summary);
      await refreshCart();
      setError(null);
    } catch (reason) {
      setError(getErrorMessage(reason, 'Unable to remove the item.'));
      throw reason;
    } finally {
      setBusy(itemId, false);
    }
  }, [refreshCart, setBusy]);

  React.useEffect(() => {
    let cancelled = false;
    void refreshSummary()
      .catch((reason) => {
        if (!cancelled) setError(getErrorMessage(reason, 'Unable to load your cart summary.'));
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });

    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<CartSummary>).detail;
      if (detail && typeof detail.itemCount === 'number') {
        cacheCartSummary(detail);
        setSummary(detail);
        return;
      }
      void refreshSummary(true).catch(() => undefined);
    };
    window.addEventListener('cart-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('cart-updated', refresh);
    };
  }, [refreshSummary]);

  const value = React.useMemo<CartContextValue>(() => ({
    summary,
    cart,
    items: cart?.items ?? [],
    summaryLoading,
    cartLoading,
    error,
    busyIds,
    refreshSummary,
    refreshCart,
    updateItem,
    removeItem,
    isItemBusy: (itemId: string) => busyIds.has(itemId),
    clearError: () => setError(null),
  }), [summary, cart, summaryLoading, cartLoading, error, busyIds, refreshSummary, refreshCart, updateItem, removeItem]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
