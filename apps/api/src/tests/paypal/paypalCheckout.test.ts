import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkoutSessionItems, checkoutSessions, orders, productSkus, products, users } from '@repo/db';
import type Env from '@/types/env';
import storePayPal from '@/routes/paths/store/paypal';
import {
  createPayPalRequestId,
  persistPayPalOrder,
  shouldApplyPaymentStatus,
} from '@/utils/paypalOrder';
import { capturePayPalOrder, PayPalOrderMismatchError } from '@/utils/paypalCapture';
import {
  paypalErrorResponse,
  PayPalApiError,
  getPayPalAccessToken,
  warnIfLiveWebhookMissing,
} from '@/utils/paypal';

const orderId = 'PAYPAL-ORDER-1';
const sessionId = 'checkout-session-1';
const attemptId = '0f55bf2a-aee1-4bfe-b678-0e1e9b9b21ff';
const total = 4873;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'paypal-debug-id': 'debug-test' },
  });
}

function env(suffix: string, overrides: Partial<Env> = {}): Env {
  return {
    PAYPAL_CLIENT_ID: `client-${suffix}`,
    PAYPAL_CLIENT_SECRET: `secret-${suffix}`,
    PAYPAL_ENVIRONMENT: 'sandbox',
    ...overrides,
  } as Env;
}

function paypalOrder(status: string, captures: Record<string, unknown>[] = [], amount = '48.73') {
  return {
    id: orderId,
    status,
    purchase_units: [{
      custom_id: sessionId,
      reference_id: sessionId,
      amount: { currency_code: 'USD', value: amount },
      payments: { captures },
    }],
  };
}

function capture(status: string, amount = '48.73') {
  return {
    id: 'CAPTURE-1',
    status,
    amount: { currency_code: 'USD', value: amount },
  };
}

function mockCaptureApi(
  suffix: string,
  captureResponse: Response | (() => Response | Promise<Response>),
  options: { initialOrder?: Record<string, unknown>; afterCaptureOrder?: Record<string, unknown> } = {},
) {
  const requestIds: string[] = [];
  const mockResponseHeaders: (string | null)[] = [];
  const calls: string[] = [];
  let captureCalls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname.endsWith('/v1/oauth2/token')) {
      return response({ access_token: `token-${suffix}`, expires_in: 3600 });
    }
    if (url.pathname.endsWith('/capture')) {
      captureCalls += 1;
      const headers = new Headers(init?.headers);
      requestIds.push(headers.get('PayPal-Request-Id') ?? '');
      mockResponseHeaders.push(headers.get('PayPal-Mock-Response'));
      return typeof captureResponse === 'function' ? captureResponse() : captureResponse;
    }
    if (url.pathname.endsWith(`/orders/${orderId}`)) {
      return response(captureCalls && options.afterCaptureOrder
        ? options.afterCaptureOrder
        : options.initialOrder ?? paypalOrder('APPROVED'));
    }
    throw new Error(`Unexpected PayPal URL: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls, requestIds, mockResponseHeaders };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PayPal capture handling', () => {
  it('captures an approved order and validates session references and amount', async () => {
    const mock = mockCaptureApi('success', response(paypalOrder('COMPLETED', [capture('COMPLETED')])));
    await expect(capturePayPalOrder(env('success'), sessionId, orderId, attemptId, total))
      .resolves.toEqual({ captureId: 'CAPTURE-1', paymentStatus: 'paid' });
    expect(mock.requestIds[0]).toMatch(/^capture-/);
  });

  it('exposes INSTRUMENT_DECLINED as a typed PayPal error', async () => {
    mockCaptureApi('declined', response({
      name: 'UNPROCESSABLE_ENTITY',
      message: 'The instrument was declined.',
      details: [{ issue: 'INSTRUMENT_DECLINED' }],
    }, 422));
    await expect(capturePayPalOrder(env('declined'), sessionId, orderId, attemptId, total))
      .rejects.toMatchObject({ issues: ['INSTRUMENT_DECLINED'], httpStatus: 422 });
  });

  it('uses a new deterministic capture key after a declined approval attempt', async () => {
    let attempt = 0;
    const mock = mockCaptureApi('decline-retry', () => {
      attempt += 1;
      return attempt === 1
        ? response({ details: [{ issue: 'INSTRUMENT_DECLINED' }] }, 422)
        : response(paypalOrder('COMPLETED', [capture('COMPLETED')]));
    });
    const configuration = env('decline-retry');
    await expect(capturePayPalOrder(
      configuration,
      sessionId,
      orderId,
      attemptId,
      total,
    )).rejects.toMatchObject({ issues: ['INSTRUMENT_DECLINED'] });
    await expect(capturePayPalOrder(
      configuration,
      sessionId,
      orderId,
      'b806ee09-c247-4414-9b0e-621e914973cc',
      total,
    )).resolves.toEqual({ captureId: 'CAPTURE-1', paymentStatus: 'paid' });
    expect(mock.requestIds).toHaveLength(2);
    expect(mock.requestIds[0]).not.toBe(mock.requestIds[1]);
  });

  it('reconciles a capture timeout by reading the completed order', async () => {
    const completed = paypalOrder('COMPLETED', [capture('COMPLETED')]);
    let callsToCapture = 0;
    const mock = mockCaptureApi('timeout', () => {
      callsToCapture += 1;
      throw new Error('simulated network timeout');
    }, { afterCaptureOrder: completed });
    await expect(capturePayPalOrder(env('timeout'), sessionId, orderId, attemptId, total))
      .resolves.toEqual({ captureId: 'CAPTURE-1', paymentStatus: 'paid' });
    expect(callsToCapture).toBe(2);
    expect(mock.requestIds[0]).toBe(mock.requestIds[1]);
  });

  it('reconciles ORDER_ALREADY_CAPTURED with GET order', async () => {
    const completed = paypalOrder('COMPLETED', [capture('COMPLETED')]);
    mockCaptureApi('already-captured', response({
      name: 'UNPROCESSABLE_ENTITY',
      details: [{ issue: 'ORDER_ALREADY_CAPTURED' }],
    }, 422), { afterCaptureOrder: completed });
    await expect(capturePayPalOrder(env('already-captured'), sessionId, orderId, attemptId, total))
      .resolves.toEqual({ captureId: 'CAPTURE-1', paymentStatus: 'paid' });
  });

  it('accepts pending capture without marking it paid', async () => {
    mockCaptureApi('pending', response(paypalOrder('COMPLETED', [capture('PENDING')])));
    await expect(capturePayPalOrder(env('pending'), sessionId, orderId, attemptId, total))
      .resolves.toEqual({ captureId: 'CAPTURE-1', paymentStatus: 'pending' });
  });

  it('rejects an order with a mismatched amount before capture', async () => {
    const mock = mockCaptureApi('mismatch', response(null), { initialOrder: paypalOrder('APPROVED', [], '1.00') });
    await expect(capturePayPalOrder(env('mismatch'), sessionId, orderId, attemptId, total))
      .rejects.toBeInstanceOf(PayPalOrderMismatchError);
    expect(mock.requestIds).toHaveLength(0);
  });

  it('makes a second capture call reconcile the same completed order', async () => {
    const completed = paypalOrder('COMPLETED', [capture('COMPLETED')]);
    const mock = mockCaptureApi('double', response(completed), {
      afterCaptureOrder: completed,
    });
    const configuration = env('double');
    const first = await capturePayPalOrder(configuration, sessionId, orderId, attemptId, total);
    const second = await capturePayPalOrder(configuration, sessionId, orderId, attemptId, total);
    expect(second).toEqual(first);
    expect(mock.requestIds).toHaveLength(1);
  });

  it('retries capture with the same PayPal request ID', async () => {
    let attempts = 0;
    const mock = mockCaptureApi('safe-retry', () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary network error');
      return response(paypalOrder('COMPLETED', [capture('COMPLETED')]));
    });
    await capturePayPalOrder(env('safe-retry'), sessionId, orderId, attemptId, total);
    expect(mock.requestIds).toHaveLength(2);
    expect(mock.requestIds[0]).toBe(mock.requestIds[1]);
  });

  it('sends negative-testing headers only when explicitly enabled in sandbox', async () => {
    const mock = mockCaptureApi('negative-test', response({
      details: [{ issue: 'INSTRUMENT_DECLINED' }],
    }, 422));
    await expect(capturePayPalOrder(
      env('negative-test', { PAYPAL_ENABLE_NEGATIVE_TESTING: 'true' }),
      sessionId,
      orderId,
      attemptId,
      total,
    )).rejects.toMatchObject({ issues: ['INSTRUMENT_DECLINED'] });
    expect(mock.mockResponseHeaders).toEqual(['{"mock_application_codes":"INSTRUMENT_DECLINED"}']);
  });

  it('never sends negative-testing headers in live', async () => {
    const mock = mockCaptureApi('live-test', response({
      details: [{ issue: 'INSTRUMENT_DECLINED' }],
    }, 422));
    await expect(capturePayPalOrder(
      env('live-test', {
        PAYPAL_ENVIRONMENT: 'live',
        PAYPAL_ENABLE_NEGATIVE_TESTING: 'true',
      }),
      sessionId,
      orderId,
      attemptId,
      total,
    )).rejects.toMatchObject({ issues: ['INSTRUMENT_DECLINED'] });
    expect(mock.mockResponseHeaders).toEqual([null]);
  });
});

describe('PayPal errors, webhook and idempotency', () => {
  it('maps instrument declines to a retryable client-safe response', () => {
    const mapped = paypalErrorResponse(new PayPalApiError(
      422,
      'debug-only',
      'UNPROCESSABLE_ENTITY',
      'private PayPal message',
      ['INSTRUMENT_DECLINED'],
    ));
    expect(mapped.status).toBe(402);
    expect(mapped.body).toMatchObject({ code: 'PAYMENT_DECLINED', retryable: true });
    expect(JSON.stringify(mapped.body)).not.toContain('private PayPal message');
    expect(JSON.stringify(mapped.body)).not.toContain('debug-only');
  });

  it('maps approval and transient errors to the specified client statuses', () => {
    expect(paypalErrorResponse(new PayPalApiError(
      422,
      null,
      'UNPROCESSABLE_ENTITY',
      'internal',
      ['ORDER_NOT_APPROVED'],
    ))).toMatchObject({ status: 409, body: { code: 'PAYMENT_APPROVAL_REQUIRED', retryable: false } });
    expect(paypalErrorResponse(new PayPalApiError(
      502,
      null,
      'INTERNAL_SERVER_ERROR',
      'internal',
      [],
    ))).toMatchObject({ status: 503, body: { code: 'PAYMENT_PROVIDER_UNAVAILABLE', retryable: true } });
  });

  it('caches an access token in the isolate until near expiry', async () => {
    const fetchMock = vi.fn(async () => response({ access_token: 'cached-token', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);
    const configuration = env('token-cache');
    await expect(getPayPalAccessToken(configuration)).resolves.toBe('cached-token');
    await expect(getPayPalAccessToken(configuration)).resolves.toBe('cached-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects webhook events when PayPal signature verification fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith('/v1/oauth2/token')
        ? response({ access_token: 'verification-token', expires_in: 3600 })
        : response({ verification_status: 'FAILURE' });
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await storePayPal.request(
      'http://localhost/webhook',
      {
        method: 'POST',
        headers: {
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-cert-url': 'https://api-m.sandbox.paypal.com/cert',
          'paypal-transmission-id': 'transmission',
          'paypal-transmission-sig': 'signature',
          'paypal-transmission-time': new Date().toISOString(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED' }),
      },
      env('invalid-webhook', { PAYPAL_WEBHOOK_ID: 'webhook-id' }),
    );
    expect(result.status).toBe(400);
    expect(warn).toHaveBeenCalled();
  });

  it('returns WEBHOOK_NOT_CONFIGURED without processing when webhook ID is unset', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await storePayPal.request(
      'http://localhost/webhook',
      { method: 'POST', body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED' }) },
      env('missing-webhook', { PAYPAL_WEBHOOK_ID: undefined }),
    );
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({ code: 'WEBHOOK_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warns once for live mode without webhook ID without logging values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const configuration = env('live-no-webhook', {
      PAYPAL_ENVIRONMENT: 'live',
      PAYPAL_WEBHOOK_ID: undefined,
    });
    warnIfLiveWebhookMissing(configuration);
    warnIfLiveWebhookMissing(configuration);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(' ')).not.toContain('client-live-no-webhook');
  });

  it('makes duplicate payment-status webhook transitions no-ops', () => {
    let current: 'pending' | 'paid' | 'failed' | 'refunded' = 'pending';
    let writes = 0;
    for (const eventStatus of ['paid', 'paid'] as const) {
      if (shouldApplyPaymentStatus(current, eventStatus)) {
        current = eventStatus;
        writes += 1;
      }
    }
    expect(current).toBe('paid');
    expect(writes).toBe(1);
    expect(shouldApplyPaymentStatus('paid', 'pending')).toBe(false);
  });

  it('changes the create idempotency key when shipping changes', async () => {
    const item = {
      id: 'item-1',
      skuId: 'sku-1',
      quantity: 1,
      unitPriceSnapshot: 4475,
      productNameSnapshot: 'Product',
      variantLabelSnapshot: null,
    } as typeof checkoutSessionItems.$inferSelect;
    const shipping = [{
      itemId: 'item-1',
      quoteId: 'quote-a',
      serviceName: 'Standard',
      logisticsServiceName: 'Standard',
      amountCents: 398,
      currency: 'USD',
      minDays: null,
      maxDays: null,
    }];
    const first = await createPayPalRequestId(sessionId, 4873, [item], shipping);
    const repeated = await createPayPalRequestId(sessionId, 4873, [item], shipping);
    const changed = await createPayPalRequestId(sessionId, 4873, [item], [{
      ...shipping[0]!,
      quoteId: 'quote-b',
    }]);
    expect(first).toBe(repeated);
    expect(changed).not.toBe(first);
  });

  it('recovers order persistence after a transient DB write failure', async () => {
    const state = makeFakeDb();
    await expect(persistPayPalOrder(state.db, sessionId, orderId, 'CAPTURE-1', 'paid'))
      .rejects.toThrow('simulated D1 write failure');
    const order = await persistPayPalOrder(state.db, sessionId, orderId, 'CAPTURE-1', 'paid');
    expect(order.paymentStatus).toBe('paid');
    expect(state.orders).toHaveLength(1);
  });

  it('does not write a duplicate order for a redelivered completion event', async () => {
    const state = makeFakeDb(false);
    await persistPayPalOrder(state.db, sessionId, orderId, 'CAPTURE-1', 'paid');
    await persistPayPalOrder(state.db, sessionId, orderId, 'CAPTURE-1', 'paid');
    expect(state.batchCount()).toBe(1);
    expect(state.orders).toHaveLength(1);
  });
});

function makeFakeDb(failFirstBatch = true) {
  const session = {
    id: sessionId,
    userId: 'user-1',
    addressSnapshot: { firstName: 'Buyer', phone: '' },
    shippingSelection: [{
      itemId: 'item-1',
      quoteId: 'quote-1',
      serviceName: 'Standard',
      logisticsServiceName: 'Standard',
      amountCents: 398,
      currency: 'USD',
      minDays: null,
      maxDays: null,
    }],
  };
  const item = {
    id: 'item-1',
    sessionId,
    productId: 'product-1',
    skuId: 'sku-1',
    quantity: 1,
    unitPriceSnapshot: 4475,
    productNameSnapshot: 'Product',
    productSlugSnapshot: 'product',
    variantLabelSnapshot: null,
    imageSnapshot: null,
  };
  const user = { id: 'user-1', name: 'Buyer', email: 'buyer@example.test' };
  const ordersRows: Record<string, unknown>[] = [];
  let failBatch = failFirstBatch;
  let batchCount = 0;
  const rowsFor = (table: unknown) => {
    if (table === checkoutSessions) return [session];
    if (table === users) return [user];
    if (table === orders) return ordersRows;
    if (table === checkoutSessionItems) return [item];
    if (table === products || table === productSkus) return [];
    return [];
  };
  const db = {
    select: () => {
      let table: unknown;
      const query = {
        from(nextTable: unknown) {
          table = nextTable;
          return query;
        },
        where() {
          return query;
        },
        limit() {
          return Promise.resolve(rowsFor(table));
        },
        then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(rowsFor(table)).then(resolve, reject);
        },
      };
      return query;
    },
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => ({ kind: 'insert', table, value }),
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({ kind: 'update', table, value }),
      }),
    }),
    batch: async (statements: { kind: string; table: unknown; value: Record<string, unknown> }[]) => {
      batchCount += 1;
      if (failBatch) {
        failBatch = false;
        throw new Error('simulated D1 write failure');
      }
      for (const statement of statements) {
        if (statement.kind === 'insert' && statement.table === orders) {
          ordersRows.push(statement.value);
        }
        if (statement.kind === 'update' && statement.table === checkoutSessions) {
          Object.assign(session, statement.value);
        }
      }
    },
  };
  return {
    db: db as unknown as Parameters<typeof persistPayPalOrder>[0],
    orders: ordersRows,
    batchCount: () => batchCount,
  };
}
