export type OrderStatus =
  | 'ordered'
  | 'processing'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded';

export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded';

export type OrderItemPreview = {
  productName: string;
  productSlug: string;
  variantLabel: string | null;
  quantity: number;
  unitPriceCents: number;
  image: string | null;
};

export type AdminOrderSummary = {
  id: string;
  checkoutSessionId: string;
  userId: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  currency: string;
  subtotalCents: number;
  shippingTotalCents: number;
  totalCents: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  isFulfilled: boolean;
  fulfilledAt: string | null;
  aeOrderId: string | null;
  totalItemsCount: number;
  itemsPreview: OrderItemPreview[];
  cancelReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrderListMeta = {
  currentUserId: string;
  currentUserRole: string;
  canManage: boolean;
  canCancel: boolean;
  canRefund: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type OrderStats = {
  totalOrders: number;
  totalRevenueCents: number;
  unfulfilledCount: number;
  pendingPaymentCount: number;
  byStatus: Record<OrderStatus, number>;
};

export type OrderActionCallbacks = {
  onStatusUpdate?: (order: AdminOrderSummary, status: OrderStatus) => Promise<void> | void;
  onMarkFulfilled?: (order: AdminOrderSummary) => Promise<void> | void;
  onCancelOrder?: (order: AdminOrderSummary, reason?: string) => Promise<void> | void;
};
