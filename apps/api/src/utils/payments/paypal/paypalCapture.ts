import type Env from '@/types/env';
import { logPayPalEvent, paypalRequest, PayPalApiError } from '@/utils/paypal';
import { moneyValue, payPalCaptures, validatePayPalOrder } from '@/utils/paypalOrder';

export class PayPalOrderMismatchError extends Error {}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isTransientPayPalError(error: unknown): error is PayPalApiError {
  return error instanceof PayPalApiError && (error.httpStatus === null || error.httpStatus >= 500);
}

async function loadOrder(env: Env, paypalOrderId: string) {
  return paypalRequest(
    env,
    `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`,
    { method: 'GET' },
    true,
  );
}

function validateOrder(
  order: unknown,
  paypalOrderId: string,
  sessionId: string,
  total: number,
) {
  if (!validatePayPalOrder(order, paypalOrderId, sessionId, total)) {
    throw new PayPalOrderMismatchError('PAYMENT_MISMATCH');
  }
}

export async function capturePayPalOrder(
  env: Env,
  sessionId: string,
  paypalOrderId: string,
  captureAttemptId: string,
  total: number,
) {
  const currentOrder = await loadOrder(env, paypalOrderId);
  validateOrder(currentOrder, paypalOrderId, sessionId, total);
  const current = currentOrder as Record<string, unknown>;
  let captureOrder = current;
  const captures = payPalCaptures(current);
  const alreadyCaptured = captures.find((capture) => ['COMPLETED', 'PENDING'].includes(String(capture.status)));

  if (!alreadyCaptured) {
    if (current.status !== 'APPROVED') {
      throw new PayPalApiError(
        409,
        null,
        'ORDER_NOT_APPROVED',
        'The PayPal order must be approved before it can be captured.',
        ['ORDER_NOT_APPROVED'],
      );
    }
    const requestHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${paypalOrderId}:${captureAttemptId}`),
    );
    const requestId = `capture-${Array.from(new Uint8Array(requestHash))
      .slice(0, 12)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
    try {
      const result = await paypalRequest(
        env,
        `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
        {
          method: 'POST',
          headers: {
            'PayPal-Request-Id': requestId,
            Prefer: 'return=representation',
            ...(env.PAYPAL_ENVIRONMENT !== 'live' && env.PAYPAL_ENABLE_NEGATIVE_TESTING === 'true'
              ? { 'PayPal-Mock-Response': '{"mock_application_codes":"INSTRUMENT_DECLINED"}' }
              : {}),
          },
          body: '{}',
        },
        true,
      );
      validateOrder(result, paypalOrderId, sessionId, total);
      captureOrder = result as Record<string, unknown>;
    } catch (error) {
      const alreadyCapturedError = error instanceof PayPalApiError &&
        error.issues.includes('ORDER_ALREADY_CAPTURED');
      if (!alreadyCapturedError && !isTransientPayPalError(error)) throw error;
      logPayPalEvent({
        event: alreadyCapturedError ? 'capture_already_processed' : 'capture_result_uncertain',
        sessionId,
        paypalOrderId,
        debugId: error.debugId,
        httpStatus: error.httpStatus,
        issues: error.issues,
      }, 'warn');
      const reconciled = await loadOrder(env, paypalOrderId);
      validateOrder(reconciled, paypalOrderId, sessionId, total);
      const reconciledCapture = payPalCaptures(reconciled)
        .find((capture) => ['COMPLETED', 'PENDING'].includes(String(capture.status)));
      if (!reconciledCapture) throw error;
      captureOrder = reconciled as Record<string, unknown>;
    }
  }

  const orderCaptures = payPalCaptures(captureOrder);
  const capture = orderCaptures.find((candidate) =>
    ['COMPLETED', 'PENDING', 'DENIED'].includes(String(candidate.status)));
  const amount = asRecord(capture?.amount);
  const captureId = typeof capture?.id === 'string' ? capture.id : '';
  if (capture?.status === 'DENIED') {
    throw new PayPalApiError(
      422,
      null,
      'PAYMENT_DECLINED',
      'PayPal declined the payment.',
      ['TRANSACTION_REFUSED'],
    );
  }
  if (!captureId ||
    !['COMPLETED', 'PENDING'].includes(String(capture?.status)) ||
    amount?.currency_code !== 'USD' ||
    amount.value !== moneyValue(total)) {
    throw new PayPalOrderMismatchError('PAYMENT_MISMATCH');
  }
  return {
    captureId,
    paymentStatus: capture?.status === 'PENDING' ? 'pending' as const : 'paid' as const,
  };
}
