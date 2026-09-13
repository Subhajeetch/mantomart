import {
  cacheCartSummary,
  removeCartItem,
  updateCartItem,
  type CartSummary,
} from '@/app/(with-navbar)/cart/api';

export type CartActionInput = {
  productId: string;
  slug: string;
  skuId: string | null;
  quantity: number;
};

function apiUrl(path: string): string {
  const origin = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';
  return `${origin}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error?: string }
    | null;
  if (!response.ok || !payload || payload.success !== true) {
    throw new Error(payload && 'error' in payload ? payload.error ?? 'Request failed.' : 'Request failed.');
  }
  return payload.data;
}

export async function addToCart(input: CartActionInput): Promise<{
  itemId: string;
  previousQuantity: number;
  quantity: number;
  summary: CartSummary;
}> {
  if (!input.skuId) throw new Error('Select a product variant first.');
  const result = await request<{
    itemId: string;
    previousQuantity: number;
    quantity: number;
    summary: CartSummary;
  }>('/api/store/cart/items', {
    method: 'POST',
    body: JSON.stringify({ skuId: input.skuId, quantity: input.quantity }),
  });
  cacheCartSummary(result.summary);
  return result;
}

export async function undoAddToCart(
  itemId: string,
  previousQuantity: number
): Promise<CartSummary> {
  const result =
    previousQuantity > 0
      ? await updateCartItem(itemId, previousQuantity)
      : await removeCartItem(itemId);
  cacheCartSummary(result.summary);
  return result.summary;
}

export async function handleBuyNow(input: CartActionInput): Promise<void> {
  if (!input.skuId) throw new Error('Select a product variant first.');
  const result = await request<{ sessionId: string }>('/api/store/checkout/buy-now', {
    method: 'POST',
    body: JSON.stringify({ skuId: input.skuId, quantity: input.quantity }),
  });
  window.location.assign(`/checkout/${encodeURIComponent(result.sessionId)}`);
}
