import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  addresses,
  cartItems,
  checkoutSessionItems,
  checkoutSessions,
  orders,
  productSkus,
  products,
} from '@repo/db';
import type Env from '@/types/env';
import { errorJson } from '@/utils/http/errorJson';
import {
  fingerprintShippingAddress,
  getShippingQuoteSecret,
  readShippingQuoteToken,
} from '@/utils/aliexpress/checkoutShipping';
import {
  getOrCreateCart,
  guestIdFromHeader,
  mergeGuestCartIntoUser,
  requireJson,
  requireStoreUser,
  requireTrustedMutationOrigin,
  skuSnapshot,
} from './cart';
import {
  requestOriginFromUrl,
  resolveProductImageUrlForClient,
} from '@/utils/images/productImageHost';
import {
  getPayPalAccessToken,
  logPayPalEvent,
  paypalRequest,
  paypalErrorResponse,
  PayPalApiError,
} from '@/utils/payments/paypal/paypal';
import {
  createPayPalRequestId,
  moneyValue,
  persistPayPalOrder,
} from '@/utils/payments/paypal/paypalOrder';
import { capturePayPalOrder as capturePayPalPayment, PayPalOrderMismatchError } from '@/utils/payments/paypal/paypalCapture';

const storeCheckout = new Hono<{ Bindings: Env }>();
const SESSION_TTL_MS = 30 * 60 * 1000;

type CheckoutItem = typeof checkoutSessionItems.$inferSelect;
type CheckoutAddress = typeof addresses.$inferSelect;

function sessionResponse(
  session: typeof checkoutSessions.$inferSelect,
  items: CheckoutItem[],
) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPriceSnapshot, 0);
  return {
    id: session.id,
    source: session.source,
    status: session.status,
    addressId: session.addressId,
    expiresAt: session.expiresAt.toISOString(),
    items,
    subtotal,
    shippingTotal: session.shippingTotal,
    total: subtotal + session.shippingTotal,
    address: session.addressSnapshot,
    shipping: session.shippingSelection,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function paypalError(c: Parameters<typeof errorJson>[0], error: unknown) {
  const mapped = paypalErrorResponse(error);
  return c.json(mapped.body, mapped.status);
}

function logPayPalFailure(event: string, sessionId: string, paypalOrderId: string | undefined, error: unknown) {
  logPayPalEvent({
    event,
    sessionId,
    paypalOrderId,
    debugId: error instanceof PayPalApiError ? error.debugId : undefined,
    httpStatus: error instanceof PayPalApiError ? error.httpStatus : undefined,
    issues: error instanceof PayPalApiError ? error.issues : [],
  }, 'error');
}

function addressSnapshot(address: CheckoutAddress) {
  return {
    firstName: address.firstName,
    lastName: address.lastName,
    countryCode: address.countryCode,
    countryName: address.countryName,
    phoneCountryCode: address.phoneCountryCode,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    deliveryInstructions: address.deliveryInstructions,
  };
}

storeCheckout.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  c.header('Vary', 'Cookie');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});

storeCheckout.post('/cart', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;
    const guestId = guestIdFromHeader(c);
    if (guestId) await mergeGuestCartIntoUser(access.db, access.user.id, guestId);
    const cart = await getOrCreateCart(access.db, { userId: access.user.id });
    const items = await access.db.select().from(cartItems).where(and(
      eq(cartItems.cartId, cart.id),
      eq(cartItems.selected, true),
    ));
    if (items.length === 0) return errorJson(c, 400, 'EMPTY_CART', 'Add an item before starting checkout.');
    const now = new Date();
    const session = {
      id: nanoid(),
      userId: access.user.id,
      source: 'cart' as const,
      status: 'pending' as const,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      createdAt: now,
      updatedAt: now,
    };
    const statements = [
      access.db.insert(checkoutSessions).values(session),
      ...items.map((item) => access.db.insert(checkoutSessionItems).values({
        id: nanoid(),
        sessionId: session.id,
        productId: item.productId,
        skuId: item.skuId,
        quantity: item.quantity,
        unitPriceSnapshot: item.unitPriceSnapshot,
        compareAtPriceSnapshot: item.compareAtPriceSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        productSlugSnapshot: item.productSlugSnapshot,
        variantLabelSnapshot: item.variantLabelSnapshot,
        imageSnapshot: item.imageSnapshot,
        createdAt: now,
      })),
    ];
    await access.db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
    return c.json({ success: true, data: { sessionId: session.id } }, 201);
  } catch (error) {
    console.error('store checkout: cart session failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to start checkout.');
  }
});

storeCheckout.post('/buy-now', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    const bodyError = requireJson(c);
    if (bodyError) return bodyError;
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;
    const input = asRecord(await c.req.json<unknown>());
    const skuId = typeof input?.skuId === 'string' ? input.skuId.trim() : '';
    const quantity = typeof input?.quantity === 'number' && Number.isInteger(input.quantity) ? input.quantity : NaN;
    if (!skuId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return errorJson(c, 400, 'INVALID_ITEM', 'A valid skuId and quantity are required.');
    }
    const snapshot = await skuSnapshot(access.db, skuId);
    if (!snapshot) return errorJson(c, 404, 'SKU_NOT_FOUND', 'That product variant no longer exists.');
    if (snapshot.sku.stock < quantity) return errorJson(c, 409, 'INSUFFICIENT_STOCK', 'The requested quantity is not available.');
    const now = new Date();
    const session = {
      id: nanoid(),
      userId: access.user.id,
      source: 'buy_now' as const,
      status: 'pending' as const,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      createdAt: now,
      updatedAt: now,
    };
    const item = {
      id: nanoid(),
      sessionId: session.id,
      productId: snapshot.product.id,
      skuId,
      quantity,
      unitPriceSnapshot: snapshot.sku.price,
      compareAtPriceSnapshot: snapshot.sku.compareAtPrice,
      productNameSnapshot: snapshot.product.name,
      variantLabelSnapshot: snapshot.label,
      imageSnapshot: Array.isArray(snapshot.product.images) && snapshot.product.images[0] && typeof snapshot.product.images[0] === 'object'
        ? snapshot.product.images[0].url ?? null
        : null,
      productSlugSnapshot: snapshot.product.slug,
      createdAt: now,
    };
    await access.db.batch([
      access.db.insert(checkoutSessions).values(session),
      access.db.insert(checkoutSessionItems).values(item),
    ]);
    return c.json({ success: true, data: { sessionId: session.id } }, 201);
  } catch (error) {
    console.error('store checkout: buy-now session failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to start checkout.');
  }
});

storeCheckout.post('/:sessionId/fulfillment', async (c) => {
  const originError = requireTrustedMutationOrigin(c);
  if (originError) return originError;
  const bodyError = requireJson(c);
  if (bodyError) return bodyError;
  const access = await requireStoreUser(c);
  if (!access.ok) return access.response;
  const shippingQuoteSecret = getShippingQuoteSecret(c.env.BETTER_AUTH_SECRET);
  if (!shippingQuoteSecret) {
    console.error('store checkout: BETTER_AUTH_SECRET is missing or shorter than 32 characters');
    return errorJson(c, 503, 'CHECKOUT_SECURITY_UNAVAILABLE', 'Checkout is temporarily unavailable due to a server configuration issue.');
  }
  try {
    const sessionId = c.req.param('sessionId');
    const [session] = await access.db.select().from(checkoutSessions).where(and(
      eq(checkoutSessions.id, sessionId),
      eq(checkoutSessions.userId, access.user.id),
    )).limit(1);
    if (!session) return errorJson(c, 404, 'CHECKOUT_NOT_FOUND', 'Checkout session not found.');
    if (session.expiresAt.getTime() <= Date.now()) return errorJson(c, 410, 'CHECKOUT_EXPIRED', 'This checkout session has expired.');
    if (session.status === 'completed' || session.status === 'cancelled') return errorJson(c, 409, 'CHECKOUT_CLOSED', 'This checkout is no longer available.');
    const input = asRecord(await c.req.json<unknown>());
    const addressId = typeof input?.addressId === 'string' ? input.addressId.trim() : '';
    const selectedQuotes = input?.quotes;
    if (!addressId || addressId.length > 128 || !Array.isArray(selectedQuotes) || selectedQuotes.length > 30) {
      return errorJson(c, 400, 'INVALID_FULFILLMENT', 'A delivery address and shipping selections are required.');
    }
    const [address] = await access.db.select().from(addresses).where(and(
      eq(addresses.id, addressId),
      eq(addresses.userId, access.user.id),
    )).limit(1);
    if (!address) return errorJson(c, 404, 'ADDRESS_NOT_FOUND', 'That delivery address was not found.');
    const addressFingerprint = await fingerprintShippingAddress(address);
    const items = await access.db.select().from(checkoutSessionItems).where(eq(checkoutSessionItems.sessionId, session.id));
    if (items.length === 0 || selectedQuotes.length !== items.length) {
      return errorJson(c, 400, 'INVALID_SHIPPING_SELECTION', 'Choose shipping for every item in your order.');
    }
    const itemIds = new Set(items.map((item) => item.id));
    const shipping = [];
    const seen = new Set<string>();
    for (const entry of selectedQuotes) {
      const quoteId = asRecord(entry)?.quoteId;
      if (typeof quoteId !== 'string' || quoteId.length > 4096) {
        return errorJson(c, 400, 'INVALID_SHIPPING_SELECTION', 'A shipping option is invalid. Please refresh the options.');
      }
      const quote = await readShippingQuoteToken(quoteId, shippingQuoteSecret);
      if (!quote || quote.sessionId !== session.id || quote.addressId !== address.id ||
        quote.addressFingerprint !== addressFingerprint ||
        !itemIds.has(quote.itemId) || seen.has(quote.itemId)) {
        return errorJson(c, 409, 'SHIPPING_QUOTE_EXPIRED', 'Shipping options changed. Please refresh your options.');
      }
      seen.add(quote.itemId);
      shipping.push({
        itemId: quote.itemId,
        quoteId,
        serviceName: quote.serviceName,
        logisticsServiceName: quote.logisticsServiceName,
        amountCents: quote.amountCents,
        currency: quote.currency,
        minDays: quote.minDays,
        maxDays: quote.maxDays,
      });
    }
    if (seen.size !== items.length) return errorJson(c, 400, 'INVALID_SHIPPING_SELECTION', 'Choose shipping for every item in your order.');
    const shippingTotal = shipping.reduce((sum, option) => sum + option.amountCents, 0);
    if (!Number.isSafeInteger(shippingTotal) || shippingTotal > 2_000_000_000) {
      return errorJson(c, 422, 'INVALID_SHIPPING_TOTAL', 'The shipping total is invalid.');
    }
    const snapshot = addressSnapshot(address);
    await access.db.update(checkoutSessions).set({
      addressId: address.id,
      addressSnapshot: snapshot,
      shippingSelection: shipping,
      shippingTotal,
      paypalOrderId: null,
      status: 'pending',
      updatedAt: new Date(),
    }).where(and(eq(checkoutSessions.id, session.id), eq(checkoutSessions.userId, access.user.id)));
    return c.json({ success: true, data: { address: snapshot, shipping, shippingTotal } });
  } catch (error) {
    console.error('store checkout: fulfillment save failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to save delivery details.');
  }
});

storeCheckout.get('/:sessionId/paypal/config', async (c) => {
  const access = await requireStoreUser(c);
  if (!access.ok) return access.response;
  const [session] = await access.db.select().from(checkoutSessions).where(and(
    eq(checkoutSessions.id, c.req.param('sessionId')),
    eq(checkoutSessions.userId, access.user.id),
  )).limit(1);
  if (!session) return errorJson(c, 404, 'CHECKOUT_NOT_FOUND', 'Checkout session not found.');
  if (session.status === 'completed' || session.status === 'cancelled') {
    return errorJson(c, 409, 'CHECKOUT_CLOSED', 'This checkout is no longer available.');
  }
  const clientId = c.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = c.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return errorJson(c, 503, 'PAYMENT_NOT_CONFIGURED', 'PayPal payments are not available yet.');
  }
  try {
    await getPayPalAccessToken(c.env);
  } catch (error) {
    logPayPalEvent({
      event: 'configuration_invalid',
      sessionId: session.id,
      debugId: error instanceof PayPalApiError ? error.debugId : undefined,
      httpStatus: error instanceof PayPalApiError ? error.httpStatus : undefined,
      issues: error instanceof PayPalApiError ? error.issues : [],
    });
    if (error instanceof PayPalApiError && [401, 403].includes(error.httpStatus ?? 0)) {
      console.warn('store checkout: PayPal credentials may not match the configured environment or app');
    }
    return errorJson(c, 503, 'PAYMENT_NOT_CONFIGURED', 'PayPal payments are not available yet.');
  }
  return c.json({
    success: true,
    data: {
      clientId,
      environment: c.env.PAYPAL_ENVIRONMENT === 'live' ? 'live' : 'sandbox',
      currency: 'USD',
    },
  });
});

storeCheckout.post('/:sessionId/paypal/order', async (c) => {
  const originError = requireTrustedMutationOrigin(c);
  if (originError) return originError;
  const access = await requireStoreUser(c);
  if (!access.ok) return access.response;
  const shippingQuoteSecret = getShippingQuoteSecret(c.env.BETTER_AUTH_SECRET);
  if (!shippingQuoteSecret) {
    console.error('store checkout: BETTER_AUTH_SECRET is missing or shorter than 32 characters');
    return errorJson(c, 503, 'CHECKOUT_SECURITY_UNAVAILABLE', 'Checkout is temporarily unavailable due to a server configuration issue.');
  }
  try {
    const sessionId = c.req.param('sessionId');
    const [session] = await access.db.select().from(checkoutSessions).where(and(
      eq(checkoutSessions.id, sessionId),
      eq(checkoutSessions.userId, access.user.id),
    )).limit(1);
    if (!session) return errorJson(c, 404, 'CHECKOUT_NOT_FOUND', 'Checkout session not found.');
    if (session.expiresAt.getTime() <= Date.now()) return errorJson(c, 410, 'CHECKOUT_EXPIRED', 'This checkout session has expired.');
    if (session.status === 'completed' || session.status === 'cancelled') return errorJson(c, 409, 'CHECKOUT_CLOSED', 'This checkout is no longer available.');
    if (!session.addressId || !session.addressSnapshot || !session.shippingSelection?.length) {
      return errorJson(c, 409, 'FULFILLMENT_REQUIRED', 'Complete your address and shipping details before paying.');
    }
    const shippingAddress = asRecord(session.addressSnapshot);
    const requiredAddressFields = ['firstName', 'lastName', 'countryCode', 'addressLine1', 'city', 'state', 'postalCode'];
    if (!shippingAddress || requiredAddressFields.some((field) => typeof shippingAddress[field] !== 'string')) {
      return errorJson(c, 409, 'FULFILLMENT_REQUIRED', 'Complete your address and shipping details before paying.');
    }
    const addressString = (field: string) => {
      const value = shippingAddress[field];
      return typeof value === 'string' ? value : '';
    };
    const [existingOrder] = await access.db.select({ id: orders.id }).from(orders)
      .where(eq(orders.checkoutSessionId, session.id)).limit(1);
    if (existingOrder) return errorJson(c, 409, 'ORDER_ALREADY_COMPLETED', 'This order has already been paid.');
    if (!access.user.email) return errorJson(c, 422, 'CUSTOMER_EMAIL_REQUIRED', 'Add an email address to your account before paying.');
    const items = await access.db.select().from(checkoutSessionItems).where(eq(checkoutSessionItems.sessionId, session.id));
    if (items.length === 0 || items.length !== session.shippingSelection.length) {
      return errorJson(c, 409, 'INVALID_CHECKOUT_ITEMS', 'This checkout is missing shipping details.');
    }
    for (const item of items) {
      const [sku] = await access.db.select().from(productSkus).where(eq(productSkus.id, item.skuId)).limit(1);
      if (!sku || sku.stock < item.quantity) {
        return errorJson(c, 409, 'INSUFFICIENT_STOCK', `${item.productNameSnapshot} is no longer available in the selected quantity.`);
      }
    }
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPriceSnapshot, 0);
    const itemIds = new Set(items.map((item) => item.id));
    for (const option of session.shippingSelection) {
      const quote = await readShippingQuoteToken(option.quoteId, shippingQuoteSecret);
      if (!quote || quote.sessionId !== session.id || quote.itemId !== option.itemId ||
        quote.addressId !== session.addressId || !itemIds.has(option.itemId) ||
        quote.amountCents !== option.amountCents ||
        quote.serviceName !== option.serviceName ||
        quote.logisticsServiceName !== option.logisticsServiceName) {
        return errorJson(c, 409, 'SHIPPING_QUOTE_EXPIRED', 'Your shipping quote has expired. Refresh your shipping options before paying.');
      }
    }
    const shippingTotal = session.shippingSelection.reduce((sum, option) => sum + option.amountCents, 0);
    const total = subtotal + shippingTotal;
    if (!Number.isSafeInteger(total) || total <= 0 || total > 2_000_000_000) {
      return errorJson(c, 422, 'INVALID_ORDER_TOTAL', 'The order total is invalid.');
    }
    if (session.paypalOrderId) {
      return c.json({ success: true, data: { orderId: session.paypalOrderId } });
    }
    const firstName = addressString('firstName');
    const lastName = addressString('lastName');
    const countryCode = addressString('countryCode').toUpperCase();
    const addressLine1 = addressString('addressLine1');
    const addressLine2 = addressString('addressLine2').trim();
    const city = addressString('city');
    const state = addressString('state').trim();
    const postalCode = addressString('postalCode');
    if (state && ['US', 'CA'].includes(countryCode) && !/^[A-Za-z]{2}$/.test(state)) {
      console.warn('store checkout: PayPal shipping state may need a region code', {
        countryCode,
        stateFormat: 'expected a two-letter region code',
      });
    }
    const paypalBody = await paypalRequest(c.env, '/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'PayPal-Request-Id': await createPayPalRequestId(session.id, total, items, session.shippingSelection),
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: session.id,
          custom_id: session.id,
          amount: {
            currency_code: 'USD',
            value: moneyValue(total),
            breakdown: {
              item_total: { currency_code: 'USD', value: moneyValue(subtotal) },
              shipping: { currency_code: 'USD', value: moneyValue(shippingTotal) },
            },
          },
          items: items.map((item) => ({
            name: item.productNameSnapshot.slice(0, 127),
            ...(item.variantLabelSnapshot ? { description: item.variantLabelSnapshot.slice(0, 127) } : {}),
            unit_amount: { currency_code: 'USD', value: moneyValue(item.unitPriceSnapshot) },
            quantity: String(item.quantity),
            category: 'PHYSICAL_GOODS',
          })),
          shipping: {
            type: 'SHIPPING',
            name: {
              full_name: `${firstName} ${lastName}`.trim().slice(0, 300),
            },
            address: {
              address_line_1: addressLine1,
              ...(addressLine2 ? { address_line_2: addressLine2 } : {}),
              admin_area_2: city,
              ...(state ? { admin_area_1: state } : {}),
              postal_code: postalCode,
              country_code: countryCode,
            },
          },
        }],
        application_context: {
          brand_name: 'Mantomart',
          user_action: 'PAY_NOW',
          shipping_preference: 'SET_PROVIDED_ADDRESS',
        },
      }),
    });
    const paypalOrder = asRecord(paypalBody);
    const paypalOrderId = typeof paypalOrder?.id === 'string' ? paypalOrder.id : '';
    if (!paypalOrderId) {
      logPayPalEvent({
        event: 'order_create_response_incomplete',
        sessionId: session.id,
      }, 'error');
      return errorJson(c, 502, 'PAYMENT_PROVIDER_ERROR', 'PayPal could not start your payment. Please try again.');
    }
    await access.db.update(checkoutSessions).set({
      status: 'awaiting_payment',
      paypalOrderId,
      expiresAt: new Date(Math.max(session.expiresAt.getTime(), Date.now() + 3 * 60 * 60 * 1000)),
      updatedAt: new Date(),
    }).where(and(eq(checkoutSessions.id, session.id), eq(checkoutSessions.userId, access.user.id)));
    return c.json({ success: true, data: { orderId: paypalOrderId } });
  } catch (error) {
    logPayPalFailure('order_create_failed', c.req.param('sessionId'), undefined, error);
    return paypalError(c, error);
  }
});

storeCheckout.post('/:sessionId/paypal/capture', async (c) => {
  const originError = requireTrustedMutationOrigin(c);
  if (originError) return originError;
  const bodyError = requireJson(c);
  if (bodyError) return bodyError;
  const access = await requireStoreUser(c);
  if (!access.ok) return access.response;
  let paypalOrderIdForLog: string | undefined;
  try {
    const sessionId = c.req.param('sessionId');
    const input = asRecord(await c.req.json<unknown>());
    const paypalOrderId = typeof input?.paypalOrderId === 'string' ? input.paypalOrderId.trim() : '';
    const captureAttemptId = typeof input?.captureAttemptId === 'string' ? input.captureAttemptId.trim() : '';
    paypalOrderIdForLog = paypalOrderId;
    if (!paypalOrderId || paypalOrderId.length > 128 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(captureAttemptId)) {
      return errorJson(c, 400, 'INVALID_PAYMENT', 'A valid PayPal order reference is required.');
    }
    const [session] = await access.db.select().from(checkoutSessions).where(and(
      eq(checkoutSessions.id, sessionId),
      eq(checkoutSessions.userId, access.user.id),
    )).limit(1);
    if (!session) return errorJson(c, 404, 'CHECKOUT_NOT_FOUND', 'Checkout session not found.');
    if (session.paypalOrderId !== paypalOrderId || !session.addressId ||
      !session.addressSnapshot || !session.shippingSelection?.length) {
      return errorJson(c, 409, 'PAYMENT_MISMATCH', 'This payment does not match the current checkout. Please retry payment.');
    }
    const [existingOrder] = await access.db.select().from(orders)
      .where(eq(orders.checkoutSessionId, session.id)).limit(1);
    if (existingOrder && existingOrder.paymentProviderOrderId !== paypalOrderId) {
      return errorJson(c, 409, 'PAYMENT_MISMATCH', 'This payment does not match the current checkout. Please retry payment.');
    }
    if (existingOrder && ['paid', 'refunded'].includes(existingOrder.paymentStatus)) {
      return c.json({
        success: true,
        data: {
          orderId: existingOrder.id,
          status: existingOrder.status,
          paymentStatus: existingOrder.paymentStatus,
        },
      });
    }
    const items = await access.db.select().from(checkoutSessionItems).where(eq(checkoutSessionItems.sessionId, session.id));
    if (items.length === 0 || items.length !== session.shippingSelection.length) {
      return errorJson(c, 409, 'INVALID_CHECKOUT_ITEMS', 'This checkout is missing shipping details.');
    }
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPriceSnapshot, 0);
    const shippingTotal = session.shippingSelection.reduce((sum, option) => sum + option.amountCents, 0);
    const total = subtotal + shippingTotal;
    if (!Number.isSafeInteger(total) || total <= 0 || total > 2_000_000_000) {
      return errorJson(c, 422, 'INVALID_ORDER_TOTAL', 'The order total is invalid.');
    }

    const captured = await capturePayPalPayment(
      c.env,
      session.id,
      paypalOrderId,
      captureAttemptId,
      total,
    );
    if (!access.user.email) return errorJson(c, 422, 'CUSTOMER_EMAIL_REQUIRED', 'Add an email address to your account before paying.');
    const paymentStatus = captured.paymentStatus;
    let order: Awaited<ReturnType<typeof persistPayPalOrder>>;
    try {
      order = await persistPayPalOrder(access.db, session.id, paypalOrderId, captured.captureId, paymentStatus);
    } catch {
      logPayPalEvent({
        event: 'capture_persistence_failed',
        sessionId,
        paypalOrderId,
        captureId: captured.captureId,
      }, 'error');
      return c.json({
        success: false,
        error: 'PayPal confirmed the payment, but your order is still being recorded. Retry shortly.',
        code: 'PAYMENT_RECONCILIATION_PENDING',
        retryable: true,
      }, 503);
    }
    logPayPalEvent({
      event: paymentStatus === 'pending' ? 'capture_pending' : 'capture_completed',
      sessionId,
      paypalOrderId,
      captureId: captured.captureId,
      httpStatus: 200,
    });
    return c.json({
      success: true,
      data: {
        orderId: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
      },
    }, existingOrder ? 200 : 201);
  } catch (error) {
    if (error instanceof PayPalOrderMismatchError) {
      logPayPalEvent({
        event: 'capture_order_validation_failed',
        sessionId: c.req.param('sessionId'),
        paypalOrderId: paypalOrderIdForLog,
      }, 'error');
      return errorJson(c, 409, 'PAYMENT_MISMATCH', 'This payment does not match the current checkout. Please retry payment.');
    }
    logPayPalFailure('capture_failed', c.req.param('sessionId'), paypalOrderIdForLog, error);
    return paypalError(c, error);
  }
});

storeCheckout.get('/:sessionId', async (c) => {
  try {
    const access = await requireStoreUser(c);
    if (!access.ok) return access.response;
    const [session] = await access.db.select().from(checkoutSessions).where(and(
      eq(checkoutSessions.id, c.req.param('sessionId')),
      eq(checkoutSessions.userId, access.user.id),
    )).limit(1);
    if (!session) return errorJson(c, 404, 'CHECKOUT_NOT_FOUND', 'Checkout session not found.');
    if (session.expiresAt.getTime() <= Date.now() && session.status !== 'completed' && !session.paypalOrderId) {
      if (session.status === 'pending' || session.status === 'awaiting_payment') {
        await access.db.update(checkoutSessions).set({ status: 'expired', updatedAt: new Date() })
          .where(eq(checkoutSessions.id, session.id));
      }
      return errorJson(c, 410, 'CHECKOUT_EXPIRED', 'This checkout session has expired.');
    }
    const items = await access.db.select().from(checkoutSessionItems).where(eq(checkoutSessionItems.sessionId, session.id));
    const origin = requestOriginFromUrl(c.req.url);
    const [order] = await access.db.select({
      id: orders.id,
      paymentStatus: orders.paymentStatus,
    }).from(orders)
      .where(eq(orders.checkoutSessionId, session.id)).limit(1);
    return c.json({
      success: true,
      data: {
        ...sessionResponse(session, items),
        orderId: order?.id ?? null,
        paymentStatus: order?.paymentStatus ?? null,
        items: items.map((item) => ({
          ...item,
          imageSnapshot: item.imageSnapshot
            ? resolveProductImageUrlForClient(item.imageSnapshot, c.env, { origin }) || item.imageSnapshot
            : null,
          href: `/product/${encodeURIComponent(item.productSlugSnapshot)}`,
        })),
      },
    });
  } catch (error) {
    console.error('store checkout: session load failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to load checkout.');
  }
});

storeCheckout.all('*', (c) => errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));

export default storeCheckout;
