import config from "@/base.config";

const { AE_AUTH_BASE } = config;

const KV_KEY = "ali_tokens";
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export type TokenData = {
  access_token: string;
  refresh_token: string;
  /** Access token expiry as Unix ms. */
  expires_at: number;
  /**
   * Refresh token expiry as Unix ms.
   * Null when AliExpress did not return a validity window (legacy tokens).
   */
  refresh_expires_at: number | null;
};

export type AliExpressConnectionStatus = {
  connected: boolean;
  expires_at: number | null;
  expires_in_ms: number | null;
  is_expired: boolean;
  should_refresh: boolean;
  refresh_expires_at: number | null;
  refresh_expires_in_ms: number | null;
  is_refresh_expired: boolean;
  can_refresh: boolean;
};

type AEEnv = {
  AE_APP_KEY: string;
  AE_APP_SECRET: string;
  KV: KVNamespace;
};

/**
 * Raw fields from /auth/token/create and /auth/token/refresh.
 * @see https://openservice.aliexpress.com — auth token create / refresh
 */
type RawTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  /** Access token remaining lifetime in seconds. */
  expires_in?: unknown;
  /** Access token absolute expiry timestamp (ms). */
  expire_time?: unknown;
  /** Refresh token absolute expiry timestamp (ms). */
  refresh_token_valid_time?: unknown;
  /** Refresh token remaining lifetime in seconds. */
  refresh_expires_in?: unknown;
  refresh_expire_time?: unknown;
  refresh_token_expire_time?: unknown;
  refresh_token_expires_in?: unknown;
  code?: unknown;
  msg?: unknown;
  message?: unknown;
  gopResponseBody?: unknown;
  gopErrorCode?: unknown;
  [key: string]: unknown;
};

type ToTokenDataOptions = {
  /** Previous refresh token — used only if AE omits a new one. */
  fallbackRefreshToken?: string;
  /**
   * Previous refresh expiry — used only when AE reuses the same refresh token
   * AND does not return any new refresh-expiry fields.
   */
  fallbackRefreshExpiresAt?: number | null;
};

export class AliExpressNotConnectedError extends Error {
  constructor() {
    super("AliExpress not connected. Complete OAuth flow first via /api/ae/connect.");
    this.name = "AliExpressNotConnectedError";
  }
}

export class AliExpressTokenError extends Error {
  publicMessage: string;
  raw: unknown;

  constructor(context: string, raw: unknown) {
    const publicMessage = AliExpressTokenError.extractMessage(raw);
    super(`${context}: ${publicMessage}`);
    this.name = "AliExpressTokenError";
    this.publicMessage = publicMessage;
    this.raw = raw;
  }

  private static extractMessage(raw: unknown): string {
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      const candidate =
        obj.msg ?? obj.message ?? obj.sub_msg ?? obj.error_msg ?? obj.error;
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }
    if (typeof raw === "string" && raw.length > 0) return raw;
    return "Unexpected response from AliExpress";
  }
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

async function generateSignSystem(
  params: Record<string, string>,
  appSecret: string,
  apiPath: string
): Promise<string> {
  const filtered: Record<string, string> = {};
  for (const key in params) {
    const value = params[key];
    if (key !== "sign" && value !== undefined && value !== null && value !== "") {
      filtered[key] = value;
    }
  }

  const sortedKeys = Object.keys(filtered).sort();
  const paramString = sortedKeys.map((k) => `${k}${filtered[k]}`).join("");
  const stringToSign = apiPath + paramString;

  return hmacSha256(stringToSign, appSecret);
}

function buildQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function buildSystemParams(
  env: AEEnv,
  apiPath: string,
  extra: Record<string, string>
): Promise<Record<string, string>> {
  const base: Record<string, string> = {
    app_key: env.AE_APP_KEY,
    timestamp: Date.now().toString(),
    sign_method: "sha256",
    ...extra,
  };

  const sign = await generateSignSystem(base, env.AE_APP_SECRET, apiPath);
  return { ...base, sign };
}

function pickNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  // AE docs sometimes redact with the literal "null"
  if (trimmed.length === 0 || trimmed.toLowerCase() === "null") return undefined;
  return trimmed;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Resolve an absolute Unix-ms timestamp from AE fields that may be
 * absolute ms, absolute seconds, or relative durations.
 */
export function resolveTimestamp(
  raw: unknown,
  issuedAt: number,
  mode: "absolute-preferred" | "relative-seconds" | "auto" = "auto"
): number | null {
  const value = toFiniteNumber(raw);
  if (value === null || value <= 0) return null;

  if (mode === "relative-seconds") {
    return Math.trunc(issuedAt + value * 1000);
  }

  // Absolute milliseconds (docs: refresh_token_valid_time / expire_time).
  if (value >= 1_000_000_000_000) {
    return Math.trunc(value);
  }

  if (mode === "absolute-preferred") {
    // Absolute seconds (rare) vs relative ms — prefer absolute seconds when
    // the resulting date is near "now".
    if (value >= 1_000_000_000) {
      const asSecondsMs = value * 1000;
      const twentyYearsMs = 20 * 365.25 * 24 * 60 * 60 * 1000;
      if (Math.abs(asSecondsMs - issuedAt) < twentyYearsMs) {
        return Math.trunc(asSecondsMs);
      }
      return Math.trunc(issuedAt + value);
    }
    // Small values are not useful absolute timestamps.
    return null;
  }

  // auto: absolute ms → absolute seconds / relative ms → relative seconds
  if (value >= 1_000_000_000) {
    const asSecondsMs = value * 1000;
    const twentyYearsMs = 20 * 365.25 * 24 * 60 * 60 * 1000;
    if (Math.abs(asSecondsMs - issuedAt) < twentyYearsMs) {
      return Math.trunc(asSecondsMs);
    }
    return Math.trunc(issuedAt + value);
  }

  return Math.trunc(issuedAt + value * 1000);
}

/** @deprecated Use resolveTimestamp — kept for any external imports. */
export function resolveRefreshExpiresAt(
  raw: unknown,
  issuedAt: number
): number | null {
  return resolveTimestamp(raw, issuedAt, "auto");
}

/**
 * Access token expiry from official fields:
 * - expire_time: absolute ms timestamp
 * - expires_in: remaining seconds
 */
function parseAccessExpiresAt(
  data: RawTokenResponse,
  issuedAt: number
): number | null {
  const fromAbsolute = resolveTimestamp(
    data.expire_time,
    issuedAt,
    "absolute-preferred"
  );
  if (fromAbsolute !== null) return fromAbsolute;

  const expiresIn = toFiniteNumber(data.expires_in);
  if (expiresIn !== null && expiresIn > 0) {
    return Math.trunc(issuedAt + expiresIn * 1000);
  }

  return null;
}

/**
 * Refresh token expiry from official fields (create + refresh responses):
 * - refresh_token_valid_time: absolute ms timestamp
 * - refresh_expires_in: remaining seconds (resets on each successful refresh)
 *
 * Prefer absolute timestamp when present; otherwise remaining seconds.
 * On every successful refresh AE issues a new window — callers must persist it.
 */
function parseRefreshExpiresAtFromResponse(
  data: RawTokenResponse,
  issuedAt: number
): number | null {
  const fromAbsolute =
    resolveTimestamp(data.refresh_token_valid_time, issuedAt, "absolute-preferred") ??
    resolveTimestamp(data.refresh_expire_time, issuedAt, "absolute-preferred") ??
    resolveTimestamp(data.refresh_token_expire_time, issuedAt, "absolute-preferred");

  if (fromAbsolute !== null) return fromAbsolute;

  // Official: remaining validity of the refresh token in seconds.
  const remainingSeconds =
    toFiniteNumber(data.refresh_expires_in) ??
    toFiniteNumber(data.refresh_token_expires_in);

  if (remainingSeconds !== null && remainingSeconds > 0) {
    return Math.trunc(issuedAt + remainingSeconds * 1000);
  }

  return null;
}

function hasRefreshExpiryFields(data: RawTokenResponse): boolean {
  return (
    data.refresh_token_valid_time !== undefined &&
    data.refresh_token_valid_time !== null &&
    data.refresh_token_valid_time !== ""
  ) || (
    data.refresh_expires_in !== undefined &&
    data.refresh_expires_in !== null &&
    data.refresh_expires_in !== ""
  ) || (
    data.refresh_expire_time !== undefined &&
    data.refresh_expire_time !== null
  ) || (
    data.refresh_token_expire_time !== undefined &&
    data.refresh_token_expire_time !== null
  ) || (
    data.refresh_token_expires_in !== undefined &&
    data.refresh_token_expires_in !== null
  );
}

/**
 * AE / IOP responses may be flat token JSON, or an envelope with
 * `gopResponseBody` as a JSON string containing the real payload.
 */
function unwrapTokenPayload(data: unknown): RawTokenResponse {
  if (!data || typeof data !== "object") {
    throw new AliExpressTokenError("AliExpress token response invalid", data);
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.gopResponseBody === "string" && obj.gopResponseBody.length > 0) {
    try {
      const inner = JSON.parse(obj.gopResponseBody) as unknown;
      if (inner && typeof inner === "object") {
        return { ...obj, ...(inner as Record<string, unknown>) };
      }
    } catch {
      // Fall through and try the outer object.
    }
  }

  // Some gateways nest under a single result key.
  for (const key of ["result", "data", "response"] as const) {
    const nested = obj[key];
    if (
      nested &&
      typeof nested === "object" &&
      ("access_token" in (nested as object) ||
        "refresh_token" in (nested as object) ||
        "expires_in" in (nested as object))
    ) {
      return { ...obj, ...(nested as Record<string, unknown>) };
    }
  }

  return obj as RawTokenResponse;
}

function assertBusinessSuccess(data: RawTokenResponse, context: string): void {
  const code = data.code ?? data.gopErrorCode;
  if (code === undefined || code === null || code === "") return;

  const codeStr = String(code);
  if (codeStr === "0" || codeStr.toLowerCase() === "true") return;

  throw new AliExpressTokenError(context, data);
}

async function readTokens(kv: KVNamespace): Promise<TokenData | null> {
  const raw = await kv.get(KV_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<TokenData>;

    if (
      typeof parsed.access_token !== "string" ||
      parsed.access_token.length === 0 ||
      typeof parsed.refresh_token !== "string" ||
      parsed.refresh_token.length === 0 ||
      typeof parsed.expires_at !== "number" ||
      !Number.isFinite(parsed.expires_at)
    ) {
      return null;
    }

    const refreshExpiresAt =
      typeof parsed.refresh_expires_at === "number" &&
      Number.isFinite(parsed.refresh_expires_at) &&
      parsed.refresh_expires_at > 0
        ? parsed.refresh_expires_at
        : null;

    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_at: parsed.expires_at,
      refresh_expires_at: refreshExpiresAt,
    };
  } catch (err) {
    console.error("Failed to parse stored AliExpress tokens:", err);
    return null;
  }
}

async function writeTokens(kv: KVNamespace, tokens: TokenData): Promise<void> {
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
    throw new AliExpressTokenError(context, {
      non_json_response: true,
      status: res.status,
    });
  }

  if (!res.ok) {
    throw new AliExpressTokenError(context, data);
  }

  const payload = unwrapTokenPayload(data);
  assertBusinessSuccess(payload, context);
  return payload;
}

/**
 * Map an AE create/refresh payload into stored token state.
 *
 * On refresh, AliExpress returns a **new** access_token, a **new** refresh_token
 * (when rotated), and a **new** refresh validity window
 * (`refresh_token_valid_time` / `refresh_expires_in`). All of these must be saved.
 */
function toTokenData(
  data: RawTokenResponse,
  context: string,
  options: ToTokenDataOptions = {}
): TokenData {
  const issuedAt = Date.now();

  const accessToken = pickNonEmptyString(data.access_token);
  const incomingRefreshToken = pickNonEmptyString(data.refresh_token);
  const refreshToken =
    incomingRefreshToken ?? options.fallbackRefreshToken;

  const accessExpiresAt = parseAccessExpiresAt(data, issuedAt);
  const parsedRefreshExpiresAt = parseRefreshExpiresAtFromResponse(
    data,
    issuedAt
  );

  if (
    !accessToken ||
    !refreshToken ||
    accessExpiresAt === null
  ) {
    throw new AliExpressTokenError(context, data);
  }

  const refreshTokenRotated =
    incomingRefreshToken !== undefined &&
    incomingRefreshToken !== options.fallbackRefreshToken;

  const responseHasRefreshExpiry = hasRefreshExpiryFields(data);

  let refreshExpiresAt: number | null;
  if (parsedRefreshExpiresAt !== null) {
    // Always take the new window from AE (create and refresh both return this).
    refreshExpiresAt = parsedRefreshExpiresAt;
  } else if (refreshTokenRotated || responseHasRefreshExpiry) {
    // New/rotated refresh token without a parseable expiry — do not keep a
    // stale previous expiry that belongs to the old token.
    refreshExpiresAt = null;
  } else if (options.fallbackRefreshExpiresAt !== undefined) {
    // Same refresh token reused and AE omitted expiry fields.
    refreshExpiresAt = options.fallbackRefreshExpiresAt;
  } else {
    refreshExpiresAt = null;
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: accessExpiresAt,
    refresh_expires_at: refreshExpiresAt,
  };
}

/**
 * Docs require HTTPS POST for token create/refresh (system APIs use /rest).
 * Signed system params stay on the query string (same signing scheme as before).
 */
async function postAuthApi(
  env: AEEnv,
  apiPath: string,
  extra: Record<string, string>,
  context: string
): Promise<RawTokenResponse> {
  const params = await buildSystemParams(env, apiPath, extra);
  const url = `${AE_AUTH_BASE}${apiPath}?${buildQueryString(params)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  });

  return parseTokenResponse(res, context);
}

async function fetchNewTokens(env: AEEnv, code: string): Promise<TokenData> {
  const data = await postAuthApi(
    env,
    "/auth/token/create",
    {
      code,
      // grant_type is accepted by OAuth-style gateways; AE primarily keys on `code`.
      grant_type: "authorization_code",
    },
    "AliExpress token create failed"
  );

  return toTokenData(data, "AliExpress token create failed");
}

async function fetchRefreshedTokens(
  env: AEEnv,
  current: TokenData
): Promise<TokenData> {
  const data = await postAuthApi(
    env,
    "/auth/token/refresh",
    {
      refresh_token: current.refresh_token,
      grant_type: "refresh_token",
    },
    "AliExpress token refresh failed"
  );

  // Persist the full rotated pair + new expiry windows from the response.
  // Fallback refresh token only if AE omits refresh_token (rare); expiry from
  // the response is always preferred when present.
  const tokens = toTokenData(data, "AliExpress token refresh failed", {
    fallbackRefreshToken: current.refresh_token,
    fallbackRefreshExpiresAt: current.refresh_expires_at,
  });

  return tokens;
}

let refreshInFlight: Promise<TokenData> | null = null;

async function refreshAndStore(
  env: AEEnv,
  current: TokenData
): Promise<TokenData> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refreshed = await fetchRefreshedTokens(env, current);
        // Always overwrite KV with the latest access + refresh tokens and
        // their new expiry timestamps from /auth/token/refresh.
        await writeTokens(env.KV, refreshed);
        return refreshed;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

function assertRefreshTokenUsable(tokens: TokenData): void {
  if (
    tokens.refresh_expires_at !== null &&
    tokens.refresh_expires_at <= Date.now()
  ) {
    throw new AliExpressTokenError("AliExpress refresh token expired", {
      code: "refresh_token_expired",
      msg: "Refresh token has expired. Please reconnect AliExpress.",
      refresh_expires_at: tokens.refresh_expires_at,
    });
  }
}

export async function connectAliExpress(
  env: AEEnv,
  code: string
): Promise<TokenData> {
  const tokens = await fetchNewTokens(env, code);
  await writeTokens(env.KV, tokens);
  return tokens;
}

export async function getAccessToken(env: AEEnv): Promise<string> {
  const tokens = await readTokens(env.KV);

  if (!tokens) {
    throw new AliExpressNotConnectedError();
  }

  if (tokens.expires_at - Date.now() <= REFRESH_WINDOW_MS) {
    assertRefreshTokenUsable(tokens);
    const refreshed = await refreshAndStore(env, tokens);
    return refreshed.access_token;
  }

  return tokens.access_token;
}

export async function isConnected(env: AEEnv): Promise<boolean> {
  const tokens = await readTokens(env.KV);
  return tokens !== null;
}

export async function disconnectAliExpress(env: AEEnv): Promise<void> {
  await env.KV.delete(KV_KEY);
}

export async function getAliExpressConnectionStatus(
  env: AEEnv
): Promise<AliExpressConnectionStatus> {
  const tokens = await readTokens(env.KV);

  if (!tokens) {
    return {
      connected: false,
      expires_at: null,
      expires_in_ms: null,
      is_expired: false,
      should_refresh: false,
      refresh_expires_at: null,
      refresh_expires_in_ms: null,
      is_refresh_expired: false,
      can_refresh: false,
    };
  }

  const now = Date.now();
  const expiresInMs = tokens.expires_at - now;
  const refreshExpiresAt = tokens.refresh_expires_at;
  const isRefreshExpired =
    refreshExpiresAt !== null ? refreshExpiresAt <= now : false;
  const refreshExpiresInMs =
    refreshExpiresAt !== null ? Math.max(0, refreshExpiresAt - now) : null;

  return {
    connected: true,
    expires_at: tokens.expires_at,
    expires_in_ms: Math.max(0, expiresInMs),
    is_expired: expiresInMs <= 0,
    should_refresh: expiresInMs <= REFRESH_WINDOW_MS && !isRefreshExpired,
    refresh_expires_at: refreshExpiresAt,
    refresh_expires_in_ms: refreshExpiresInMs,
    is_refresh_expired: isRefreshExpired,
    can_refresh: !isRefreshExpired,
  };
}

export async function refreshAliExpressTokens(env: AEEnv): Promise<TokenData> {
  const tokens = await readTokens(env.KV);

  if (!tokens) {
    throw new AliExpressNotConnectedError();
  }

  assertRefreshTokenUsable(tokens);
  return refreshAndStore(env, tokens);
}
