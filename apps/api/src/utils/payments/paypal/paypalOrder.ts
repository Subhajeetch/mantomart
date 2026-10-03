import { and, eq, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  checkoutSessionItems,
  checkoutSessions,
  orders,
  productSkus,
  products,
  users,
  type Database,
  type PaymentStatus,
} from '@repo/db';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function moneyValue(cents: number) {
  return (cents / 100).toFixed(2);
}

export async function createPayPalRequestId(
  sessionId: string,
  total: number,
  items: (typeof checkoutSessionItems.$inferSelect)[],
  shipping: NonNullable<typeof checkoutSessions.$inferSelect.shippingSelection>,
) {
  const fingerprint = JSON.stringify({
    sessionId,
    total,
    items: [...items]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => [item.id, item.skuId, item.quantity, item.unitPriceSnapshot, item.productNameSnapshot, item.variantLabelSnapshot]),
    shipping: [...shipping]
      .sort((a, b) => a.itemId.localeCompare(b.itemId))
      .map((option) => [option.itemId, option.quoteId, option.serviceName, option.amountCents]),
  });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  return Array.from(new Uint8Array(hash))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function validatePayPalOrder(
  value: unknown,
  paypalOrderId: string,
  sessionId: string,
  total: number,
) {
  const order = asRecord(value);
  const units = Array.isArray(order?.purchase_units) ? order.purchase_units : [];
  const unit = asRecord(units[0]);
  const amount = asRecord(unit?.amount);
  return order?.id === paypalOrderId &&
    unit?.custom_id === sessionId &&
    unit?.reference_id === sessionId &&
    amount?.currency_code === 'USD' &&
    amount.value === moneyValue(total);
}

export function payPalCaptures(value: unknown) {
  const order = asRecord(value);
  const units = Array.isArray(order?.purchase_units) ? order.purchase_units : [];
  const unit = asRecord(units[0]);
  const payments = asRecord(unit?.payments);
  return Array.isArray(payments?.captures)
    ? payments.captures.map(asRecord).filter((capture): capture is Record<string, unknown> => capture !== null)
    : [];
}

export function shouldApplyPaymentStatus(current: PaymentStatus, next: PaymentStatus) {
  if (current === next || current === 'refunded') return false;
  if (next === 'pending') return false;
  if (current === 'paid') return next === 'refunded';
  if (current === 'failed') return next === 'paid' || next === 'refunded';
  return true;
}

export async function persistPayPalOrder(
  db: Database,
  sessionId: string,
  paypalOrderId: string,
  captureId: string,
  paymentStatus: PaymentStatus,
) {
  const [session] = await db.select().from(checkoutSessions)
    .where(eq(checkoutSessions.id, sessionId)).limit(1);
  if (!session?.addressSnapshot || !session.shippingSelection?.length) {
    throw new Error('PAYPAL_ORDER_SESSION_INVALID');
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user?.email) throw new Error('PAYPAL_ORDER_USER_INVALID');

  const [existing] = await db.select().from(orders)
    .where(eq(orders.checkoutSessionId, session.id)).limit(1);
  if (existing) {
    if (existing.paymentProviderOrderId !== paypalOrderId) {
      throw new Error('PAYPAL_ORDER_SESSION_CONFLICT');
    }
    return await updateExistingOrder(db, session.id, existing, captureId, paymentStatus);
  }

  const items = await db.select().from(checkoutSessionItems)
    .where(eq(checkoutSessionItems.sessionId, session.id));
  if (items.length === 0) throw new Error('PAYPAL_ORDER_ITEMS_MISSING');
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPriceSnapshot, 0);
  const shippingTotal = session.shippingSelection.reduce((sum, option) => sum + option.amountCents, 0);
  const now = new Date();
  const itemSnapshots = await Promise.all(items.map(async (item) => {
    const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
    const [sku] = await db.select().from(productSkus).where(eq(productSkus.id, item.skuId)).limit(1);
    return {
      productId: item.productId,
      skuId: item.skuId,
      aeProductId: product?.aeProductId ?? null,
      aeSkuId: sku?.aeSkuId ?? null,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceSnapshot,
      productName: item.productNameSnapshot,
      productSlug: item.productSlugSnapshot,
      variantLabel: item.variantLabelSnapshot,
      image: item.imageSnapshot,
    };
  }));
  const order = {
    id: nanoid(),
    checkoutSessionId: session.id,
    userId: user.id,
    status: 'ordered' as const,
    paymentStatus,
    paymentMethod: 'paypal',
    paymentProviderOrderId: paypalOrderId,
    paymentTransactionId: captureId,
    currency: 'USD',
    subtotalCents: subtotal,
    shippingTotalCents: shippingTotal,
    totalCents: subtotal + shippingTotal,
    customerName: user.name,
    customerEmail: user.email,
    customerPhone: typeof session.addressSnapshot.phone === 'string' ? session.addressSnapshot.phone : '',
    addressSnapshot: session.addressSnapshot,
    itemsSnapshot: itemSnapshots,
    shippingSnapshot: session.shippingSelection,
    isFulfilled: false,
    fulfilledAt: null,
    aeOrderId: null,
    aeRawRes: null,
    cancelReason: null,
    cancelledAt: null,
    lastAddressChangedAt: null,
    addressChangeHistory: [],
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.batch([
      db.insert(orders).values(order),
      db.update(checkoutSessions).set({
        status: paymentStatus === 'paid' || paymentStatus === 'refunded' ? 'completed' : 'awaiting_payment',
        updatedAt: now,
      }).where(eq(checkoutSessions.id, session.id)),
    ]);
    return { ...order };
  } catch (error) {
    const [concurrentOrder] = await db.select().from(orders)
      .where(eq(orders.checkoutSessionId, session.id)).limit(1);
    if (concurrentOrder?.paymentProviderOrderId === paypalOrderId) {
      return await updateExistingOrder(db, session.id, concurrentOrder, captureId, paymentStatus);
    }
    throw error;
  }
}

async function updateExistingOrder(
  db: Database,
  sessionId: string,
  existing: typeof orders.$inferSelect,
  captureId: string,
  paymentStatus: PaymentStatus,
) {
  if (!shouldApplyPaymentStatus(existing.paymentStatus, paymentStatus)) {
    return existing;
  }
  const now = new Date();
  const statements = [
    db.update(orders).set({
    paymentStatus,
    paymentTransactionId: captureId || existing.paymentTransactionId,
    updatedAt: now,
    }).where(and(eq(orders.id, existing.id), eq(orders.paymentStatus, existing.paymentStatus))),
    paymentStatus === 'paid' || paymentStatus === 'refunded'
    ? db.update(checkoutSessions).set({ status: 'completed', updatedAt: now })
      .where(eq(checkoutSessions.id, sessionId))
    : db.update(checkoutSessions).set({ status: 'awaiting_payment', updatedAt: now })
      .where(and(eq(checkoutSessions.id, sessionId), ne(checkoutSessions.status, 'completed'))),
  ];
  await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  const [updated] = await db.select().from(orders).where(eq(orders.id, existing.id)).limit(1);
  return updated ?? existing;
}
