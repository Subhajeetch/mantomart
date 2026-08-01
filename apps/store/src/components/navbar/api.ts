import type {
  HeaderNavCollection,
  HeaderNavErrorResponse,
  HeaderNavItem,
  HeaderNavResponse,
} from "./types";

/** Match API / KV TTL so HTML and edge stay in sync (5 days). */
const HEADER_REVALIDATE_SECONDS = 5 * 24 * 60 * 60;
const MAX_VISIBLE_COLLECTIONS = 5;

/**
 * Get the API base URL for fetching.
 * In development, uses NEXT_PUBLIC_API_URL from .env.local.
 * In production Cloudflare Workers, uses the variable from wrangler.jsonc.
 */
function getApiBaseUrl(): string {
  // Try to get from environment - this works in both local dev and Cloudflare Workers
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "";
  return baseUrl.replace(/\/$/, "");
}

/**
 * Server-side fetch for the storefront header navigation.
 * Uses the configured API URL for server-side rendering (SEO-friendly).
 */
async function fetchHeaderNav(): Promise<HeaderNavResponse | HeaderNavErrorResponse | null> {
  const apiBaseUrl = getApiBaseUrl();

  // Prefer absolute API origin when set. During `next build` the API worker
  // is often offline (ECONNREFUSED) — that is non-fatal; we render an empty nav.
  const url = apiBaseUrl
    ? `${apiBaseUrl}/api/store/header`
    : "/api/store/header";

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      // Long-lived cache; admin mutations should bust API KV, and this
      // revalidates at most every 5 days (or on redeploy).
      next: {
        revalidate: HEADER_REVALIDATE_SECONDS,
        tags: ["store-header-nav"],
      },
    });

    if (!response.ok) {
      console.warn(
        `getHeaderNav: API responded ${response.status} ${response.statusText}`
      );
      return null;
    }

    return (await response.json()) as
      | HeaderNavResponse
      | HeaderNavErrorResponse
      | null;
  } catch (error) {
    // Build-time / offline API is expected — keep the log quiet.
    const cause =
      error instanceof Error && "cause" in error
        ? (error as Error & { cause?: { code?: string } }).cause
        : undefined;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? String(cause.code)
        : "";

    if (code === "ECONNREFUSED") {
      console.warn(
        "getHeaderNav: API unreachable during build/render — using empty nav."
      );
    } else {
      console.warn("getHeaderNav: fetch failed — using empty nav.", error);
    }
    return null;
  }
}

/** Build a category path when the API only provided a slug. */
export function categoryHref(slug: string): string {
  const cleaned = slug.trim().replace(/^\/+|\/+$/g, "");
  return cleaned ? `/category/${cleaned}` : "/";
}

/**
 * Prefer API href; fall back to slug-based category path.
 * Returns null only when neither is usable (pure label nodes).
 */
export function resolveNavHref(
  href: string | null | undefined,
  slug: string | null | undefined
): string | null {
  if (typeof href === "string") {
    const trimmed = href.trim();
    if (trimmed) return trimmed;
  }
  if (typeof slug === "string" && slug.trim()) {
    return categoryHref(slug);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeItem(raw: unknown): HeaderNavItem | null {
  if (!isRecord(raw)) return null;

  const id = asString(raw.id);
  const name = asString(raw.name);
  const slug = asString(raw.slug);
  if (!id || !name || !slug) return null;

  const childrenRaw = Array.isArray(raw.children) ? raw.children : [];
  const children = childrenRaw
    .map(normalizeItem)
    .filter((child): child is HeaderNavItem => child !== null)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  return {
    id,
    name,
    slug,
    href: resolveNavHref(asString(raw.href), slug),
    position: asNumber(raw.position),
    featured: Boolean(raw.featured),
    children,
  };
}

function normalizeCollection(raw: unknown): HeaderNavCollection | null {
  if (!isRecord(raw)) return null;

  const id = asString(raw.id);
  const name = asString(raw.name);
  const slug = asString(raw.slug);
  if (!id || !name || !slug) return null;

  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items = itemsRaw
    .map(normalizeItem)
    .filter((item): item is HeaderNavItem => item !== null)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

  return {
    id,
    name,
    slug,
    href: resolveNavHref(asString(raw.href), slug),
    position: asNumber(raw.position),
    items,
  };
}

/**
 * Server-side fetch for the storefront header.
 * Uses Next.js revalidation so HTML is rendered with real category links (SEO).
 *
 * Never throws — empty list on any failure so the storefront still renders.
 */
export async function getHeaderNav(): Promise<HeaderNavCollection[]> {
  const body = await fetchHeaderNav();

  if (!body || typeof body !== "object" || body.success !== true) {
    // null body is the normal offline/build path — no noisy error.
    if (body) {
      const message =
        typeof body === "object" && "message" in body
          ? String(body.message ?? "unknown error")
          : "invalid payload";
      console.warn(`getHeaderNav: unsuccessful response (${message})`);
    }
    return [];
  }

  if (!Array.isArray(body.data?.collections)) {
    console.warn("getHeaderNav: collections missing or not an array");
    return [];
  }

  return body.data.collections
    .map(normalizeCollection)
    .filter(
      (collection): collection is HeaderNavCollection => collection !== null
    )
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .slice(0, MAX_VISIBLE_COLLECTIONS);
}
