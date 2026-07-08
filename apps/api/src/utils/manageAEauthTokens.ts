import config from "@/base.config";

const { AE_AUTH_BASE } = config;

const KV_KEY = "ali_tokens";
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export type TokenData = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

export type AliExpressConnectionStatus = {
  connected: boolean;
  expires_at: number | null;
  expires_in_ms: number | null;
  is_expired: boolean;
  should_refresh: boolean;
};

type AEEnv = {
  AE_APP_KEY: string;
  AE_APP_SECRET: string;
  KV: KVNamespace;
};

type RawTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  [key: string]: unknown;
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
      const candidate = obj.msg ?? obj.message ?? obj.sub_msg;
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }
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

async function readTokens(kv: KVNamespace): Promise<TokenData | null> {
  const raw = await kv.get(KV_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as TokenData;
  } catch (err) {
    console.error("Failed to parse stored AliExpress tokens:", err);
    return null;
  }
}

async function writeTokens(kv: KVNamespace, tokens: TokenData): Promise<void> {
  await kv.put(KV_KEY, JSON.stringify(tokens));
}


async function parseTokenResponse(res: Response, context: string): Promise<RawTokenResponse> {
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

  return data as RawTokenResponse;
}

function toTokenData(
  data: RawTokenResponse,
  context: string,
  fallbackRefreshToken?: string
): TokenData {
  const { access_token, refresh_token, expires_in } = data;

  const refreshToken =
    typeof refresh_token === "string" && refresh_token.length > 0
      ? refresh_token
      : fallbackRefreshToken;

  const expiresInNum = Number(expires_in);

  if (
    typeof access_token !== "string" ||
    access_token.length === 0 ||
    typeof refreshToken !== "string" ||
    refreshToken.length === 0 ||
    !Number.isFinite(expiresInNum) ||
    expiresInNum <= 0
  ) {
    throw new AliExpressTokenError(context, data);
  }

  return {
    access_token,
    refresh_token: refreshToken,
    expires_at: Date.now() + expiresInNum * 1000,
  };
}

async function fetchNewTokens(env: AEEnv, code: string): Promise<TokenData> {
  const apiPath = "/auth/token/create";

  const params = await buildSystemParams(env, apiPath, {
    code,
    grant_type: "authorization_code",
  });

  const url = `${AE_AUTH_BASE}${apiPath}?${buildQueryString(params)}`;

  const res = await fetch(url, { method: "GET" });
  const data = await parseTokenResponse(res, "AliExpress token create failed");
  return toTokenData(data, "AliExpress token create failed");
}

async function fetchRefreshedTokens(
  env: AEEnv,
  currentRefreshToken: string
): Promise<TokenData> {
  const apiPath = "/auth/token/refresh";

  const params = await buildSystemParams(env, apiPath, {
    refresh_token: currentRefreshToken,
    grant_type: "refresh_token",
  });

  const url = `${AE_AUTH_BASE}${apiPath}?${buildQueryString(params)}`;

  const res = await fetch(url, { method: "GET" });
  const data = await parseTokenResponse(res, "AliExpress token refresh failed");
  return toTokenData(data, "AliExpress token refresh failed", currentRefreshToken);
}

let refreshInFlight: Promise<TokenData> | null = null;

async function refreshAndStore(env: AEEnv, refreshToken: string): Promise<TokenData> {
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
    const refreshed = await refreshAndStore(env, tokens.refresh_token);
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
    };
  }

  const expiresInMs = tokens.expires_at - Date.now();

  return {
    connected: true,
    expires_at: tokens.expires_at,
    expires_in_ms: Math.max(0, expiresInMs),
    is_expired: expiresInMs <= 0,
    should_refresh: expiresInMs <= REFRESH_WINDOW_MS,
  };
}

export async function refreshAliExpressTokens(env: AEEnv): Promise<TokenData> {
  const tokens = await readTokens(env.KV);

  if (!tokens) {
    throw new AliExpressNotConnectedError();
  }

  return refreshAndStore(env, tokens.refresh_token);
}