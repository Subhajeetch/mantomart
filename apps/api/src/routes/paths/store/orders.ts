import { Hono } from 'hono';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { orders } from '@repo/db';
import type Env from '@/types/env';
import { errorJson } from '@/utils/http/errorJson';
import {
  requestOriginFromUrl,
  resolveProductImageUrlForClient,
} from '@/utils/images/productImageHost';
import { requireStoreUser } from './cart';

const storeOrders = new Hono<{ Bindings: Env }>();
const PAGE_SIZE = 20;

type OrderRow = typeof orders.$inferSelect;

function serializeOrderSummary(
  order: {
    id: string;
    status: OrderRow['status'];
    itemsSnapshot: OrderRow['itemsSnapshot'];
    totalCents: number;
    currency: string;
  },
  env: Env,
  origin: string
) {
  const itemSnapshots: unknown[] = Array.isArray(order.itemsSnapshot)
    ? order.itemsSnapshot
    : [];
  const firstItem = snapshotRecord(itemSnapshots[0]);
  const productName = snapshotString(firstItem.productName);
  const image = snapshotString(firstItem.image);
  const itemCount = itemSnapshots.reduce<number>((count, value) => {
    const quantity = snapshotRecord(value).quantity;
    return typeof quantity === 'number' &&
      Number.isSafeInteger(quantity) &&
      quantity > 0
      ? count + quantity
      : count;
  }, 0);

  return {
    id: order.id,
    status: order.status,
    productName: productName ?? 'Order items',
    image: image
      ? resolveProductImageUrlForClient(image, env, { origin }) || image
      : null,
    additionalItemCount: Math.max(0, itemSnapshots.length - 1),
    itemCount,
    totalCents: order.totalCents,
    currency: order.currency,
  };
}

function isoDate(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString()
    : null;
}

function snapshotRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function snapshotString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function serializeAddress(value: unknown) {
  const address = snapshotRecord(value);
  return {
    firstName: snapshotString(address.firstName),
    lastName: snapshotString(address.lastName),
    addressLine1: snapshotString(address.addressLine1),
    addressLine2: snapshotString(address.addressLine2),
    city: snapshotString(address.city),
    state: snapshotString(address.state),
    postalCode: snapshotString(address.postalCode),
    countryName: snapshotString(address.countryName),
    phone: snapshotString(address.phone),
  };
}

function serializeOrder(order: OrderRow, env: Env, origin: string) {
  const itemSnapshots: unknown[] = Array.isArray(order.itemsSnapshot)
    ? order.itemsSnapshot
    : [];
  const shippingSnapshots: unknown[] = Array.isArray(order.shippingSnapshot)
    ? order.shippingSnapshot
    : [];

  return {
    id: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    shippingTotalCents: order.shippingTotalCents,
    totalCents: order.totalCents,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    address: serializeAddress(order.addressSnapshot),
    items: itemSnapshots.flatMap((value) => {
      const item = snapshotRecord(value);
      const productName = snapshotString(item.productName);
      const productSlug = snapshotString(item.productSlug);
      const quantity = item.quantity;
      const unitPriceCents = item.unitPriceCents;
      if (
        !productName ||
        !productSlug ||
        typeof quantity !== 'number' ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        typeof unitPriceCents !== 'number' ||
        !Number.isSafeInteger(unitPriceCents) ||
        unitPriceCents < 0
      )
        return [];
      const image = snapshotString(item.image);
      return [
        {
          productName,
          productSlug,
          quantity,
          unitPriceCents,
          variantLabel: snapshotString(item.variantLabel),
          image: image
            ? resolveProductImageUrlForClient(image, env, { origin }) || image
            : null,
        },
      ];
    }),
    shipping: shippingSnapshots.flatMap((value) => {
      const shipping = snapshotRecord(value);
      const serviceName = snapshotString(shipping.serviceName);
      const amountCents = shipping.amountCents;
      const currency = snapshotString(shipping.currency);
      if (
        !serviceName ||
        typeof amountCents !== 'number' ||
        !Number.isSafeInteger(amountCents) ||
        amountCents < 0 ||
        !currency
      )
        return [];
      const deliveryDays = (days: unknown) =>
        typeof days === 'number' && Number.isSafeInteger(days) && days >= 0
          ? days
          : null;
      return [
        {
          serviceName,
          amountCents,
          currency,
          minDays: deliveryDays(shipping.minDays),
          maxDays: deliveryDays(shipping.maxDays),
        },
      ];
    }),
    isFulfilled: order.isFulfilled,
    fulfilledAt: isoDate(order.fulfilledAt),
    createdAt: isoDate(order.createdAt),
    updatedAt: isoDate(order.updatedAt),
  };
}

storeOrders.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  c.header('Pragma', 'no-cache');
  c.header('Vary', 'Cookie');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});

storeOrders.get('/', async (c) => {
  try {
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;

    const cursor = c.req.query('cursor')?.trim();
    if (cursor && (cursor.length > 128 || !/^[0-9a-zA-Z_-]+$/.test(cursor))) {
      return errorJson(
        c,
        400,
        'INVALID_CURSOR',
        'The order page cursor is invalid.'
      );
    }

    let cursorOrder: { id: string; createdAt: Date } | undefined;
    if (cursor) {
      [cursorOrder] = await access.db
        .select({ id: orders.id, createdAt: orders.createdAt })
        .from(orders)
        .where(and(eq(orders.id, cursor), eq(orders.userId, access.user.id)))
        .limit(1);
      if (!cursorOrder) {
        return errorJson(
          c,
          400,
          'INVALID_CURSOR',
          'The order page cursor is invalid.'
        );
      }
    }

    const conditions = [eq(orders.userId, access.user.id)];
    if (cursorOrder) {
      conditions.push(
        or(
          lt(orders.createdAt, cursorOrder.createdAt),
          and(
            eq(orders.createdAt, cursorOrder.createdAt),
            lt(orders.id, cursorOrder.id)
          )
        )!
      );
    }

    const rows = await access.db
      .select({
        id: orders.id,
        status: orders.status,
        itemsSnapshot: orders.itemsSnapshot,
        totalCents: orders.totalCents,
        currency: orders.currency,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(PAGE_SIZE + 1);
    const hasMore = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    const origin = requestOriginFromUrl(c.req.url);

    return c.json({
      success: true,
      data: {
        orders: page.map((order) =>
          serializeOrderSummary(order, c.env, origin)
        ),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      },
    });
  } catch (error) {
    console.error('store orders: list failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to load your orders.');
  }
});

storeOrders.get('/:orderId', async (c) => {
  try {
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;

    const orderId = c.req.param('orderId')?.trim();
    if (!orderId || orderId.length > 128) {
      return errorJson(
        c,
        400,
        'INVALID_ORDER',
        'The order reference is invalid.'
      );
    }

    const [order] = await access.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, access.user.id)))
      .limit(1);
    if (!order) return errorJson(c, 404, 'ORDER_NOT_FOUND', 'Order not found.');

    return c.json({
      success: true,
      data: {
        order: serializeOrder(order, c.env, requestOriginFromUrl(c.req.url)),
      },
    });
  } catch (error) {
    console.error('store orders: detail load failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to load this order.');
  }
});

storeOrders.all('*', (c) =>
  errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
);

export default storeOrders;
