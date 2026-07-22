import config from '@/base.config';

const { GOOGLE_OAUTH_TOKEN_URL, GOOGLE_ADS_SCOPE } = config;

const KV_KEY = 'google_ads_tokens';
/** Refresh access token this many ms before expiry. */
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export type GoogleTokenData = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
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
    const parsed = JSON.parse(raw) as GoogleTokenData;
    if (
      typeof parsed.access_token !== 'string' ||
      typeof parsed.refresh_token !== 'string' ||
      typeof parsed.expires_at !== 'number'
    ) {
      return null;
    }
    return parsed;
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
  fallbackRefreshToken?: string
): GoogleTokenData {
  const accessToken = data.access_token;
  const refreshToken =
    typeof data.refresh_token === 'string' && data.refresh_token.length > 0
      ? data.refresh_token
      : fallbackRefreshToken;
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

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Date.now() + expiresInNum * 1000,
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
  currentRefreshToken: string
): Promise<GoogleTokenData> {
  const { clientId, clientSecret } = assertGoogleAdsConfig(env);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: currentRefreshToken,
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
  return toTokenData(data, 'Google Ads token refresh failed', currentRefreshToken);
}

let refreshInFlight: Promise<GoogleTokenData> | null = null;

async function refreshAndStore(
  env: GoogleAdsEnv,
  refreshToken: string
): Promise<GoogleTokenData> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refreshed = await fetchRefreshedTokens(env, refreshToken);
        await writeTokens(env.KV, refreshed);
        return refreshed;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
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
    const refreshed = await refreshAndStore(env, tokens.refresh_token);
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
    };
  }

  const expiresInMs = tokens.expires_at - Date.now();

  return {
    connected: true,
    expires_at: tokens.expires_at,
    expires_in_ms: Math.max(0, expiresInMs),
    is_expired: expiresInMs <= 0,
    should_refresh: expiresInMs <= REFRESH_WINDOW_MS,
    has_refresh_token: Boolean(tokens.refresh_token),
  };
}

export async function refreshGoogleAdsTokens(
  env: GoogleAdsEnv
): Promise<GoogleTokenData> {
  const tokens = await readTokens(env.KV);

  if (!tokens) {
    throw new GoogleAdsNotConnectedError();
  }

  return refreshAndStore(env, tokens.refresh_token);
}
