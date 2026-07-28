import type { HeaderNavCollection, HeaderNavItem, HeaderNavResponse } from "./types";

const HEADER_REVALIDATE_SECONDS = 5 * 24 * 60 * 60;

function getApiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
}

function normalizeItem(raw: Partial<HeaderNavItem> & { id: string; name: string; slug: string; href: string }): HeaderNavItem {
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    href: raw.href || `/category/${raw.slug}`,
    position: typeof raw.position === "number" ? raw.position : 0,
    featured: Boolean(raw.featured),
    children: Array.isArray(raw.children)
      ? raw.children
          .filter(
            (child): child is Partial<HeaderNavItem> & { id: string; name: string; slug: string; href: string } =>
              !!child &&
              typeof child === "object" &&
              typeof child.id === "string" &&
              typeof child.name === "string" &&
              typeof child.slug === "string" &&
              typeof child.href === "string"
          )
          .map(normalizeItem)
      : [],
  };
}

function normalizeCollection(
  raw: Partial<HeaderNavCollection> & {
    id: string;
    name: string;
    slug: string;
    href: string;
  }
): HeaderNavCollection {
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    href: raw.href || `/category/${raw.slug}`,
    position: typeof raw.position === "number" ? raw.position : 0,
    items: Array.isArray(raw.items)
      ? raw.items
          .filter(
            (item): item is Partial<HeaderNavItem> & { id: string; name: string; slug: string; href: string } =>
              !!item &&
              typeof item === "object" &&
              typeof item.id === "string" &&
              typeof item.name === "string" &&
              typeof item.slug === "string" &&
              typeof item.href === "string"
          )
          .map(normalizeItem)
      : [],
  };
}

/**
 * Server-side fetch for the storefront header.
 * Uses Next.js revalidation so HTML is rendered with real category links (SEO).
 */
export async function getHeaderNav(): Promise<HeaderNavCollection[]> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) return [];

  try {
    const response = await fetch(`${apiBaseUrl}/api/store/header`, {
      headers: { Accept: "application/json" },
      next: { revalidate: HEADER_REVALIDATE_SECONDS },
    });

    if (!response.ok) return [];

    const body = (await response.json()) as HeaderNavResponse;
    if (!body.success || !Array.isArray(body.data?.collections)) {
      return [];
    }

    return body.data.collections
      .filter(
        (collection): collection is HeaderNavCollection =>
          !!collection &&
          typeof collection === "object" &&
          typeof collection.id === "string" &&
          typeof collection.name === "string" &&
          typeof collection.slug === "string" &&
          typeof collection.href === "string"
      )
      .map(normalizeCollection)
      .slice(0, 5);
  } catch (error) {
    console.error("Failed to fetch storefront header nav:", error);
    return [];
  }
}
