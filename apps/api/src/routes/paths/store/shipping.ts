import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { addresses, checkoutSessionItems, checkoutSessions, productSkus, products } from '@repo/db';
import type Env from '@/types/env';
import { errorJson } from '@/utils/http/errorJson';
import { callAE } from '@/utils/aliexpress/callAE';
import { getAccessToken } from '@/utils/aliexpress/manageAEauthTokens';
import {
  createShippingQuoteToken,
  fingerprintShippingAddress,
  getShippingQuoteSecret,
  type ShippingQuotePayload,
} from '@/utils/aliexpress/checkoutShipping';
import { requireJson, requireStoreUser, requireTrustedMutationOrigin } from './cart';

const storeShipping = new Hono<{ Bindings: Env }>();
const QUOTE_TTL_MS = 15 * 60 * 1000;

type ShippingOption = {
  serviceName: string;
  logisticsServiceName: string;
  amountCents: number;
  minDays: number | null;
  maxDays: number | null;
};

type ItemShippingResult = {
  item: {
    id: string;
    productNameSnapshot: string;
  };
  options: ShippingOption[];
  error?: string;
  retryable?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getFreightResult(response: unknown) {
  const root = asRecord(response);
  const freightResponse = asRecord(root?.aliexpress_ds_freight_query_response);
  return asRecord(freightResponse?.result);
}

function getDeliveryOptions(result: Record<string, unknown>) {
  const deliveryOptions = asRecord(result.delivery_options);
  const rows = deliveryOptions?.delivery_option_d_t_o;
  return Array.isArray(rows)
    ? rows.map(asRecord).filter((row): row is Record<string, unknown> => row !== null)
    : [];
}

function optionString(record: Record<string, unknown>, names: string[]) {
  const normalized = new Map(Object.entries(record).map(([key, value]) => [
    key.toLowerCase().replace(/[^a-z]/g, ''),
    value,
  ]));
  for (const name of names) {
    const value = normalized.get(name.toLowerCase().replace(/[^a-z]/g, ''));
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function parseAmount(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(String(value).replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function parseShippingOptions(result: Record<string, unknown>): ShippingOption[] {
  const options = getDeliveryOptions(result).flatMap((option) => {
    const logisticsServiceName = optionString(option, ['code']);
    const serviceName = optionString(option, ['company']) ?? logisticsServiceName;
    const freeShipping = option.free_shipping === true || option.free_shipping === 'true';
    const amountCents = freeShipping
      ? 0
      : parseAmount(option.shipping_fee_cent)
        ?? parseAmount(option.shipping_fee_format);
    const currency = optionString(option, ['shipping_fee_currency']);
    if (
      !logisticsServiceName ||
      !serviceName ||
      amountCents === null ||
      (currency && currency.toUpperCase() !== 'USD')
    ) return [];
    const minDays = Number(option.min_delivery_days);
    const maxDays = Number(option.max_delivery_days);
    return [{
      serviceName: serviceName.slice(0, 160),
      logisticsServiceName: logisticsServiceName.slice(0, 160),
      amountCents,
      minDays: Number.isInteger(minDays) && minDays >= 0 ? minDays : null,
      maxDays: Number.isInteger(maxDays) && maxDays >= 0 ? maxDays : null,
    }];
  });
  return Array.from(new Map(options.map((option) => [
    `${option.logisticsServiceName}:${option.amountCents}`,
    option,
  ])).values()).slice(0, 10);
}

storeShipping.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  c.header('Vary', 'Cookie');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});

storeShipping.post('/:sessionId/quotes', async (c) => {
  const originError = requireTrustedMutationOrigin(c);
  if (originError) return originError;
  const bodyError = requireJson(c);
  if (bodyError) return bodyError;
  const access = await requireStoreUser(c);
  if (!access.ok) return access.response;
  const secret = getShippingQuoteSecret(c.env.BETTER_AUTH_SECRET);
  if (!secret) {
    console.error('store shipping: BETTER_AUTH_SECRET is missing or shorter than 32 characters');
    return errorJson(c, 503, 'CHECKOUT_SECURITY_UNAVAILABLE', 'Checkout is temporarily unavailable due to a server configuration issue.');
  }
  try {
    const input = asRecord(await c.req.json<unknown>());
    const addressId = input?.addressId;
    if (typeof addressId !== 'string' || !addressId.trim() || addressId.length > 128) {
      return errorJson(c, 400, 'INVALID_ADDRESS', 'Select a valid delivery address.');
    }
    const [session] = await access.db.select().from(checkoutSessions).where(and(
      eq(checkoutSessions.id, c.req.param('sessionId')),
      eq(checkoutSessions.userId, access.user.id),
    )).limit(1);
    if (!session) return errorJson(c, 404, 'CHECKOUT_NOT_FOUND', 'Checkout session not found.');
    if (session.expiresAt.getTime() <= Date.now()) return errorJson(c, 410, 'CHECKOUT_EXPIRED', 'This checkout session has expired.');
    if (session.status === 'completed' || session.status === 'cancelled') return errorJson(c, 409, 'CHECKOUT_CLOSED', 'This checkout is no longer available.');
    const [address] = await access.db.select().from(addresses).where(and(
      eq(addresses.id, addressId),
      eq(addresses.userId, access.user.id),
    )).limit(1);
    if (!address) return errorJson(c, 404, 'ADDRESS_NOT_FOUND', 'That delivery address was not found.');

    const checkoutItems = await access.db.select().from(checkoutSessionItems).where(eq(checkoutSessionItems.sessionId, session.id));
    let items = checkoutItems;
    if (input?.itemIds !== undefined) {
      const requestedItemIds = input.itemIds;
      if (!Array.isArray(requestedItemIds) || requestedItemIds.length === 0 || requestedItemIds.length > 30 ||
        requestedItemIds.some((itemId) => typeof itemId !== 'string' || !itemId.trim()) ||
        new Set(requestedItemIds).size !== requestedItemIds.length) {
        return errorJson(c, 400, 'INVALID_SHIPPING_ITEMS', 'Select valid items for shipping quotes.');
      }
      const requestedIds = new Set(requestedItemIds);
      items = checkoutItems.filter((item) => requestedIds.has(item.id));
      if (items.length !== requestedItemIds.length) {
        return errorJson(c, 400, 'INVALID_SHIPPING_ITEMS', 'Select valid items for shipping quotes.');
      }
    }
    if (items.length === 0 || items.length > 30) return errorJson(c, 409, 'INVALID_CHECKOUT_ITEMS', 'This checkout cannot be shipped.');
    let aliExpressSession: string;
    try {
      aliExpressSession = await getAccessToken(c.env);
    } catch (error) {
      console.error('store shipping: AliExpress authorization unavailable', error);
      return errorJson(c, 503, 'SHIPPING_PROVIDER_UNAVAILABLE', 'Shipping quotes are temporarily unavailable.');
    }
    const rows: ItemShippingResult[] = [];
    for (let offset = 0; offset < items.length; offset += 4) {
      const batch = await Promise.all(items.slice(offset, offset + 4).map(async (item) => {
        const [product, sku] = await Promise.all([
          access.db.select().from(products).where(eq(products.id, item.productId)).limit(1),
          access.db.select().from(productSkus).where(eq(productSkus.id, item.skuId)).limit(1),
        ]);
        const productRow = product[0];
        const skuRow = sku[0];
        if (!productRow?.isAEProduct || !productRow.aeProductId || !skuRow?.aeSkuId) {
          return {
            item,
            options: [],
            error: 'Shipping is unavailable for this item.',
            retryable: false,
          };
        }
        let response: unknown;
        try {
          response = await callAE(c.env, 'aliexpress.ds.freight.query', {
            queryDeliveryReq: {
              quantity: item.quantity,
              shipToCountry: address.countryCode.toUpperCase(),
              productId: productRow.aeProductId,
              province: address.state,
              selectedSkuId: skuRow.aeSkuId,
              language: 'en_US',
              currency: 'USD',
              locale: 'zh_CN',
            },
          }, aliExpressSession);
        } catch (error) {
          console.error('store shipping: freight request failed', {
            itemId: item.id,
            error,
          });
          return {
            item,
            options: [],
            error: 'AliExpress could not calculate shipping for this item right now. Try again shortly.',
            retryable: true,
          };
        }

        const result = getFreightResult(response);
        if (!result || result.success !== true || Number(result.code) !== 200) {
          const code = String(result?.code ?? 'unknown');
          const requestId = asRecord(asRecord(response)?.aliexpress_ds_freight_query_response)?.request_id;
          console.warn('store shipping: AliExpress returned a freight error', {
            itemId: item.id,
            code,
            requestId,
          });
          const addressUnavailable = code === '505' || result?.msg === 'DELIVERY_NOT_AVAILABLE_TO_YOUR_ADDRESS';
          const error = addressUnavailable
            ? "AliExpress can't deliver this item to your address. Try another delivery address."
            : code === '506' || result?.msg === 'DELIVERY_SERVICE_EXCEPTION'
              ? 'AliExpress could not calculate shipping for this item right now. Try again shortly or use another address.'
              : 'AliExpress could not provide shipping options for this item. Please try again.';
          return { item, options: [], error, retryable: !addressUnavailable };
        }

        const options = parseShippingOptions(result);
        if (options.length === 0) {
          return {
            item,
            options,
            error: 'No delivery services are available for this item and address.',
            retryable: false,
          };
        }
        return { item, options };
      }));
      rows.push(...batch);
    }

    const expiresAt = Date.now() + QUOTE_TTL_MS;
    const addressFingerprint = await fingerprintShippingAddress(address);
    const result = await Promise.all(rows.map(async ({ item, options, error, retryable }) => ({
      itemId: item.id,
      productName: item.productNameSnapshot,
      ...(error ? { error, retryable: retryable === true } : {}),
      options: await Promise.all(options.map(async (option) => {
        const payload: ShippingQuotePayload = {
          sessionId: session.id,
          itemId: item.id,
          addressId,
          addressFingerprint,
          serviceName: option.serviceName,
          logisticsServiceName: option.logisticsServiceName,
          amountCents: option.amountCents,
          currency: 'USD',
          minDays: option.minDays,
          maxDays: option.maxDays,
          expiresAt,
        };
        return {
          ...option,
          currency: 'USD',
          quoteId: await createShippingQuoteToken(payload, secret),
        };
      })),
    })));
    return c.json({ success: true, data: { expiresAt: new Date(expiresAt).toISOString(), items: result } });
  } catch (error) {
    console.error('store shipping: quote lookup failed', error);
    return errorJson(c, 502, 'SHIPPING_PROVIDER_ERROR', 'Unable to calculate shipping right now.');
  }
});

storeShipping.all('*', (c) => errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));

export default storeShipping;
