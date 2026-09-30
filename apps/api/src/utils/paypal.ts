import type Env from '@/types/env';

type PayPalErrorBody = {
  name?: unknown;
  message?: unknown;
  details?: unknown;
  error?: unknown;
  error_description?: unknown;
};

export class PayPalApiError extends Error {
  constructor(
    readonly httpStatus: number | null,
    readonly debugId: string | null,
    readonly name: string,
    message: string,
    readonly issues: string[],
  ) {
    super(message);
  }
}

export function paypalErrorResponse(error: unknown) {
  if (error instanceof Error && error.message === 'PAYPAL_NOT_CONFIGURED') {
    return {
      status: 503 as const,
      body: {
        success: false as const,
        error: 'PayPal payments are not available yet.',
        code: 'PAYMENT_NOT_CONFIGURED',
        retryable: true,
      },
    };
  }
  if (!(error instanceof PayPalApiError)) {
    return {
      status: 502 as const,
      body: {
        success: false as const,
        error: 'PayPal could not process the request. Please try again.',
        code: 'PAYMENT_PROVIDER_ERROR',
        retryable: false,
      },
    };
  }
  if (error.issues.some((candidate) => [
    'INSTRUMENT_DECLINED',
    'TRANSACTION_REFUSED',
    'PAYER_ACCOUNT_RESTRICTED',
    'PAYER_CANNOT_PAY',
  ].includes(candidate))) {
    return {
      status: 402 as const,
      body: {
        success: false as const,
        error: 'Payment was declined. Choose another payment method and try again.',
        code: 'PAYMENT_DECLINED',
        retryable: true,
      },
    };
  }
  if (error.issues.some((candidate) => ['PAYER_ACTION_REQUIRED', 'ORDER_NOT_APPROVED'].includes(candidate))) {
    return {
      status: 409 as const,
      body: {
        success: false as const,
        error: 'PayPal needs you to approve this payment again.',
        code: 'PAYMENT_APPROVAL_REQUIRED',
        retryable: false,
      },
    };
  }
  if (error.httpStatus === null || error.httpStatus >= 500) {
    return {
      status: 503 as const,
      body: {
        success: false as const,
        error: 'PayPal is temporarily unavailable. Your payment status is being checked; retry shortly.',
        code: 'PAYMENT_PROVIDER_UNAVAILABLE',
        retryable: true,
      },
    };
  }
  return {
    status: 502 as const,
    body: {
      success: false as const,
      error: 'PayPal could not process the request. Please try again.',
      code: 'PAYMENT_PROVIDER_ERROR',
      retryable: false,
    },
  };
}

export type PayPalLogFields = {
  event: string;
  sessionId?: string;
  paypalOrderId?: string;
  captureId?: string;
  debugId?: string | null;
  httpStatus?: number | null;
  issues?: string[];
};

export function logPayPalEvent(
  fields: PayPalLogFields,
  level: 'info' | 'warn' | 'error' = 'info',
) {
  const line = JSON.stringify({
    event: fields.event,
    sessionId: fields.sessionId,
    paypalOrderId: fields.paypalOrderId,
    captureId: fields.captureId,
    debugId: fields.debugId,
    httpStatus: fields.httpStatus,
    issues: fields.issues ?? [],
  });
  if (level === 'error') console.error('paypal', line);
  else if (level === 'warn') console.warn('paypal', line);
  else console.log('paypal', line);
}

export function paypalApiOrigin(env: Env) {
  return env.PAYPAL_ENVIRONMENT === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorFromResponse(response: Response, body: unknown) {
  const details = record(body)?.details;
  const issues = Array.isArray(details)
    ? details.flatMap((detail) => {
      const issue = record(detail)?.issue;
      return typeof issue === 'string' ? [issue] : [];
    })
    : [];
  const errorBody = record(body) as PayPalErrorBody | null;
  const name = typeof errorBody?.name === 'string'
    ? errorBody.name
    : typeof errorBody?.error === 'string' ? errorBody.error : 'PAYPAL_REQUEST_FAILED';
  const message = typeof errorBody?.message === 'string'
    ? errorBody.message
    : typeof errorBody?.error_description === 'string' ? errorBody.error_description : 'PayPal request failed.';
  return new PayPalApiError(
    response.status,
    response.headers.get('paypal-debug-id'),
    name,
    message,
    issues,
  );
}

const accessTokens = new Map<string, { token: string; expiresAt: number }>();
const tokenRequests = new Map<string, Promise<string>>();
let warnedLiveWebhookMissing = false;

export function warnIfLiveWebhookMissing(env: Env) {
  if (env.PAYPAL_ENVIRONMENT === 'live' && !env.PAYPAL_WEBHOOK_ID?.trim() && !warnedLiveWebhookMissing) {
    warnedLiveWebhookMissing = true;
    console.warn('PayPal config warning: PAYPAL_WEBHOOK_ID is unset in live mode; checkout works, but webhook events cannot be verified.');
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retrySafe: boolean,
) {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (retrySafe && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      throw new PayPalApiError(
        null,
        null,
        error instanceof Error ? error.name : 'NETWORK_ERROR',
        'PayPal request failed before a response was received.',
        [],
      );
    }

    if (retrySafe && response.status >= 500 && attempt === 0) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
    return response;
  }
}

export async function getPayPalAccessToken(env: Env) {
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error('PAYPAL_NOT_CONFIGURED');

  const cacheKey = `${env.PAYPAL_ENVIRONMENT ?? 'sandbox'}:${clientId}`;
  const cached = accessTokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const pending = tokenRequests.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const response = await fetchWithRetry(
      `${paypalApiOrigin(env)}/v1/oauth2/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
      },
      true,
    );
    const body = await response.json().catch(() => null);
    const token = record(body)?.access_token;
    if (!response.ok || typeof token !== 'string') throw errorFromResponse(response, body);
    const expiresIn = record(body)?.expires_in;
    if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 60) {
      accessTokens.set(cacheKey, { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 });
    }
    return token;
  })();
  tokenRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    tokenRequests.delete(cacheKey);
  }
}

export async function paypalRequest(
  env: Env,
  path: string,
  init: RequestInit = {},
  retrySafe = false,
) {
  const accessToken = await getPayPalAccessToken(env);
  const response = await fetchWithRetry(
    `${paypalApiOrigin(env)}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    },
    retrySafe,
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) throw errorFromResponse(response, body);
  return body;
}
