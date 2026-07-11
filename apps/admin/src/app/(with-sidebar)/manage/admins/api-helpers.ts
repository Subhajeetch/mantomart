import type { ApiErrorBody } from './types';

/**
 * Resolves the base URL for the admin API.
 * Uses NEXT_PUBLIC_API_URL if set (for cross-origin deployments), otherwise
 * falls back to a same-origin rewrite so session cookies are sent correctly.
 */
export function getAdminsApiBase(): string {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  return origin ? `${origin}/api/admins` : '/api/admins';
}

/**
 * Typed JSON fetch wrapper for admin API calls.
 * - Sends credentials so better-auth session cookies are included.
 * - Handles network errors, non-OK responses, and success: false bodies uniformly.
 */
export async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getAdminsApiBase();
  const url = path.startsWith('http')
    ? path
    : `${base}${path.startsWith('/') ? path : `/${path}`}`;

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
    throw new Error('Unable to reach the server. Please try again.');
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }
    throw new Error('Server returned an invalid response.');
  }

  if (!response.ok) {
    const errorBody = data as ApiErrorBody;
    throw new Error(
      errorBody.error || errorBody.message || `Request failed with status ${response.status}.`
    );
  }

  const possibleError = data as ApiErrorBody;
  if (possibleError.success === false) {
    throw new Error(
      possibleError.error || possibleError.message || 'Request failed.'
    );
  }

  return data as T;
}