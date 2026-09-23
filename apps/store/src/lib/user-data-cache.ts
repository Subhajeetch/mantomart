const USER_CACHE_PREFIX = "store-user-data:";
const USER_CACHE_TTL = 5 * 24 * 60 * 60 * 1000;

type CacheEntry<T> = {
  expiresAt: number;
  data: T;
};

const inFlight = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;

function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function cacheKey(path: string) {
  return `${USER_CACHE_PREFIX}${path}`;
}

function invalidateUserDataCache() {
  cacheGeneration += 1;
  inFlight.clear();
  const target = storage();
  if (!target) return;
  for (let index = target.length - 1; index >= 0; index -= 1) {
    const key = target.key(index);
    if (key?.startsWith(USER_CACHE_PREFIX)) target.removeItem(key);
  }
}

export function clearUserDataCache() {
  invalidateUserDataCache();
}

export async function requestUserJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const key = cacheKey(path);
  const requestGeneration = cacheGeneration;

  if (method !== "GET") {
    invalidateUserDataCache();
  } else {
    const target = storage();
    const cached = target?.getItem(key);
    if (cached) {
      try {
        const entry = JSON.parse(cached) as CacheEntry<T>;
        if (entry.expiresAt > Date.now()) return entry.data;
        target?.removeItem(key);
      } catch {
        target?.removeItem(key);
      }
    }

    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const request = fetch(`${(process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "")}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  })
    .then(async (response) => {
      const body = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error ?? body?.message ?? "Request failed.");
      }
      if (
        body &&
        "success" in body &&
        body.success === false
      ) {
        throw new Error(body.error ?? body.message ?? "Request failed.");
      }
      if (method === "GET" && requestGeneration === cacheGeneration) {
        storage()?.setItem(
          key,
          JSON.stringify({ expiresAt: Date.now() + USER_CACHE_TTL, data: body })
        );
      }
      return body as T;
    })
    .finally(() => {
      if (method === "GET") inFlight.delete(key);
    });

  if (method === "GET") inFlight.set(key, request);
  return request;
}
