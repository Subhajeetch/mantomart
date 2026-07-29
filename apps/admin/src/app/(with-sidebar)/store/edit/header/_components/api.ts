import type {
  ApiErrorBody,
  AvailableCategory,
  CategoryNode,
  HeaderAdminCollection,
  HeaderMeta,
  ReorderCollectionPayload,
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

function getHeaderApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  return origin ? `${origin}/api/admin/header` : "/api/admin/header";
}

function getCategoriesApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  return origin ? `${origin}/api/categories` : "/api/categories";
}

export async function requestHeaderJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getHeaderApiBase();
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

export async function loadHeader() {
  return requestHeaderJson<{
    success: true;
    data: HeaderAdminCollection[];
    availableCategories?: AvailableCategory[];
    meta: HeaderMeta;
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

export async function createCollection(body: {
  categoryId: string;
  position?: number;
  isVisible?: boolean;
}) {
  return requestHeaderJson<{
    success: true;
    message?: string;
    data: HeaderAdminCollection;
  }>("/collections", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateCollection(
  id: string,
  body: {
    categoryId?: string;
    position?: number;
    isVisible?: boolean;
  }
) {
  return requestHeaderJson<{ success: true; message?: string }>(
    `/collections/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    }
  );
}

export async function deleteCollection(id: string) {
  return requestHeaderJson<{ success: true; message?: string }>(
    `/collections/${id}`,
    { method: "DELETE" }
  );
}

export async function createItem(
  collectionId: string,
  body: {
    categoryId?: string;
    slug?: string;
    name?: string;
    parentId?: string;
    position?: number;
    isVisible?: boolean;
    featured?: boolean;
    href?: string | null;
  }
) {
  return requestHeaderJson<{ success: true; message?: string }>(
    `/collections/${collectionId}/items`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function importCategoryTree(collectionId: string) {
  return requestHeaderJson<{
    success: true;
    message?: string;
    data: HeaderAdminCollection | null;
    meta?: { createdCount: number };
  }>(`/collections/${collectionId}/import-tree`, { method: "POST" });
}

export async function updateItem(
  id: string,
  body: {
    categoryId?: string;
    slug?: string;
    name?: string;
    parentId?: string;
    position?: number;
    isVisible?: boolean;
    featured?: boolean;
    href?: string | null;
  }
) {
  return requestHeaderJson<{ success: true; message?: string }>(
    `/items/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    }
  );
}

export async function deleteItem(id: string) {
  return requestHeaderJson<{ success: true; message?: string }>(
    `/items/${id}`,
    { method: "DELETE" }
  );
}

export async function reorderHeader(body: {
  collections?: ReorderCollectionPayload[];
  items?: ReorderItemPayload[];
}) {
  return requestHeaderJson<{
    success: true;
    message?: string;
    data: HeaderAdminCollection[];
  }>("/reorder", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function invalidateHeaderCache() {
  return requestHeaderJson<{ success: true; message?: string }>(
    "/invalidate-cache",
    { method: "POST" }
  );
}
