import { Hono } from 'hono';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  requireAdminMiddleware,
  requireAnyPermission,
} from '@/middleware/permission';
import {
  generateKeywordHistoricalMetrics,
  generateKeywordIdeas,
  GoogleAdsApiError,
  type KeywordResearchInput,
} from '@/utils/callGoogleAds';
import {
  GoogleAdsConfigError,
  GoogleAdsNotConnectedError,
  GoogleAdsTokenError,
} from '@/utils/manageGoogleAuthTokens';
import type { AppEnv, ErrorStatus } from '@/utils/errorJson';
import { errorJson } from '@/utils/errorJson';

const googleKeywords = new Hono<AppEnv>();

type MappedError = {
  status: ErrorStatus;
  code: string;
  message: string;
};

function toErrorStatus(status: number): ErrorStatus {
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 409 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503
  ) {
    return status;
  }
  return 502;
}

function mapUpstreamError(error: unknown): MappedError {
  if (error instanceof GoogleAdsConfigError) {
    return {
      status: 503,
      code: 'GOOGLE_ADS_CONFIG_MISSING',
      message: error.message,
    };
  }

  if (error instanceof GoogleAdsNotConnectedError) {
    return {
      status: 409,
      code: 'GOOGLE_ADS_NOT_CONNECTED',
      message:
        'Google Ads is not connected. Connect it from Integrations before researching keywords.',
    };
  }

  if (error instanceof GoogleAdsTokenError) {
    return {
      status: 401,
      code: 'GOOGLE_ADS_AUTH_EXPIRED',
      message:
        'Google Ads authorization expired or was revoked. Please reconnect Google Ads.',
    };
  }

  if (error instanceof GoogleAdsApiError) {
    return {
      status: toErrorStatus(error.status),
      code: error.code,
      message: error.publicMessage,
    };
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      lower.includes('network') ||
      lower.includes('fetch failed') ||
      lower.includes('timeout')
    ) {
      return {
        status: 503,
        code: 'GOOGLE_ADS_UNAVAILABLE',
        message: 'Google Ads is temporarily unavailable. Please try again later.',
      };
    }

    return {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: error.message || 'An unexpected error occurred.',
    };
  }

  return {
    status: 500,
    code: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred.',
  };
}

function parseBodyKeywords(body: unknown): KeywordResearchInput {
  if (!body || typeof body !== 'object') {
    return {};
  }

  const raw = body as Record<string, unknown>;

  let keywords: string[] | undefined;
  if (Array.isArray(raw.keywords)) {
    keywords = raw.keywords.filter((k): k is string => typeof k === 'string');
  } else if (typeof raw.keyword === 'string') {
    keywords = [raw.keyword];
  } else if (typeof raw.q === 'string') {
    keywords = [raw.q];
  }

  let geoTargetIds: string[] | undefined;
  if (Array.isArray(raw.geoTargetIds)) {
    geoTargetIds = raw.geoTargetIds.map(String);
  } else if (typeof raw.geo === 'string') {
    geoTargetIds = raw.geo.split(',').map((s) => s.trim()).filter(Boolean);
  }

  return {
    keywords,
    url: typeof raw.url === 'string' ? raw.url : null,
    languageId:
      typeof raw.languageId === 'string'
        ? raw.languageId
        : typeof raw.lang === 'string'
          ? raw.lang
          : undefined,
    geoTargetIds,
    pageSize:
      typeof raw.pageSize === 'number'
        ? raw.pageSize
        : typeof raw.pageSize === 'string'
          ? Number(raw.pageSize)
          : undefined,
    pageToken: typeof raw.pageToken === 'string' ? raw.pageToken : null,
    includeAdultKeywords: Boolean(raw.includeAdultKeywords),
  };
}

googleKeywords.use('*', requireAdminMiddleware);

/**
 * Keyword Planner idea generation (related keywords + volumes).
 * POST /api/google/keywords/ideas
 */
googleKeywords.post(
  '/ideas',
  requireAnyPermission(
    PERMISSIONS.GOOGLE_KEYWORD_RESEARCH,
    PERMISSIONS.PRODUCT_CREATE,
    PERMISSIONS.PRODUCT_UPDATE
  ),
  async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      return errorJson(c, 400, 'INVALID_JSON', 'Request body must be valid JSON.');
    }

    const input = parseBodyKeywords(body);

    try {
      const result = await generateKeywordIdeas(c.env, input);
      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Google keyword ideas error:', error);
      const mapped = mapUpstreamError(error);
      return errorJson(c, mapped.status, mapped.code, mapped.message);
    }
  }
);

/**
 * Exact keyword historical metrics.
 * POST /api/google/keywords/metrics
 */
googleKeywords.post(
  '/metrics',
  requireAnyPermission(
    PERMISSIONS.GOOGLE_KEYWORD_RESEARCH,
    PERMISSIONS.PRODUCT_CREATE,
    PERMISSIONS.PRODUCT_UPDATE
  ),
  async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      return errorJson(c, 400, 'INVALID_JSON', 'Request body must be valid JSON.');
    }

    const input = parseBodyKeywords(body);

    try {
      const result = await generateKeywordHistoricalMetrics(c.env, input);
      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Google keyword metrics error:', error);
      const mapped = mapUpstreamError(error);
      return errorJson(c, mapped.status, mapped.code, mapped.message);
    }
  }
);

/**
 * Convenience research endpoint used by the admin keyword sheet.
 * Accepts either JSON body or query params: q / keyword.
 * GET|POST /api/google/keywords/research
 */
async function handleResearch(c: import('hono').Context<AppEnv>) {
  let input: KeywordResearchInput = {};

  if (c.req.method === 'POST') {
    try {
      const body = await c.req.json();
      input = parseBodyKeywords(body);
    } catch {
      // fall through to query params
    }
  }

  const q = c.req.query('q') || c.req.query('keyword');
  if ((!input.keywords || input.keywords.length === 0) && q) {
    input.keywords = [q];
  }

  if (c.req.query('geo') && !input.geoTargetIds) {
    input.geoTargetIds = c.req
      .query('geo')!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (c.req.query('lang') && !input.languageId) {
    input.languageId = c.req.query('lang')!;
  }

  if (c.req.query('url') && !input.url) {
    input.url = c.req.query('url');
  }

  const pageSizeRaw = c.req.query('pageSize');
  if (pageSizeRaw && input.pageSize == null) {
    input.pageSize = Number(pageSizeRaw);
  }

  try {
    const result = await generateKeywordIdeas(c.env, input);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Google keyword research error:', error);
    const mapped = mapUpstreamError(error);
    return errorJson(c, mapped.status, mapped.code, mapped.message);
  }
}

const researchPermissions = requireAnyPermission(
  PERMISSIONS.GOOGLE_KEYWORD_RESEARCH,
  PERMISSIONS.PRODUCT_CREATE,
  PERMISSIONS.PRODUCT_UPDATE
);

googleKeywords.get('/research', researchPermissions, handleResearch);
googleKeywords.post('/research', researchPermissions, handleResearch);

export default googleKeywords;
