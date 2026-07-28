import { Hono } from "hono";
import { createDb } from "@repo/db";
import type Env from "@/types/env";
import { errorJson } from "@/utils/errorJson";
import {
  getPublicHeaderNav,
  HEADER_NAV_CACHE_TTL_SECONDS,
  MAX_VISIBLE_HEADER_COLLECTIONS,
} from "@/utils/headerNav";

/**
 * Public storefront header / navigation menu.
 *
 * Cache strategy:
 * 1. Cloudflare KV (5-day TTL) — shared across all visitors
 * 2. D1 on miss — then re-seed KV
 * 3. HTTP Cache-Control so edge/browsers also cache
 *
 * Mutations from the admin panel invalidate the KV key.
 */
const storeHeader = new Hono<{ Bindings: Env }>();

storeHeader.get("/", async (c) => {
  try {
    const db = createDb(c.env.DB);
    const { data, source } = await getPublicHeaderNav(db, c.env.KV);

    // Long-lived public cache; revalidation window keeps stale-while-revalidate friendly.
    c.header(
      "Cache-Control",
      `public, max-age=${HEADER_NAV_CACHE_TTL_SECONDS}, s-maxage=${HEADER_NAV_CACHE_TTL_SECONDS}, stale-while-revalidate=86400`
    );
    c.header("X-Cache-Source", source);
    c.header("Vary", "Origin");

    return c.json({
      success: true,
      data: {
        collections: data.collections,
        updatedAt: data.updatedAt,
        cachedAt: data.cachedAt,
      },
      meta: {
        maxVisibleCollections: MAX_VISIBLE_HEADER_COLLECTIONS,
        cacheTtlSeconds: HEADER_NAV_CACHE_TTL_SECONDS,
        source,
      },
    });
  } catch (error) {
    console.error("Error loading store header nav:", error);
    return errorJson(
      c,
      500,
      "INTERNAL_ERROR",
      "Failed to load navigation menu."
    );
  }
});

export default storeHeader;
