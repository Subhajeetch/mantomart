import type { HeaderNavCollection, HeaderNavResponse } from "./types";

const HEADER_REVALIDATE_SECONDS = 5 * 24 * 60 * 60;

function getApiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
}

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

    return body.data.collections.slice(0, 5);
  } catch (error) {
    console.error("Failed to fetch storefront header nav:", error);
    return [];
  }
}
