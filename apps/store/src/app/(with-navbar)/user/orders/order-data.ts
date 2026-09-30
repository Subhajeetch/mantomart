export type CustomerOrder = {
  id: string;
  status: 'ordered' | 'processing' | 'fulfilled' | 'cancelled' | 'refunded';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  paymentMethod: string;
  currency: string;
  subtotalCents: number;
  shippingTotalCents: number;
  totalCents: number;
  customerName: string;
  customerEmail: string;
  address: {
    firstName: string | null;
    lastName: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    countryName: string | null;
    phone: string | null;
  };
  items: Array<{
    productName: string;
    productSlug: string;
    quantity: number;
    unitPriceCents: number;
    variantLabel: string | null;
    image: string | null;
  }>;
  shipping: Array<{
    serviceName: string;
    amountCents: number;
    currency: string;
    minDays: number | null;
    maxDays: number | null;
  }>;
  isFulfilled: boolean;
  fulfilledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type OrderSummary = {
  id: string;
  status: CustomerOrder['status'];
  productName: string;
  image: string | null;
  additionalItemCount: number;
  itemCount: number;
  totalCents: number;
  currency: string;
};

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
};

export async function requestOrderData<T>(path: string): Promise<T> {
  const response = await fetch(
    `${(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}${path}`,
    {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    }
  );
  const body = (await response
    .json()
    .catch(() => null)) as ApiResponse<T> | null;
  if (
    !response.ok ||
    !body ||
    body.success !== true ||
    body.data === undefined
  ) {
    throw new Error(
      body?.error ?? body?.message ?? 'Unable to load order information.'
    );
  }
  return body.data;
}

export function formatOrderMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : 'USD',
    }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

export function formatOrderDate(value: string | null) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function orderStatusLabel(status: CustomerOrder['status']) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
