// ─── Types ────────────────────────────────────────────────────────────────────

export type CategoryNode = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  parentId: string | null;
  position: number;
  depth: number;
  createdAt: string | Date | number | null;
  updatedAt: string | Date | number | null;
  children: CategoryNode[];
};

export type CategoryFlat = Omit<CategoryNode, 'children'>;

export type TreeMeta = {
  total: number;
  maxDepth: number;
  currentUserId: string;
  currentUserRole: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canManage: boolean;
};

export type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
  meta?: {
    soleProductCount?: number;
    linkedProductCount?: number;
  };
};

export class ApiError extends Error {
  code?: string;
  status: number;
  meta?: ApiErrorBody['meta'];

  constructor(
    message: string,
    options: { code?: string; status?: number; meta?: ApiErrorBody['meta'] } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status ?? 500;
    this.meta = options.meta;
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

export function getCategoriesApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  return origin ? `${origin}/api/categories` : '/api/categories';
}

export async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getCategoriesApiBase();
  const url = path.startsWith('http')
    ? path
    : !path || path === '/'
      ? base
      : path.startsWith('?')
        ? `${base}${path}`
        : `${base}/${path.replace(/^\/+/, '')}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Unable to reach the server. Please try again.', {
      status: 0,
      code: 'NETWORK_ERROR',
    });
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiError(`Request failed with status ${response.status}.`, {
        status: response.status,
      });
    }
    throw new ApiError('Server returned an invalid response.', {
      status: response.status,
    });
  }

  if (!response.ok) {
    const errorBody = data as ApiErrorBody;
    throw new ApiError(
      errorBody.error ||
        errorBody.message ||
        `Request failed with status ${response.status}.`,
      {
        code: errorBody.code,
        status: response.status,
        meta: errorBody.meta,
      }
    );
  }

  const possibleError = data as ApiErrorBody;
  if (possibleError.success === false) {
    throw new ApiError(
      possibleError.error || possibleError.message || 'Request failed.',
      {
        code: possibleError.code,
        status: response.status,
        meta: possibleError.meta,
      }
    );
  }

  return data as T;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Turns a name into a URL slug like "red-bag". */
export function toCategorySlug(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 140);
}

export function countNodes(nodes: CategoryNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1 + countNodes(node.children);
  }
  return total;
}

export function findNode(
  nodes: CategoryNode[],
  id: string
): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

export function flattenTree(nodes: CategoryNode[]): CategoryFlat[] {
  const result: CategoryFlat[] = [];
  function walk(list: CategoryNode[]) {
    for (const node of list) {
      const { children: _c, ...rest } = node;
      result.push(rest);
      walk(node.children);
    }
  }
  walk(nodes);
  return result;
}
