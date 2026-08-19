import type {
  ApiErrorBody,
  AvailableCategory,
  CategoryNode,
  HomepageAdminBlock,
  HomepageBlockConfig,
  HomepageBlockType,
  HomepageMeta,
  ReorderItemPayload,
} from "./types";

export class ApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function getHomepageApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  return origin ? `${origin}/api/admin/homepage` : "/api/admin/homepage";
}

function getCategoriesApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  return origin ? `${origin}/api/categories` : "/api/categories";
}

export async function requestHomepageJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getHomepageApiBase();
  const url =
    !path || path === "/"
      ? base
      : path.startsWith("?")
        ? `${base}${path}`
        : `${base}/${path.replace(/^\/+/, "")}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Unable to reach the server. Please try again.", 0);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      `Request failed with status ${response.status}.`,
      response.status
    );
  }

  if (!response.ok || (data as ApiErrorBody).success === false) {
    const body = data as ApiErrorBody;
    throw new ApiError(
      body.error ||
        body.message ||
        `Request failed with status ${response.status}.`,
      response.status,
      body.code
    );
  }

  return data as T;
}

export async function loadHomepage() {
  return requestHomepageJson<{
    success: true;
    data: HomepageAdminBlock[];
    availableCategories?: AvailableCategory[];
    meta: HomepageMeta;
  }>("/");
}

export async function loadCategoryTree(): Promise<CategoryNode[]> {
  const base = getCategoriesApiBase();
  let response: Response;
  try {
    response = await fetch(`${base}/tree`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Unable to load category tree.", 0);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("Invalid category tree response.", response.status);
  }

  if (!response.ok || (data as ApiErrorBody).success === false) {
    const body = data as ApiErrorBody;
    throw new ApiError(
      body.error || body.message || "Failed to load categories.",
      response.status,
      body.code
    );
  }

  const payload = data as { data?: CategoryNode[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function createBlock(body: {
  blockType: HomepageBlockType;
  config?: HomepageBlockConfig;
  position?: number;
  isVisible?: boolean;
}) {
  return requestHomepageJson<{
    success: true;
    message?: string;
    data: HomepageAdminBlock;
  }>("/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateBlock(
  id: string,
  body: {
    config?: HomepageBlockConfig;
    position?: number;
    isVisible?: boolean;
  }
) {
  return requestHomepageJson<{
    success: true;
    message?: string;
    data: HomepageAdminBlock;
  }>(`/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteBlock(id: string) {
  return requestHomepageJson<{ success: true; message?: string }>(`/${id}`, {
    method: "DELETE",
  });
}

export async function reorderHomepage(body: {
  orderedIds?: string[];
  items?: ReorderItemPayload[];
}) {
  return requestHomepageJson<{
    success: true;
    message?: string;
    data: HomepageAdminBlock[];
  }>("/reorder", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function invalidateHomepageCache() {
  return requestHomepageJson<{ success: true; message?: string }>(
    "/invalidate-cache",
    { method: "POST" }
  );
}
