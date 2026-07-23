import config from '@/base.config';
import {
  assertGoogleAdsConfig,
  getGoogleAccessToken,
  type GoogleAdsEnv,
} from '@/utils/manageGoogleAuthTokens';

const { GOOGLE_ADS_API_BASE } = config;

export type KeywordCompetition =
  | 'UNSPECIFIED'
  | 'UNKNOWN'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | string;

export type MonthlySearchVolume = {
  year: number | null;
  month: string | null;
  monthlySearches: number | null;
};

export type KeywordIdea = {
  keyword: string;
  avgMonthlySearches: number | null;
  competition: KeywordCompetition | null;
  competitionIndex: number | null;
  lowTopOfPageBidMicros: number | null;
  highTopOfPageBidMicros: number | null;
  /** Approximate CPC in account currency (micros / 1_000_000). */
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  monthlySearchVolumes: MonthlySearchVolume[];
};

export type KeywordResearchResult = {
  keywords: KeywordIdea[];
  nextPageToken: string | null;
  totalResults: number;
  seed: {
    keywords: string[];
    url: string | null;
  };
  geoTargetIds: string[];
  languageId: string;
};

export type KeywordResearchInput = {
  /** Seed keywords (1–20). */
  keywords?: string[];
  /** Optional landing-page URL seed. */
  url?: string | null;
  /** Google language constant id, e.g. "1000" for English. */
  languageId?: string;
  /** Geo target constant ids without prefix, e.g. ["2840"] for US. */
  geoTargetIds?: string[];
  pageSize?: number;
  pageToken?: string | null;
  includeAdultKeywords?: boolean;
};

export type GoogleAdsCustomerAccessDiagnostics = {
  configuredCustomerId: string;
  configuredLoginCustomerId: string | null;
  accessibleCustomerIds: string[];
  resourceNames: string[];
};

export class GoogleAdsApiError extends Error {
  publicMessage: string;
  status: number;
  raw: unknown;
  code: string;

  constructor(
    message: string,
    opts: { status?: number; raw?: unknown; code?: string } = {}
  ) {
    super(message);
    this.name = 'GoogleAdsApiError';
    this.publicMessage = message;
    this.status = opts.status ?? 502;
    this.raw = opts.raw;
    this.code = opts.code ?? 'GOOGLE_ADS_API_ERROR';
  }
}

function microsToCurrency(micros: unknown): number | null {
  const n = Number(micros);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 1_000_000) * 100) / 100;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeKeywords(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of input) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().replace(/\s+/g, ' ');
    if (!trimmed || trimmed.length > 80) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 20) break;
  }

  return out;
}

function sanitizeGeoIds(input: unknown, fallback: string[]): string[] {
  const source = Array.isArray(input) ? input : fallback;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of source) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const id = String(item).replace(/\D/g, '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 10) break;
  }

  return out.length > 0 ? out : fallback;
}

function mapKeywordIdea(raw: unknown): KeywordIdea | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;

  const text =
    typeof row.text === 'string'
      ? row.text
      : typeof (row.keywordIdeaMetrics as Record<string, unknown> | undefined)
            ?.text === 'string'
        ? String((row.keywordIdeaMetrics as Record<string, unknown>).text)
        : null;

  // generateKeywordIdeas returns `text` at top level in recent API versions
  const keyword =
    (typeof row.text === 'string' && row.text) ||
    (typeof row.keyword === 'string' && row.keyword) ||
    text;

  if (!keyword || typeof keyword !== 'string') return null;

  const metrics =
    row.keywordIdeaMetrics && typeof row.keywordIdeaMetrics === 'object'
      ? (row.keywordIdeaMetrics as Record<string, unknown>)
      : {};

  const monthlyRaw = Array.isArray(metrics.monthlySearchVolumes)
    ? metrics.monthlySearchVolumes
    : [];

  const monthlySearchVolumes: MonthlySearchVolume[] = monthlyRaw
    .map((m) => {
      if (!m || typeof m !== 'object') return null;
      const month = m as Record<string, unknown>;
      return {
        year: toNullableNumber(month.year),
        month: typeof month.month === 'string' ? month.month : null,
        monthlySearches: toNullableNumber(month.monthlySearches),
      };
    })
    .filter((m): m is MonthlySearchVolume => m !== null);

  const lowMicros = toNullableNumber(metrics.lowTopOfPageBidMicros);
  const highMicros = toNullableNumber(metrics.highTopOfPageBidMicros);

  return {
    keyword: keyword.trim(),
    avgMonthlySearches: toNullableNumber(metrics.avgMonthlySearches),
    competition:
      typeof metrics.competition === 'string' ? metrics.competition : null,
    competitionIndex: toNullableNumber(metrics.competitionIndex),
    lowTopOfPageBidMicros: lowMicros,
    highTopOfPageBidMicros: highMicros,
    lowTopOfPageBid: microsToCurrency(lowMicros),
    highTopOfPageBid: microsToCurrency(highMicros),
    monthlySearchVolumes,
  };
}

async function parseGoogleAdsJson(
  res: Response,
  context: string
): Promise<Record<string, unknown>> {
  const rawText = await res.text();
  let data: unknown;

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (parseError) {
    console.error(
      `${context}: Non-JSON response. Status: ${res.status}. Body:`,
      rawText.slice(0, 1000)
    );

    const message =
      res.status === 404
        ? `${context}: Google Ads endpoint was not found. Check the configured Google Ads API version.`
        : `${context}: invalid JSON response (status ${res.status}). The API may be unavailable or returned an error page.`;

    throw new GoogleAdsApiError(message, {
      status: res.status || 502,
      code: 'GOOGLE_ADS_INVALID_RESPONSE',
      raw: rawText || parseError,
    });
  }

  if (!res.ok) {
    const errObj =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const errorBlock =
      errObj.error && typeof errObj.error === 'object'
        ? (errObj.error as Record<string, unknown>)
        : errObj;

    const message =
      (typeof errorBlock.message === 'string' && errorBlock.message) ||
      (typeof errObj.message === 'string' && errObj.message) ||
      `${context} failed with status ${res.status}`;

    const status = res.status;
    let code = 'GOOGLE_ADS_API_ERROR';

    if (status === 401 || status === 403) code = 'GOOGLE_ADS_AUTH_ERROR';
    if (status === 429) code = 'GOOGLE_ADS_RATE_LIMITED';
    if (status >= 500) code = 'GOOGLE_ADS_UNAVAILABLE';

    // Prefer first Google Ads failure detail when present
    const details = Array.isArray(errorBlock.details) ? errorBlock.details : [];
    let detailMessage = message;
    for (const detail of details) {
      if (!detail || typeof detail !== 'object') continue;
      const d = detail as Record<string, unknown>;
      const errors = Array.isArray(d.errors) ? d.errors : [];
      for (const e of errors) {
        if (e && typeof e === 'object') {
          const msg = (e as Record<string, unknown>).message;
          if (typeof msg === 'string' && msg.length > 0) {
            detailMessage = msg;
            break;
          }
        }
      }
    }

    throw new GoogleAdsApiError(detailMessage, {
      status: status >= 400 && status < 600 ? status : 502,
      raw: data,
      code,
    });
  }

  return (data && typeof data === 'object' ? data : {}) as Record<
    string,
    unknown
  >;
}

/**
 * Call Google Ads KeywordPlanIdeaService.GenerateKeywordIdeas (REST).
 * Requires a connected Google Ads OAuth session stored in KV.
 */
export async function generateKeywordIdeas(
  env: GoogleAdsEnv,
  input: KeywordResearchInput
): Promise<KeywordResearchResult> {
  const cfg = assertGoogleAdsConfig(env);
  const accessToken = await getGoogleAccessToken(env);

  const seedKeywords = sanitizeKeywords(input.keywords);
  const seedUrl =
    typeof input.url === 'string' && input.url.trim().length > 0
      ? input.url.trim().slice(0, 2048)
      : null;

  if (seedKeywords.length === 0 && !seedUrl) {
    throw new GoogleAdsApiError(
      'Provide at least one seed keyword or a page URL.',
      { status: 400, code: 'MISSING_SEED' }
    );
  }

  const languageId =
    String(input.languageId || config.GOOGLE_ADS_DEFAULT_LANGUAGE_ID).replace(
      /\D/g,
      ''
    ) || config.GOOGLE_ADS_DEFAULT_LANGUAGE_ID;

  const geoTargetIds = sanitizeGeoIds(
    input.geoTargetIds,
    config.GOOGLE_ADS_DEFAULT_GEO_TARGET_IDS
  );

  const pageSize = Math.min(Math.max(Number(input.pageSize) || 25, 1), 100);

  const body: Record<string, unknown> = {
    language: `languageConstants/${languageId}`,
    geoTargetConstants: geoTargetIds.map((id) => `geoTargetConstants/${id}`),
    includeAdultKeywords: Boolean(input.includeAdultKeywords),
    keywordPlanNetwork: 'GOOGLE_SEARCH',
    pageSize,
  };

  if (input.pageToken) {
    body.pageToken = input.pageToken;
  }

  if (seedKeywords.length > 0) {
    body.keywordSeed = { keywords: seedKeywords };
  }

  if (seedUrl) {
    body.urlSeed = { url: seedUrl };
  }

  // When both are provided, Google prefers keywordAndUrlSeed
  if (seedKeywords.length > 0 && seedUrl) {
    delete body.keywordSeed;
    delete body.urlSeed;
    body.keywordAndUrlSeed = {
      keywords: seedKeywords,
      url: seedUrl,
    };
  }

  const url = `${GOOGLE_ADS_API_BASE}/customers/${cfg.customerId}:generateKeywordIdeas`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': cfg.developerToken,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (cfg.loginCustomerId) {
    headers['login-customer-id'] = cfg.loginCustomerId;
  }

  console.log('[GoogleAds] Calling:', url);
  console.log('[GoogleAds] Headers:', {
    Authorization: `Bearer ${accessToken.slice(0, 10)}...`,
    'developer-token': `${cfg.developerToken.slice(0, 10)}...`,
    'login-customer-id': cfg.loginCustomerId || '(not set)',
  });
  console.log('[GoogleAds] Body:', JSON.stringify(body).slice(0, 500));

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new GoogleAdsApiError(
      'Unable to reach Google Ads API. Please try again later.',
      {
        status: 503,
        code: 'GOOGLE_ADS_UNAVAILABLE',
        raw: err instanceof Error ? err.message : err,
      }
    );
  }

  console.log('[GoogleAds] Response status:', res.status);

  const data = await parseGoogleAdsJson(res, 'Keyword idea generation');

  const results = Array.isArray(data.results) ? data.results : [];
  const keywords = results
    .map(mapKeywordIdea)
    .filter((k): k is KeywordIdea => k !== null);

  return {
    keywords,
    nextPageToken:
      typeof data.nextPageToken === 'string' ? data.nextPageToken : null,
    totalResults: keywords.length,
    seed: {
      keywords: seedKeywords,
      url: seedUrl,
    },
    geoTargetIds,
    languageId,
  };
}

/**
 * Fetch historical metrics for exact keywords (KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics).
 */
export async function generateKeywordHistoricalMetrics(
  env: GoogleAdsEnv,
  input: Omit<KeywordResearchInput, 'url' | 'pageToken'>
): Promise<KeywordResearchResult> {
  const cfg = assertGoogleAdsConfig(env);
  const accessToken = await getGoogleAccessToken(env);

  const seedKeywords = sanitizeKeywords(input.keywords);
  if (seedKeywords.length === 0) {
    throw new GoogleAdsApiError('Provide at least one keyword.', {
      status: 400,
      code: 'MISSING_SEED',
    });
  }

  const languageId =
    String(input.languageId || config.GOOGLE_ADS_DEFAULT_LANGUAGE_ID).replace(
      /\D/g,
      ''
    ) || config.GOOGLE_ADS_DEFAULT_LANGUAGE_ID;

  const geoTargetIds = sanitizeGeoIds(
    input.geoTargetIds,
    config.GOOGLE_ADS_DEFAULT_GEO_TARGET_IDS
  );

  const body: Record<string, unknown> = {
    keywords: seedKeywords,
    language: `languageConstants/${languageId}`,
    geoTargetConstants: geoTargetIds.map((id) => `geoTargetConstants/${id}`),
    includeAdultKeywords: Boolean(input.includeAdultKeywords),
    keywordPlanNetwork: 'GOOGLE_SEARCH',
  };

  const url = `${GOOGLE_ADS_API_BASE}/customers/${cfg.customerId}:generateKeywordHistoricalMetrics`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': cfg.developerToken,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (cfg.loginCustomerId) {
    headers['login-customer-id'] = cfg.loginCustomerId;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new GoogleAdsApiError(
      'Unable to reach Google Ads API. Please try again later.',
      {
        status: 503,
        code: 'GOOGLE_ADS_UNAVAILABLE',
        raw: err instanceof Error ? err.message : err,
      }
    );
  }

  const data = await parseGoogleAdsJson(res, 'Keyword metrics lookup');

  // Response shape: { results: [{ text, keywordMetrics }] }
  const results = Array.isArray(data.results) ? data.results : [];
  const keywords: KeywordIdea[] = [];

  for (const raw of results) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const text = typeof row.text === 'string' ? row.text : null;
    if (!text) continue;

    const metrics =
      row.keywordMetrics && typeof row.keywordMetrics === 'object'
        ? (row.keywordMetrics as Record<string, unknown>)
        : {};

    const monthlyRaw = Array.isArray(metrics.monthlySearchVolumes)
      ? metrics.monthlySearchVolumes
      : [];

    const monthlySearchVolumes: MonthlySearchVolume[] = monthlyRaw
      .map((m) => {
        if (!m || typeof m !== 'object') return null;
        const month = m as Record<string, unknown>;
        return {
          year: toNullableNumber(month.year),
          month: typeof month.month === 'string' ? month.month : null,
          monthlySearches: toNullableNumber(month.monthlySearches),
        };
      })
      .filter((m): m is MonthlySearchVolume => m !== null);

    const lowMicros = toNullableNumber(metrics.lowTopOfPageBidMicros);
    const highMicros = toNullableNumber(metrics.highTopOfPageBidMicros);

    keywords.push({
      keyword: text.trim(),
      avgMonthlySearches: toNullableNumber(metrics.avgMonthlySearches),
      competition:
        typeof metrics.competition === 'string' ? metrics.competition : null,
      competitionIndex: toNullableNumber(metrics.competitionIndex),
      lowTopOfPageBidMicros: lowMicros,
      highTopOfPageBidMicros: highMicros,
      lowTopOfPageBid: microsToCurrency(lowMicros),
      highTopOfPageBid: microsToCurrency(highMicros),
      monthlySearchVolumes,
    });
  }

  return {
    keywords,
    nextPageToken: null,
    totalResults: keywords.length,
    seed: { keywords: seedKeywords, url: null },
    geoTargetIds,
    languageId,
  };
}

/**
 * Lists Google Ads accounts directly accessible by the connected OAuth user.
 * Google requires this call to omit login-customer-id.
 */
export async function listAccessibleGoogleAdsCustomers(
  env: GoogleAdsEnv
): Promise<GoogleAdsCustomerAccessDiagnostics> {
  const cfg = assertGoogleAdsConfig(env);
  const accessToken = await getGoogleAccessToken(env);

  const res = await fetch(
    `${GOOGLE_ADS_API_BASE}/customers:listAccessibleCustomers`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': cfg.developerToken,
        Accept: 'application/json',
      },
    }
  );

  const data = await parseGoogleAdsJson(
    res,
    'Google Ads customer access lookup'
  );
  const resourceNames = Array.isArray(data.resourceNames)
    ? data.resourceNames.filter(
        (name): name is string => typeof name === 'string'
      )
    : [];

  return {
    configuredCustomerId: cfg.customerId,
    configuredLoginCustomerId: cfg.loginCustomerId,
    accessibleCustomerIds: resourceNames
      .map((name) => name.match(/^customers\/(\d+)$/)?.[1])
      .filter((id): id is string => Boolean(id)),
    resourceNames,
  };
}
