import config from '@/base.config';

const { GOOGLE_OAUTH_TOKEN_URL, GOOGLE_ADS_SCOPE } = config;

const KV_KEY = 'google_ads_tokens';
/** Refresh access token this many ms before expiry. */
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

/**
 * Google refresh tokens are long-lived and do not return an expiry from the
 * token endpoint. Google may still invalidate them after ~6 months of
 * inactivity, user/admin revocation, or (for apps in Testing) after 7 days.
 * We track when the refresh token was obtained so the UI can surface that.
 */
export const GOOGLE_REFRESH_TOKEN_POLICY = {
  /** Informational inactivity window Google documents for unused tokens. */
  inactivity_ms: 180 * 24 * 60 * 60 * 1000,
  note:
    'Google refresh tokens have no fixed expiry. They may stop working after ~6 months of inactivity, if revoked, or after 7 days while the OAuth app is in Testing mode.',
} as const;

export type GoogleTokenData = {
  access_token: string;
  refresh_token: string;
  /** Access token expiry as Unix ms. */
  expires_at: number;
  /**
   * Refresh token expiry as Unix ms when known.
   * Google does not return this; usually null. Present only if we ever learn one.
   */
  refresh_expires_at: number | null;
  /**
   * When the current refresh token was first stored (Unix ms).
   * Null for legacy KV records written before this field existed.
   */
  refresh_token_obtained_at: number | null;
  token_type?: string;
  scope?: string;
};

export type GoogleConnectionStatus = {
  connected: boolean;
  expires_at: number | null;
  expires_in_ms: number | null;
  is_expired: boolean;
  should_refresh: boolean;
  has_refresh_token: boolean;
  refresh_expires_at: number | null;
  refresh_expires_in_ms: number | null;
  is_refresh_expired: boolean;
  can_refresh: boolean;
  refresh_token_obtained_at: number | null;
  /** Soft advisory: estimated inactivity invalidation window end (not a hard expiry). */
  refresh_inactivity_expires_at: number | null;
  refresh_token_note: string | null;
};

export type GoogleAdsEnv = {
  GOOGLE_ADS_CLIENT_ID: string;
  GOOGLE_ADS_CLIENT_SECRET: string;
  GOOGLE_ADS_DEVELOPER_TOKEN: string;
  GOOGLE_ADS_CUSTOMER_ID: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  GOOGLE_ADS_REDIRECT_URI: string;
  KV: KVNamespace;
};

type RawTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
  [key: string]: unknown;
};

type ToTokenDataOptions = {
  fallbackRefreshToken?: string;
  fallbackRefreshExpiresAt?: number | null;
  fallbackRefreshTokenObtainedAt?: number | null;
};

export class GoogleAdsNotConnectedError extends Error {
  constructor() {
    super(
      'Google Ads is not connected. Complete OAuth flow first via /api/google/connect.'
    );
    this.name = 'GoogleAdsNotConnectedError';
  }
}

export class GoogleAdsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAdsConfigError';
  }
}

export class GoogleAdsTokenError extends Error {
  publicMessage: string;
  raw: unknown;

  constructor(context: string, raw: unknown) {
    const publicMessage = GoogleAdsTokenError.extractMessage(raw);
    super(`${context}: ${publicMessage}`);
    this.name = 'GoogleAdsTokenError';
    this.publicMessage = publicMessage;
    this.raw = raw;
  }

  private static extractMessage(raw: unknown): string {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const candidate =
        obj.error_description ?? obj.error ?? obj.message ?? obj.msg;
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }
    if (typeof raw === 'string' && raw.length > 0) return raw;
    return 'Unexpected response from Google OAuth';
  }
}

function requireEnvString(
  env: GoogleAdsEnv,
  key: keyof GoogleAdsEnv,
  label: string
): string {
  const value = env[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GoogleAdsConfigError(
      `Missing required environment variable: ${label}. Configure it before connecting Google Ads.`
    );
  }
  return value.trim();
}

export function assertGoogleAdsConfig(env: GoogleAdsEnv): {
  clientId: string;
  clientSecret: string;
  developerToken: string;
  customerId: string;
  loginCustomerId: string | null;
  redirectUri: string;
} {
  return {
    clientId: requireEnvString(env, 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_ID'),
    clientSecret: requireEnvString(
      env,
      'GOOGLE_ADS_CLIENT_SECRET',
      'GOOGLE_ADS_CLIENT_SECRET'
    ),
    developerToken: requireEnvString(
      env,
      'GOOGLE_ADS_DEVELOPER_TOKEN',
      'GOOGLE_ADS_DEVELOPER_TOKEN'
    ),
    customerId: normalizeCustomerId(
      requireEnvString(env, 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_CUSTOMER_ID')
    ),
    loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
      ? normalizeCustomerId(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)
      : null,
    redirectUri: requireEnvString(
      env,
      'GOOGLE_ADS_REDIRECT_URI',
      'GOOGLE_ADS_REDIRECT_URI'
    ),
  };
}

/** Strip dashes / spaces from Google Ads customer IDs. */
export function normalizeCustomerId(value: string): string {
  return value.replace(/[-\s]/g, '').trim();
}

async function readTokens(kv: KVNamespace): Promise<GoogleTokenData | null> {
  const raw = await kv.get(KV_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<GoogleTokenData>;
    if (
      typeof parsed.access_token !== 'string' ||
      parsed.access_token.length === 0 ||
      typeof parsed.refresh_token !== 'string' ||
      parsed.refresh_token.length === 0 ||
      typeof parsed.expires_at !== 'number' ||
      !Number.isFinite(parsed.expires_at)
    ) {
      return null;
    }

    const refreshExpiresAt =
      typeof parsed.refresh_expires_at === 'number' &&
      Number.isFinite(parsed.refresh_expires_at) &&
      parsed.refresh_expires_at > 0
        ? parsed.refresh_expires_at
        : null;

    const refreshTokenObtainedAt =
      typeof parsed.refresh_token_obtained_at === 'number' &&
      Number.isFinite(parsed.refresh_token_obtained_at) &&
      parsed.refresh_token_obtained_at > 0
        ? parsed.refresh_token_obtained_at
        : // Legacy tokens written before this field existed.
          null;

    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_at: parsed.expires_at,
      refresh_expires_at: refreshExpiresAt,
      refresh_token_obtained_at: refreshTokenObtainedAt,
      token_type:
        typeof parsed.token_type === 'string' ? parsed.token_type : undefined,
      scope: typeof parsed.scope === 'string' ? parsed.scope : undefined,
    };
  } catch (err) {
    console.error('Failed to parse stored Google Ads tokens:', err);
    return null;
  }
}

async function writeTokens(
  kv: KVNamespace,
  tokens: GoogleTokenData
): Promise<void> {
  await kv.put(KV_KEY, JSON.stringify(tokens));
}

async function parseTokenResponse(
  res: Response,
  context: string
): Promise<RawTokenResponse> {
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new GoogleAdsTokenError(context, {
      non_json_response: true,
      status: res.status,
    });
  }

  if (!res.ok) {
    throw new GoogleAdsTokenError(context, data);
  }

  return data as RawTokenResponse;
}

function toTokenData(
  data: RawTokenResponse,
  context: string,
  options: ToTokenDataOptions = {}
): GoogleTokenData {
  const issuedAt = Date.now();
  const accessToken = data.access_token;
  const incomingRefreshToken =
    typeof data.refresh_token === 'string' && data.refresh_token.length > 0
      ? data.refresh_token
      : undefined;
  const refreshToken = incomingRefreshToken ?? options.fallbackRefreshToken;
  const expiresInNum = Number(data.expires_in);

  if (
    typeof accessToken !== 'string' ||
    accessToken.length === 0 ||
    typeof refreshToken !== 'string' ||
    refreshToken.length === 0 ||
    !Number.isFinite(expiresInNum) ||
    expiresInNum <= 0
  ) {
    throw new GoogleAdsTokenError(context, data);
  }

  const refreshTokenChanged =
    incomingRefreshToken !== undefined &&
    incomingRefreshToken !== options.fallbackRefreshToken;

  // New refresh token → stamp obtained_at. Same token → preserve prior stamp.
  // First-time connect (no fallback) → stamp now.
  const refreshTokenObtainedAt = refreshTokenChanged
    ? issuedAt
    : options.fallbackRefreshTokenObtainedAt !== undefined
      ? options.fallbackRefreshTokenObtainedAt
      : issuedAt;

  // Google's token endpoint does not return refresh-token expiry.
  const refreshExpiresAt =
    options.fallbackRefreshExpiresAt !== undefined
      ? options.fallbackRefreshExpiresAt
      : null;

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: issuedAt + expiresInNum * 1000,
    refresh_expires_at: refreshExpiresAt,
    refresh_token_obtained_at: refreshTokenObtainedAt,
    token_type:
      typeof data.token_type === 'string' ? data.token_type : undefined,
    scope: typeof data.scope === 'string' ? data.scope : undefined,
  };
}

async function exchangeAuthorizationCode(
  env: GoogleAdsEnv,
  code: string
): Promise<GoogleTokenData> {
  const { clientId, clientSecret, redirectUri } = assertGoogleAdsConfig(env);

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const data = await parseTokenResponse(
    res,
    'Google Ads token create failed'
  );
  return toTokenData(data, 'Google Ads token create failed');
}

async function fetchRefreshedTokens(
  env: GoogleAdsEnv,
  current: GoogleTokenData
): Promise<GoogleTokenData> {
  const { clientId, clientSecret } = assertGoogleAdsConfig(env);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: current.refresh_token,
    grant_type: 'refresh_token',
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const data = await parseTokenResponse(
    res,
    'Google Ads token refresh failed'
  );
  return toTokenData(data, 'Google Ads token refresh failed', {
    fallbackRefreshToken: current.refresh_token,
    fallbackRefreshExpiresAt: current.refresh_expires_at,
    fallbackRefreshTokenObtainedAt: current.refresh_token_obtained_at,
  });
}

let refreshInFlight: Promise<GoogleTokenData> | null = null;

async function refreshAndStore(
  env: GoogleAdsEnv,
  current: GoogleTokenData
): Promise<GoogleTokenData> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refreshed = await fetchRefreshedTokens(env, current);
        await writeTokens(env.KV, refreshed);
        return refreshed;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

function assertRefreshTokenUsable(tokens: GoogleTokenData): void {
  if (
    tokens.refresh_expires_at !== null &&
    tokens.refresh_expires_at <= Date.now()
  ) {
    throw new GoogleAdsTokenError('Google Ads refresh token expired', {
      error: 'invalid_grant',
      error_description:
        'Refresh token has expired. Please reconnect Google Ads.',
      refresh_expires_at: tokens.refresh_expires_at,
    });
  }
}

/**
 * Build the Google OAuth consent URL (offline access so refresh tokens last).
 * `state` is echoed back so the admin UI can route the callback correctly.
 */
export function buildGoogleAdsAuthUrl(
  env: GoogleAdsEnv,
  state = 'google_ads'
): string {
  const { clientId, redirectUri } = assertGoogleAdsConfig(env);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_ADS_SCOPE,
    access_type: 'offline',
    // Force consent so we always receive a refresh_token on reconnect.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  return `${config.GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`;
}

export async function connectGoogleAds(
  env: GoogleAdsEnv,
  code: string
): Promise<GoogleTokenData> {
  const tokens = await exchangeAuthorizationCode(env, code.trim());
  await writeTokens(env.KV, tokens);
  return tokens;
}

export async function getGoogleAccessToken(env: GoogleAdsEnv): Promise<string> {
  const tokens = await readTokens(env.KV);

  if (!tokens) {
    throw new GoogleAdsNotConnectedError();
  }

  if (tokens.expires_at - Date.now() <= REFRESH_WINDOW_MS) {
    assertRefreshTokenUsable(tokens);
    const refreshed = await refreshAndStore(env, tokens);
    return refreshed.access_token;
  }

  return tokens.access_token;
}

export async function isGoogleAdsConnected(env: GoogleAdsEnv): Promise<boolean> {
  const tokens = await readTokens(env.KV);
  return tokens !== null;
}

export async function disconnectGoogleAds(env: GoogleAdsEnv): Promise<void> {
  await env.KV.delete(KV_KEY);
}

export async function getGoogleAdsConnectionStatus(
  env: GoogleAdsEnv
): Promise<GoogleConnectionStatus> {
  const tokens = await readTokens(env.KV);

  if (!tokens) {
    return {
      connected: false,
      expires_at: null,
      expires_in_ms: null,
      is_expired: false,
      should_refresh: false,
      has_refresh_token: false,
      refresh_expires_at: null,
      refresh_expires_in_ms: null,
      is_refresh_expired: false,
      can_refresh: false,
      refresh_token_obtained_at: null,
      refresh_inactivity_expires_at: null,
      refresh_token_note: null,
    };
  }

  const now = Date.now();
  const expiresInMs = tokens.expires_at - now;
  const refreshExpiresAt = tokens.refresh_expires_at;
  const isRefreshExpired =
    refreshExpiresAt !== null ? refreshExpiresAt <= now : false;
  const refreshExpiresInMs =
    refreshExpiresAt !== null ? Math.max(0, refreshExpiresAt - now) : null;
  const hasRefreshToken = Boolean(tokens.refresh_token);
  const canRefresh = hasRefreshToken && !isRefreshExpired;

  return {
    connected: true,
    expires_at: tokens.expires_at,
    expires_in_ms: Math.max(0, expiresInMs),
    is_expired: expiresInMs <= 0,
    should_refresh: expiresInMs <= REFRESH_WINDOW_MS && canRefresh,
    has_refresh_token: hasRefreshToken,
    refresh_expires_at: refreshExpiresAt,
    refresh_expires_in_ms: refreshExpiresInMs,
    is_refresh_expired: isRefreshExpired,
    can_refresh: canRefresh,
    refresh_token_obtained_at: tokens.refresh_token_obtained_at,
    refresh_inactivity_expires_at:
      tokens.refresh_token_obtained_at !== null
        ? tokens.refresh_token_obtained_at +
          GOOGLE_REFRESH_TOKEN_POLICY.inactivity_ms
        : null,
    refresh_token_note: GOOGLE_REFRESH_TOKEN_POLICY.note,
  };
}

export async function refreshGoogleAdsTokens(
  env: GoogleAdsEnv
): Promise<GoogleTokenData> {
  const tokens = await readTokens(env.KV);

  if (!tokens) {
    throw new GoogleAdsNotConnectedError();
  }

  assertRefreshTokenUsable(tokens);
  return refreshAndStore(env, tokens);
}
