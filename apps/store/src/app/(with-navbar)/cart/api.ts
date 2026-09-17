export type CartItem = {
  id: string;
  skuId: string;
  quantity: number;
  unitPriceSnapshot: number;
  compareAtPriceSnapshot: number | null;
  productNameSnapshot: string;
  productSlugSnapshot: string;
  variantLabelSnapshot: string | null;
  imageSnapshot: string | null;
  href: string;
};

export type CartData = {
  cartId: string | null;
  mode: 'guest' | 'user';
  guestId: string | null;
  items: CartItem[];
  summary: { itemCount: number; total: number };
};

export type CartSummary = { itemCount: number; total: number };

export type CartMutateResult = {
  summary: CartSummary;
  mode: 'guest' | 'user';
  guestId: string | null;
};

import { syncGuestIdentity, withGuestHeader } from '@/lib/guest-cart';

let summaryCache: { value: CartSummary; expiresAt: number } | null = null;
const SUMMARY_CACHE_TTL_MS = 15_000;

function apiUrl(path: string) {
  return `${(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), withGuestHeader({
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  }));
  const body = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error?: string }
    | null;
  if (!response.ok || !body || body.success !== true) {
    throw new Error(body && 'error' in body ? body.error ?? 'Request failed.' : 'Request failed.');
  }
  // Keep the stored guest token in step with what the API actually applied
  // (persist for guest carts, drop it once the account owns the cart).
  syncGuestIdentity((body as { data?: unknown }).data);
  return body.data;
}

export function getCart() {
  return request<CartData>('/api/store/cart');
}

export async function getCartSummary(force = false) {
  if (!force && summaryCache && summaryCache.expiresAt > Date.now()) {
    return summaryCache.value;
  }
  const value = await request<CartSummary>('/api/store/cart/summary');
  summaryCache = { value, expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS };
  return value;
}

export function cacheCartSummary(value: CartSummary) {
  summaryCache = { value, expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS };
}

export function clearCartSummaryCache() {
  summaryCache = null;
}

export function updateCartItem(itemId: string, quantity: number) {
  return request<CartMutateResult>(`/api/store/cart/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ quantity }),
  });
}

export function removeCartItem(itemId: string) {
  return request<CartMutateResult>(`/api/store/cart/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  });
}

export function startCartCheckout() {
  return request<{ sessionId: string }>('/api/store/checkout/cart', { method: 'POST' });
}
