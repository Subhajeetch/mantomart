import { OrderStatus, PaymentStatus } from './types';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function getOrdersApiBase(): string {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  return origin ? `${origin}/api/admin/orders` : '/api/admin/orders';
}

export async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getOrdersApiBase();
  const url = path.startsWith('http')
    ? path
    : `${base}${path.startsWith('/') ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      'Unable to reach the server. Check that the API is running.',
      0
    );
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    if (response.status === 404) {
      throw new ApiError('Orders endpoint not found.', 404, 'NOT_FOUND');
    }
    if (!response.ok) {
      throw new ApiError(`Request failed with status ${response.status}.`, response.status);
    }
    throw new ApiError('Server returned an invalid response.', response.status);
  }

  if (!response.ok) {
    const errorBody = data as { error?: string; message?: string; code?: string };
    const message =
      errorBody.error ||
      errorBody.message ||
      (response.status === 401
        ? 'You must be signed in to manage orders.'
        : response.status === 403
          ? 'You do not have permission to view or manage orders.'
          : response.status === 404
            ? 'Order not found.'
            : `Request failed with status ${response.status}.`);

    throw new ApiError(message, response.status, errorBody.code);
  }

  return data as T;
}

export function formatMoney(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) {
    return '—';
  }
  const dollars = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(dollars);
  } catch {
    return `$${dollars.toFixed(2)} ${currency}`;
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function getOrderStatusBadgeVariant(
  status: OrderStatus
): { variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string; className: string } {
  switch (status) {
    case 'ordered':
      return {
        variant: 'secondary',
        label: 'Ordered',
        className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 hover:bg-blue-500/20',
      };
    case 'processing':
      return {
        variant: 'secondary',
        label: 'Processing',
        className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20',
      };
    case 'fulfilled':
      return {
        variant: 'secondary',
        label: 'Fulfilled',
        className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20',
      };
    case 'cancelled':
      return {
        variant: 'destructive',
        label: 'Cancelled',
        className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 hover:bg-red-500/20',
      };
    case 'refunded':
      return {
        variant: 'secondary',
        label: 'Refunded',
        className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20 hover:bg-purple-500/20',
      };
    default:
      return {
        variant: 'outline',
        label: status,
        className: '',
      };
  }
}

export function getPaymentStatusBadgeVariant(
  status: PaymentStatus
): { label: string; className: string } {
  switch (status) {
    case 'paid':
      return {
        label: 'Paid',
        className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      };
    case 'pending':
      return {
        label: 'Pending',
        className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      };
    case 'failed':
      return {
        label: 'Failed',
        className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
      };
    case 'refunded':
      return {
        label: 'Refunded',
        className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
      };
    default:
      return {
        label: status,
        className: '',
      };
  }
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  ordered: 'Ordered',
  processing: 'Processing',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'Paid',
  pending: 'Pending',
  failed: 'Failed',
  refunded: 'Refunded',
};
