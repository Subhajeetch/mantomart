import { Hono } from 'hono';
import type Env from '@/types/env';
import { callAE } from '@/utils/callAE';
import {
  AliExpressNotConnectedError,
  AliExpressTokenError,
  getAccessToken,
} from '@/utils/manageAEauthTokens';
import { errorJson } from '@/utils/errorJson';

const aeProduct = new Hono<{ Bindings: Env }>();

function getErrorMessage(error: unknown): string {
  if (error instanceof AliExpressTokenError) {
    return error.publicMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error occurred.';
}

function mapAliExpressError(error: unknown, fallbackMessage: string) {
  const message = getErrorMessage(error);
  const lowerMessage = message.toLowerCase();

  if (
    error instanceof AliExpressNotConnectedError ||
    lowerMessage.includes('not connected')
  ) {
    return {
      status: 401 as const,
      code: 'ALIEXPRESS_NOT_CONNECTED',
      message: 'AliExpress is not connected. Please connect AliExpress first.',
    };
  }

  if (
    lowerMessage.includes('invalid token') ||
    lowerMessage.includes('expired token') ||
    lowerMessage.includes('invalid session') ||
    lowerMessage.includes('session expired')
  ) {
    return {
      status: 401 as const,
      code: 'ALIEXPRESS_AUTH_EXPIRED',
      message: 'AliExpress authorization expired. Please reconnect AliExpress.',
    };
  }

  if (
    lowerMessage.includes('permission') ||
    lowerMessage.includes('forbidden') ||
    lowerMessage.includes('access denied')
  ) {
    return {
      status: 403 as const,
      code: 'ALIEXPRESS_PERMISSION_DENIED',
      message: 'AliExpress denied permission for this request.',
    };
  }

  if (
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('too many requests')
  ) {
    return {
      status: 429 as const,
      code: 'ALIEXPRESS_RATE_LIMITED',
      message: 'AliExpress rate limit reached. Please try again later.',
    };
  }

  if (lowerMessage.includes('not found')) {
    return {
      status: 404 as const,
      code: 'ALIEXPRESS_RESOURCE_NOT_FOUND',
      message: 'The requested AliExpress resource was not found.',
    };
  }

  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('fetch failed') ||
    lowerMessage.includes('network')
  ) {
    return {
      status: 503 as const,
      code: 'ALIEXPRESS_UNAVAILABLE',
      message: 'AliExpress is temporarily unavailable. Please try again later.',
    };
  }

  if (
    error instanceof AliExpressTokenError ||
    lowerMessage.includes('aliexpress')
  ) {
    return {
      status: 502 as const,
      code: 'ALIEXPRESS_UPSTREAM_ERROR',
      message,
    };
  }

  return {
    status: 500 as const,
    code: 'INTERNAL_ERROR',
    message: fallbackMessage,
  };
}

type PositiveIntegerResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

const SORT_VALUES = new Set([
  'min_price,asc',
  'min_price,desc',
  'orders,asc',
  'orders,desc',
  'comments,asc',
  'comments,desc',
]);

function parseSearchExtend(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 20) return null;
    if (
      parsed.some(
        (item) =>
          typeof item !== 'object' ||
          item === null ||
          Array.isArray(item) ||
          Object.keys(item).some(
            (key) => !['min', 'max', 'searchKey', 'searchValue'].includes(key)
          )
      )
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  fieldName: string,
  max?: number
): PositiveIntegerResult {
  if (value === undefined || value === '') {
    return { ok: true, value: fallback };
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      ok: false,
      error: `${fieldName} must be a positive integer.`,
    };
  }

  if (max !== undefined && parsed > max) {
    return {
      ok: false,
      error: `${fieldName} must be between 1 and ${max}.`,
    };
  }

  return { ok: true, value: parsed };
}

// search products by keyword
aeProduct.get('/product/search', async (c) => {
  const {
    q,
    local,
    cc,
    itemnum,
    page,
    currency,
    categoryId,
    sortBy,
    searchExtend,
    searchKey,
    searchValue,
    max,
    min,
    selectionName,
  } = c.req.query();

  const keyword = q?.trim();

  if (!keyword) {
    return errorJson(c, 400, 'MISSING_QUERY', 'q is required.');
  }

  const pageSizeResult = parsePositiveInteger(itemnum, 20, 'itemnum', 100);
  if (!pageSizeResult.ok) {
    return errorJson(c, 400, 'INVALID_ITEMNUM', pageSizeResult.error);
  }

  const pageIndexResult = parsePositiveInteger(page, 1, 'page');
  if (!pageIndexResult.ok) {
    return errorJson(c, 400, 'INVALID_PAGE', pageIndexResult.error);
  }

  let categoryIdValue: number | undefined;
  if (categoryId) {
    const parsedCategory = Number(categoryId);
    if (!Number.isInteger(parsedCategory) || parsedCategory <= 0) {
      return errorJson(
        c,
        400,
        'INVALID_CATEGORY_ID',
        'categoryId must be a positive integer.'
      );
    }
    categoryIdValue = parsedCategory;
  }

  if (sortBy && !SORT_VALUES.has(sortBy)) {
    return errorJson(
      c,
      400,
      'INVALID_SORT',
      'sortBy contains an unsupported value.'
    );
  }

  const parsedSearchExtend = parseSearchExtend(searchExtend);
  if (searchExtend && parsedSearchExtend === null) {
    return errorJson(
      c,
      400,
      'INVALID_SEARCH_EXTEND',
      'searchExtend must be a valid array of filter objects.'
    );
  }

  let session: string;

  try {
    session = await getAccessToken(c.env);
  } catch (error) {
    const mappedError = mapAliExpressError(
      error,
      'Failed to get AliExpress access token.'
    );
    return errorJson(
      c,
      mappedError.status,
      mappedError.code,
      mappedError.message
    );
  }

  try {
    const data = await callAE(
      c.env,
      'aliexpress.ds.text.search',
      {
        keyWord: keyword,
        pageSize: pageSizeResult.value,
        pageIndex: pageIndexResult.value,
        local: local || 'en_US',
        countryCode: cc || 'US',
        currency: currency || 'USD',
        ...(categoryIdValue ? { categoryId: categoryIdValue } : {}),
        ...(sortBy ? { sortBy } : {}),
        ...(parsedSearchExtend ? { searchExtend: parsedSearchExtend } : {}),
        ...(searchKey ? { searchKey } : {}),
        ...(searchValue ? { searchValue } : {}),
        ...(max ? { max } : {}),
        ...(min ? { min } : {}),
        ...(selectionName ? { selectionName } : {}),
      },
      session
    );

    return c.json(data);
  } catch (error) {
    console.error('Error searching products:', error);

    const mappedError = mapAliExpressError(error, 'Failed to search products.');
    return errorJson(
      c,
      mappedError.status,
      mappedError.code,
      mappedError.message
    );
  }
});

// get product info by id
aeProduct.get('/product/:id', async (c) => {
  const { id } = c.req.param();
  const {
    shipToCountry,
    currency,
    lang,
    provinceCode,
    cityCode,
    bizModel,
    removePersonalBenefit,
  } = c.req.query();

  const productId = id?.trim();

  if (!productId) {
    return errorJson(c, 400, 'MISSING_PRODUCT_ID', 'Product id is required.');
  }

  if (!shipToCountry?.trim()) {
    return errorJson(
      c,
      400,
      'MISSING_SHIP_TO_COUNTRY',
      'shipToCountry is required.'
    );
  }

  let session: string;

  try {
    session = await getAccessToken(c.env);
  } catch (error) {
    const mappedError = mapAliExpressError(
      error,
      'Failed to get AliExpress access token.'
    );
    return errorJson(
      c,
      mappedError.status,
      mappedError.code,
      mappedError.message
    );
  }

  try {
    const params: Record<string, string> = {
      product_id: productId,
      ship_to_country: shipToCountry,
      target_currency: currency || 'USD',
      target_language: lang || 'en',
      remove_personal_benefit:
        removePersonalBenefit === 'true' ? 'true' : 'false',
    };

    if (provinceCode) params.province_code = provinceCode;
    if (cityCode) params.city_code = cityCode;
    if (bizModel) params.biz_model = bizModel;

    const data = await callAE(
      c.env,
      'aliexpress.ds.product.get',
      params,
      session
    );

    return c.json(data);
    console.log('Product info fetched successfully:', data);
  } catch (error) {
    console.error('Error fetching product info:', error);

    const mappedError = mapAliExpressError(
      error,
      'Failed to fetch product info.'
    );
    return errorJson(
      c,
      mappedError.status,
      mappedError.code,
      mappedError.message
    );
  }
});

export default aeProduct;
