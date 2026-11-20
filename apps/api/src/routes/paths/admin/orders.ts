import { Hono } from 'hono';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  like,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  orders,
  orderStatuses,
  paymentStatuses,
  type Database,
  type OrderItemSnapshot,
  type OrderStatus,
  type PaymentStatus,
} from '@repo/db';
import { errorJson, type AppContext, type AppEnv } from '@/utils/http/errorJson';
import { adminHasPermission } from '@/utils/authorization/permissions';
import {
  getActor,
  getDb,
  requireAdminMiddleware,
  requireAnyPermission,
  requirePermission,
} from '@/middleware/permission';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  buildChanges,
  logAuditFromContext,
} from '@/utils/admin/auditLog';
import { resolveProductImageUrlForClient } from '@/utils/images/productImageHost';
import type Env from '@/types/env';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ID_LENGTH = 128;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const MAX_SEARCH_LENGTH = 100;
const MAX_REASON_LENGTH = 500;
const MAX_AE_ORDER_ID_LENGTH = 64;

const SORTABLE_COLUMNS = [
  'createdAt',
  'totalCents',
  'status',
  'customerName',
  'updatedAt',
] as const;
type SortColumn = (typeof SORTABLE_COLUMNS)[number];

// ─── Validation Helpers ───────────────────────────────────────────────────────

function isValidId(id: string): boolean {
  if (!id || id.length > MAX_ID_LENGTH) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function sanitizeSearch(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_SEARCH_LENGTH
    ? trimmed
    : null;
}

function sanitizeStatus(value: unknown): OrderStatus | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return (orderStatuses as readonly string[]).includes(trimmed)
    ? (trimmed as OrderStatus)
    : null;
}

function sanitizePaymentStatus(value: unknown): PaymentStatus | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return (paymentStatuses as readonly string[]).includes(trimmed)
    ? (trimmed as PaymentStatus)
    : null;
}

function sanitizeSortBy(value: unknown): SortColumn {
  if (typeof value !== 'string') return 'createdAt';
  return (SORTABLE_COLUMNS as readonly string[]).includes(value as SortColumn)
    ? (value as SortColumn)
    : 'createdAt';
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value.trim());
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readJsonObject(
  c: AppContext
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return {
      ok: false,
      response: errorJson(
        c,
        400,
        'INVALID_BODY',
        'Request body must be valid JSON.'
      ),
    };
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      response: errorJson(
        c,
        400,
        'INVALID_BODY',
        'Request body must be a JSON object.'
      ),
    };
  }

  return { ok: true, body: body as Record<string, unknown> };
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

async function resolveOrderCapabilities(
  db: Database,
  actorId: string,
  actorRole: string
) {
  if (actorRole === 'owner') {
    return {
      canRead: true,
      canManage: true,
      canCancel: true,
      canRefund: true,
    };
  }

  const [canRead, canManage, canCancel, canRefund] = await Promise.all([
    adminHasPermission(db, actorId, PERMISSIONS.ORDER_READ),
    adminHasPermission(db, actorId, PERMISSIONS.ORDER_MANAGE),
    adminHasPermission(db, actorId, PERMISSIONS.ORDER_CANCEL),
    adminHasPermission(db, actorId, PERMISSIONS.ORDER_REFUND),
  ]);

  return {
    canRead: canRead || canManage,
    canManage,
    canCancel: canCancel || canManage,
    canRefund: canRefund || canManage,
  };
}

// ─── Serializers ──────────────────────────────────────────────────────────────

type OrderRow = typeof orders.$inferSelect;

function serializeOrderSummary(
  order: OrderRow,
  env: Env,
  origin: string
) {
  const itemSnapshots: OrderItemSnapshot[] = Array.isArray(order.itemsSnapshot)
    ? order.itemsSnapshot
    : [];

  let totalItemsCount = 0;
  const itemsPreview: Array<{
    productName: string;
    productSlug: string;
    variantLabel: string | null;
    quantity: number;
    unitPriceCents: number;
    image: string | null;
  }> = [];

  for (const item of itemSnapshots) {
    if (!item || typeof item !== 'object') continue;
    const qty = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
    totalItemsCount += qty;

    if (itemsPreview.length < 3) {
      const rawImage = typeof item.image === 'string' && item.image.trim() ? item.image : null;
      const resolvedImage = rawImage
        ? resolveProductImageUrlForClient(rawImage, env, { origin }) || rawImage
        : null;

      itemsPreview.push({
        productName: String(item.productName || 'Product'),
        productSlug: String(item.productSlug || ''),
        variantLabel: item.variantLabel ? String(item.variantLabel) : null,
        quantity: qty,
        unitPriceCents: typeof item.unitPriceCents === 'number' ? item.unitPriceCents : 0,
        image: resolvedImage,
      });
    }
  }

  return {
    id: order.id,
    checkoutSessionId: order.checkoutSessionId,
    userId: order.userId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    shippingTotalCents: order.shippingTotalCents,
    totalCents: order.totalCents,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    isFulfilled: Boolean(order.isFulfilled),
    fulfilledAt: toIso(order.fulfilledAt),
    aeOrderId: order.aeOrderId,
    totalItemsCount,
    itemsPreview,
    cancelReason: order.cancelReason,
    cancelledAt: toIso(order.cancelledAt),
    createdAt: toIso(order.createdAt),
    updatedAt: toIso(order.updatedAt),
  };
}

function serializeOrderDetail(
  order: OrderRow,
  env: Env,
  origin: string
) {
  const itemSnapshots: OrderItemSnapshot[] = Array.isArray(order.itemsSnapshot)
    ? order.itemsSnapshot
    : [];

  const items = itemSnapshots.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const rawImage = typeof item.image === 'string' && item.image.trim() ? item.image : null;
    const resolvedImage = rawImage
      ? resolveProductImageUrlForClient(rawImage, env, { origin }) || rawImage
      : null;

    return {
      ...item,
      image: resolvedImage,
    };
  });

  return {
    id: order.id,
    checkoutSessionId: order.checkoutSessionId,
    userId: order.userId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    paymentProviderOrderId: order.paymentProviderOrderId,
    paymentTransactionId: order.paymentTransactionId,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    shippingTotalCents: order.shippingTotalCents,
    totalCents: order.totalCents,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    addressSnapshot: order.addressSnapshot,
    itemsSnapshot: items,
    shippingSnapshot: order.shippingSnapshot,
    isFulfilled: Boolean(order.isFulfilled),
    fulfilledAt: toIso(order.fulfilledAt),
    aeOrderId: order.aeOrderId,
    aeRawRes: order.aeRawRes,
    cancelReason: order.cancelReason,
    cancelledAt: toIso(order.cancelledAt),
    lastAddressChangedAt: toIso(order.lastAddressChangedAt),
    addressChangeHistory: order.addressChangeHistory,
    createdAt: toIso(order.createdAt),
    updatedAt: toIso(order.updatedAt),
  };
}

// ─── Query Builders ───────────────────────────────────────────────────────────

function buildWhere(filters: {
  search: string | null;
  status: OrderStatus | null;
  paymentStatus: PaymentStatus | null;
  isFulfilled: boolean | null;
  from: Date | null;
  to: Date | null;
}): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.search) {
    const escaped = filters.search
      .toLowerCase()
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    const likePattern = `%${escaped}%`;

    conditions.push(
      or(
        like(sql`lower(${orders.id})`, likePattern),
        like(sql`lower(${orders.customerName})`, likePattern),
        like(sql`lower(${orders.customerEmail})`, likePattern),
        like(sql`lower(${orders.customerPhone})`, likePattern),
        like(sql`lower(coalesce(${orders.aeOrderId}, ''))`, likePattern)
      )!
    );
  }

  if (filters.status) {
    conditions.push(eq(orders.status, filters.status));
  }

  if (filters.paymentStatus) {
    conditions.push(eq(orders.paymentStatus, filters.paymentStatus));
  }

  if (filters.isFulfilled !== null) {
    conditions.push(eq(orders.isFulfilled, filters.isFulfilled));
  }

  if (filters.from) {
    conditions.push(gte(orders.createdAt, filters.from));
  }

  if (filters.to) {
    conditions.push(lte(orders.createdAt, filters.to));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function buildOrderBy(sortBy: SortColumn, sortOrder: 'asc' | 'desc') {
  const columnMap = {
    createdAt: orders.createdAt,
    totalCents: orders.totalCents,
    status: orders.status,
    customerName: orders.customerName,
    updatedAt: orders.updatedAt,
  } as const;

  const column = columnMap[sortBy];
  return sortOrder === 'asc' ? asc(column) : desc(column);
}

// ─── Router ───────────────────────────────────────────────────────────────────

const adminOrdersRouter = new Hono<AppEnv>();

// All routes require authenticated admin/owner
adminOrdersRouter.use('*', requireAdminMiddleware);

// ─── List Orders (GET / and GET /all) ─────────────────────────────────────────

async function listOrdersHandler(c: AppContext) {
  const actor = getActor(c);
  const db = getDb(c);

  // Check read permission
  const capabilities = await resolveOrderCapabilities(db, actor.id, actor.role);
  if (!capabilities.canRead) {
    return errorJson(
      c,
      403,
      'INSUFFICIENT_PERMISSION',
      `Requires permission: ${PERMISSIONS.ORDER_READ}`
    );
  }

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      parseInt(c.req.query('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) ||
        DEFAULT_PAGE_SIZE
    )
  );

  const search = sanitizeSearch(c.req.query('search'));
  const status = sanitizeStatus(c.req.query('status'));
  const paymentStatus = sanitizePaymentStatus(c.req.query('paymentStatus'));

  let isFulfilled: boolean | null = null;
  const rawIsFulfilled = c.req.query('isFulfilled');
  if (rawIsFulfilled === 'true') isFulfilled = true;
  else if (rawIsFulfilled === 'false') isFulfilled = false;

  const from = parseTimestamp(c.req.query('from'));
  const to = parseTimestamp(c.req.query('to'));

  if (from && to && from.getTime() > to.getTime()) {
    return errorJson(
      c,
      400,
      'INVALID_DATE_RANGE',
      '`from` must be before or equal to `to`.'
    );
  }

  const sortBy = sanitizeSortBy(c.req.query('sortBy'));
  const sortOrder = c.req.query('sortOrder') === 'asc' ? 'asc' : 'desc';

  try {
    const where = buildWhere({
      search,
      status,
      paymentStatus,
      isFulfilled,
      from,
      to,
    });
    const orderBy = buildOrderBy(sortBy, sortOrder);

    const [totalResult, rows] = await Promise.all([
      db.select({ value: count() }).from(orders).where(where),
      db
        .select()
        .from(orders)
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(totalResult[0]?.value ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const origin = new URL(c.req.url).origin;

    return c.json({
      success: true,
      data: rows.map((order) => serializeOrderSummary(order, c.env, origin)),
      meta: {
        currentUserId: actor.id,
        currentUserRole: actor.role,
        canManage: capabilities.canManage,
        canCancel: capabilities.canCancel,
        canRefund: capabilities.canRefund,
        total,
        page,
        pageSize,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Error listing orders:', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load orders.');
  }
}

adminOrdersRouter.get('/all', listOrdersHandler);
adminOrdersRouter.get('/', listOrdersHandler);

// ─── GET /stats — Aggregated metrics ──────────────────────────────────────────

adminOrdersRouter.get(
  '/stats',
  requireAnyPermission(PERMISSIONS.ORDER_READ, PERMISSIONS.ORDER_MANAGE),
  async (c) => {
    const db = getDb(c);

    try {
      const rows = await db
        .select({
          id: orders.id,
          status: orders.status,
          paymentStatus: orders.paymentStatus,
          totalCents: orders.totalCents,
          isFulfilled: orders.isFulfilled,
        })
        .from(orders);

      let totalOrders = rows.length;
      let totalRevenueCents = 0;
      let unfulfilledCount = 0;
      let pendingPaymentCount = 0;

      const byStatus: Record<string, number> = {
        ordered: 0,
        processing: 0,
        fulfilled: 0,
        cancelled: 0,
        refunded: 0,
      };

      for (const row of rows) {
        if (row.status in byStatus) {
          byStatus[row.status] += 1;
        }

        if (row.paymentStatus === 'paid' && row.status !== 'refunded') {
          totalRevenueCents += row.totalCents;
        }

        if (row.paymentStatus === 'pending') {
          pendingPaymentCount += 1;
        }

        if (!row.isFulfilled && row.status !== 'cancelled' && row.status !== 'refunded') {
          unfulfilledCount += 1;
        }
      }

      return c.json({
        success: true,
        data: {
          totalOrders,
          totalRevenueCents,
          unfulfilledCount,
          pendingPaymentCount,
          byStatus,
        },
      });
    } catch (error) {
      console.error('Error getting order stats:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load order statistics.');
    }
  }
);

// ─── GET /:id — Order Details ─────────────────────────────────────────────────

adminOrdersRouter.get(
  '/:id',
  requireAnyPermission(PERMISSIONS.ORDER_READ, PERMISSIONS.ORDER_MANAGE),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);
    const id = c.req.param('id');

    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid order ID format.');
    }

    try {
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1);

      if (!order) {
        return errorJson(c, 404, 'ORDER_NOT_FOUND', 'Order not found.');
      }

      const capabilities = await resolveOrderCapabilities(db, actor.id, actor.role);
      const origin = new URL(c.req.url).origin;

      return c.json({
        success: true,
        data: serializeOrderDetail(order, c.env, origin),
        meta: {
          canManage: capabilities.canManage,
          canCancel: capabilities.canCancel,
          canRefund: capabilities.canRefund,
        },
      });
    } catch (error) {
      console.error('Error fetching order detail:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to load order details.');
    }
  }
);

// ─── PATCH /:id — Update Order Status / Tracking ──────────────────────────────

adminOrdersRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.ORDER_MANAGE),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);
    const id = c.req.param('id');

    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid order ID format.');
    }

    const bodyResult = await readJsonObject(c);
    if (!bodyResult.ok) return bodyResult.response;
    const body = bodyResult.body;

    const allowedFields = ['status', 'isFulfilled', 'aeOrderId', 'cancelReason'] as const;
    const unknownKeys = Object.keys(body).filter(
      (k) => !(allowedFields as readonly string[]).includes(k)
    );
    if (unknownKeys.length > 0) {
      return errorJson(
        c,
        400,
        'UNKNOWN_FIELDS',
        `Unknown fields: ${unknownKeys.slice(0, 5).join(', ')}.`
      );
    }

    try {
      const [current] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1);

      if (!current) {
        return errorJson(c, 404, 'ORDER_NOT_FOUND', 'Order not found.');
      }

      const updates: Partial<typeof orders.$inferInsert> = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};

      if ('status' in body) {
        const nextStatus = sanitizeStatus(body.status);
        if (!nextStatus) {
          return errorJson(
            c,
            400,
            'INVALID_STATUS',
            `Status must be one of: ${orderStatuses.join(', ')}.`
          );
        }

        if (nextStatus !== current.status) {
          // Disallow moving out of cancelled or refunded without explicit logic
          if (current.status === 'cancelled' && nextStatus !== 'cancelled') {
            return errorJson(
              c,
              400,
              'INVALID_STATUS_TRANSITION',
              'Cancelled orders cannot be reopened.'
            );
          }

          updates.status = nextStatus;
          changes.status = { from: current.status, to: nextStatus };

          if (nextStatus === 'fulfilled' && !current.isFulfilled) {
            updates.isFulfilled = true;
            updates.fulfilledAt = new Date();
            changes.isFulfilled = { from: false, to: true };
          }

          if (nextStatus === 'cancelled' && !current.cancelledAt) {
            updates.cancelledAt = new Date();
            if ('cancelReason' in body && typeof body.cancelReason === 'string') {
              updates.cancelReason = body.cancelReason.trim().slice(0, MAX_REASON_LENGTH);
              changes.cancelReason = { from: current.cancelReason, to: updates.cancelReason };
            }
          }
        }
      }

      if ('isFulfilled' in body) {
        if (typeof body.isFulfilled !== 'boolean') {
          return errorJson(
            c,
            400,
            'INVALID_FULFILLMENT',
            '`isFulfilled` must be a boolean.'
          );
        }

        if (body.isFulfilled !== current.isFulfilled) {
          updates.isFulfilled = body.isFulfilled;
          changes.isFulfilled = { from: current.isFulfilled, to: body.isFulfilled };

          if (body.isFulfilled && !current.fulfilledAt) {
            updates.fulfilledAt = new Date();
            if (current.status === 'ordered' || current.status === 'processing') {
              updates.status = 'fulfilled';
              changes.status = { from: current.status, to: 'fulfilled' };
            }
          }
        }
      }

      if ('aeOrderId' in body) {
        if (body.aeOrderId !== null && typeof body.aeOrderId !== 'string') {
          return errorJson(
            c,
            400,
            'INVALID_AE_ORDER_ID',
            '`aeOrderId` must be a string or null.'
          );
        }

        const rawAeId = body.aeOrderId as string | null;
        const aeId = rawAeId ? rawAeId.trim().slice(0, MAX_AE_ORDER_ID_LENGTH) : null;
        if (aeId !== current.aeOrderId) {
          updates.aeOrderId = aeId;
          changes.aeOrderId = { from: current.aeOrderId, to: aeId };
        }
      }

      if ('cancelReason' in body && !('status' in updates && updates.status === 'cancelled')) {
        if (body.cancelReason !== null && typeof body.cancelReason !== 'string') {
          return errorJson(
            c,
            400,
            'INVALID_CANCEL_REASON',
            '`cancelReason` must be a string or null.'
          );
        }
        const reason = body.cancelReason ? (body.cancelReason as string).trim().slice(0, MAX_REASON_LENGTH) : null;
        if (reason !== current.cancelReason) {
          updates.cancelReason = reason;
          changes.cancelReason = { from: current.cancelReason, to: reason };
        }
      }

      if (Object.keys(updates).length === 0) {
        const origin = new URL(c.req.url).origin;
        return c.json({
          success: true,
          message: 'No changes detected.',
          data: serializeOrderDetail(current, c.env, origin),
        });
      }

      updates.updatedAt = new Date();

      await db.update(orders).set(updates).where(eq(orders.id, id));

      const [updated] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1);

      logAuditFromContext(c, {
        action: AUDIT_ACTIONS.ORDER_UPDATE,
        category: AUDIT_CATEGORIES.ORDER,
        targetType: AUDIT_TARGET_TYPES.ORDER,
        targetId: current.id,
        targetLabel: `Order #${current.id.slice(0, 8)} (${current.customerName})`,
        description: `Updated order #${current.id.slice(0, 8)}: ${Object.keys(changes).join(', ')}`,
        changes,
        severity: 'info',
        status: 'success',
      });

      const origin = new URL(c.req.url).origin;
      return c.json({
        success: true,
        message: 'Order updated successfully.',
        data: serializeOrderDetail(updated ?? { ...current, ...updates }, c.env, origin),
      });
    } catch (error) {
      console.error('Error updating order:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to update order.');
    }
  }
);

// ─── POST /:id/cancel — Cancel Order ──────────────────────────────────────────

adminOrdersRouter.post(
  '/:id/cancel',
  requireAnyPermission(PERMISSIONS.ORDER_CANCEL, PERMISSIONS.ORDER_MANAGE),
  async (c) => {
    const actor = getActor(c);
    const db = getDb(c);
    const id = c.req.param('id');

    if (!isValidId(id)) {
      return errorJson(c, 400, 'INVALID_ID', 'Invalid order ID format.');
    }

    let cancelReason: string | null = null;
    try {
      const rawBody = await c.req.json();
      if (rawBody && typeof rawBody === 'object' && 'reason' in rawBody && typeof rawBody.reason === 'string') {
        cancelReason = rawBody.reason.trim().slice(0, MAX_REASON_LENGTH);
      }
    } catch {
      // Body is optional for cancel
    }

    try {
      const [current] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1);

      if (!current) {
        return errorJson(c, 404, 'ORDER_NOT_FOUND', 'Order not found.');
      }

      if (current.status === 'cancelled') {
        return errorJson(c, 400, 'ALREADY_CANCELLED', 'This order is already cancelled.');
      }

      if (current.status === 'refunded') {
        return errorJson(c, 400, 'ALREADY_REFUNDED', 'Refunded orders cannot be cancelled.');
      }

      const now = new Date();
      await db
        .update(orders)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: cancelReason || 'Cancelled by admin',
          updatedAt: now,
        })
        .where(eq(orders.id, id));

      logAuditFromContext(c, {
        action: AUDIT_ACTIONS.ORDER_CANCEL,
        category: AUDIT_CATEGORIES.ORDER,
        targetType: AUDIT_TARGET_TYPES.ORDER,
        targetId: current.id,
        targetLabel: `Order #${current.id.slice(0, 8)} (${current.customerName})`,
        description: `Cancelled order #${current.id.slice(0, 8)}${cancelReason ? `: ${cancelReason}` : ''}`,
        changes: {
          status: { from: current.status, to: 'cancelled' },
          cancelReason: { from: current.cancelReason, to: cancelReason || 'Cancelled by admin' },
        },
        severity: 'warning',
        status: 'success',
      });

      return c.json({
        success: true,
        message: 'Order cancelled successfully.',
      });
    } catch (error) {
      console.error('Error cancelling order:', error);
      return errorJson(c, 500, 'INTERNAL_ERROR', 'Failed to cancel order.');
    }
  }
);

// 404 handler for unmatched routes within /orders
adminOrdersRouter.notFound((c) =>
  errorJson(c, 404, 'NOT_FOUND', 'Orders route not found.')
);

export default adminOrdersRouter;
