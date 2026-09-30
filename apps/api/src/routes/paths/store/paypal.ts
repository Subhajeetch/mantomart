import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { checkoutSessionItems, checkoutSessions, createDb } from '@repo/db';
import type Env from '@/types/env';
import { logPayPalEvent, paypalRequest, PayPalApiError } from '@/utils/paypal';
import { moneyValue, payPalCaptures, persistPayPalOrder, validatePayPalOrder } from '@/utils/paypalOrder';

const storePayPal = new Hono<{ Bindings: Env }>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

storePayPal.post('/webhook', async (c) => {
  const webhookId = c.env.PAYPAL_WEBHOOK_ID?.trim();
  if (!webhookId) {
    return c.json({
      success: false,
      error: 'PayPal webhook is not configured.',
      code: 'WEBHOOK_NOT_CONFIGURED',
    }, 503);
  }

  const authAlgo = c.req.header('paypal-auth-algo');
  const certUrl = c.req.header('paypal-cert-url');
  const transmissionId = c.req.header('paypal-transmission-id');
  const transmissionSig = c.req.header('paypal-transmission-sig');
  const transmissionTime = c.req.header('paypal-transmission-time');
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return c.json({ success: false, error: 'Invalid PayPal webhook signature.' }, 400);
  }

  let event: Record<string, unknown> | null = null;
  try {
    event = asRecord(JSON.parse(await c.req.text()));
  } catch {
    return c.json({ success: false, error: 'Invalid PayPal webhook event.' }, 400);
  }
  if (!event) return c.json({ success: false, error: 'Invalid PayPal webhook event.' }, 400);

  let sessionIdForLog: string | undefined;
  let paypalOrderIdForLog: string | undefined;
  let captureIdForLog: string | undefined;
  try {
    const verification = await paypalRequest(c.env, '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: event,
      }),
    }, true);
    if (asRecord(verification)?.verification_status !== 'SUCCESS') {
      logPayPalEvent({ event: 'webhook_signature_invalid', issues: [] }, 'warn');
      return c.json({ success: false, error: 'Invalid PayPal webhook signature.' }, 400);
    }

    const eventType = typeof event.event_type === 'string' ? event.event_type : '';
    const paymentStatus = ({
      'PAYMENT.CAPTURE.COMPLETED': 'paid',
      'PAYMENT.CAPTURE.PENDING': 'pending',
      'PAYMENT.CAPTURE.DENIED': 'failed',
      'PAYMENT.CAPTURE.REFUNDED': 'refunded',
      'PAYMENT.CAPTURE.REVERSED': 'refunded',
    } as const)[eventType as
      | 'PAYMENT.CAPTURE.COMPLETED'
      | 'PAYMENT.CAPTURE.PENDING'
      | 'PAYMENT.CAPTURE.DENIED'
      | 'PAYMENT.CAPTURE.REFUNDED'
      | 'PAYMENT.CAPTURE.REVERSED'];
    if (!paymentStatus) return c.json({ success: true, data: { received: true } });

    const resource = asRecord(event.resource);
    const resourceId = typeof resource?.id === 'string' ? resource.id : '';
    const supplementaryData = asRecord(resource?.supplementary_data);
    const relatedIds = asRecord(supplementaryData?.related_ids);
    const paypalOrderId = typeof relatedIds?.order_id === 'string' ? relatedIds.order_id : '';
    paypalOrderIdForLog = paypalOrderId || undefined;
    captureIdForLog = resourceId || undefined;
    if (!resourceId || !paypalOrderId) {
      logPayPalEvent({ event: 'webhook_event_invalid', paypalOrderId }, 'warn');
      return c.json({ success: false, error: 'Invalid PayPal capture event.' }, 400);
    }

    const orderValue = await paypalRequest(
      c.env,
      `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`,
      { method: 'GET' },
      true,
    );
    const order = asRecord(orderValue);
    const units = Array.isArray(order?.purchase_units) ? order.purchase_units : [];
    const unit = asRecord(units[0]);
    const sessionId = typeof unit?.custom_id === 'string' ? unit.custom_id : '';
    sessionIdForLog = sessionId || undefined;
    if (!order || !sessionId) {
      logPayPalEvent({ event: 'webhook_order_unmatched', paypalOrderId }, 'warn');
      return c.json({ success: false, error: 'PayPal capture does not match a checkout.' }, 400);
    }

    const db = createDb(c.env.DB);
    const [session] = await db.select().from(checkoutSessions)
      .where(eq(checkoutSessions.id, sessionId)).limit(1);
    if (!session?.shippingSelection?.length) {
      logPayPalEvent({ event: 'webhook_session_missing', sessionId, paypalOrderId }, 'warn');
      return c.json({ success: true, data: { received: true } });
    }
    const items = await db.select().from(checkoutSessionItems)
      .where(eq(checkoutSessionItems.sessionId, session.id));
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPriceSnapshot, 0);
    const total = subtotal + session.shippingSelection.reduce((sum, option) => sum + option.amountCents, 0);
    if (items.length === 0 ||
      !validatePayPalOrder(order, paypalOrderId, session.id, total)) {
      logPayPalEvent({ event: 'webhook_order_validation_failed', sessionId, paypalOrderId }, 'error');
      return c.json({ success: false, error: 'PayPal capture does not match a checkout.' }, 400);
    }

    const capture = payPalCaptures(order).find((candidate) => candidate.id === resourceId);
    const captureAmount = asRecord(capture?.amount);
    if (!capture ||
      captureAmount?.currency_code !== 'USD' ||
      captureAmount.value !== moneyValue(total)) {
      logPayPalEvent({
        event: 'webhook_capture_validation_failed',
        sessionId,
        paypalOrderId,
        captureId: resourceId,
      }, 'error');
      return c.json({ success: false, error: 'PayPal capture does not match a checkout.' }, 400);
    }

    await persistPayPalOrder(db, session.id, paypalOrderId, resourceId, paymentStatus);
    logPayPalEvent({
      event: `webhook_${eventType.toLowerCase().replaceAll('.', '_')}`,
      sessionId,
      paypalOrderId,
      captureId: resourceId,
      httpStatus: 200,
    });
    return c.json({ success: true, data: { received: true } });
  } catch (error) {
    const eventType = typeof event.event_type === 'string' ? event.event_type : 'unknown';
    logPayPalEvent({
      event: `webhook_${eventType.toLowerCase().replaceAll('.', '_')}_failed`,
      sessionId: sessionIdForLog,
      paypalOrderId: paypalOrderIdForLog,
      captureId: captureIdForLog,
      debugId: error instanceof PayPalApiError ? error.debugId : undefined,
      httpStatus: error instanceof PayPalApiError ? error.httpStatus : undefined,
      issues: error instanceof PayPalApiError ? error.issues : [],
    }, 'error');
    return c.json({ success: false, error: 'PayPal webhook processing is temporarily unavailable.' }, 503);
  }
});

export default storePayPal;
