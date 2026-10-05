import { buildPublicObjectUrl, type R2UrlEnv } from '@/utils/cf-tools/r2';

const R2_USER_IMAGE_PATH = /^\/?user\/image\/([A-Za-z0-9_-]{1,128}-\d+\.webp)$/;

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname
    ) {
      return url;
    }
  } catch {
    return null;
  }
  return null;
}

export function isGoogleUserImageUrl(image: string): boolean {
  const candidate = image.startsWith('//') ? `https:${image}` : image;
  const url = parseHttpUrl(candidate);
  if (!url) return false;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  return (
    hostname === 'googleusercontent.com' ||
    hostname.endsWith('.googleusercontent.com') ||
    hostname === 'ggpht.com' ||
    hostname.endsWith('.ggpht.com')
  );
}

/**
 * Keep provider/CDN URLs intact; resolve only our canonical relative R2 user
 * image keys. This avoids prefixing domains onto already-absolute URLs.
 */
export function resolveUserImageUrl(
  image: string | null | undefined,
  env: R2UrlEnv,
  origin: string
): string | null {
  if (typeof image !== 'string' || image.length === 0) return image ?? null;

  if (isGoogleUserImageUrl(image)) return image;

  const absoluteUrl = image.startsWith('//')
    ? parseHttpUrl(`https:${image}`)
    : parseHttpUrl(image);
  if (absoluteUrl) return image;

  const match = R2_USER_IMAGE_PATH.exec(image);
  if (!match) return image;

  return (
    buildPublicObjectUrl(env, `user/image/${match[1]}`, { origin }) ?? image
  );
}

export function resolveUserImageResponse<T extends { image?: string | null }>(
  user: T,
  env: R2UrlEnv,
  origin: string
): Omit<T, 'image'> & { image: string | null } {
  return {
    ...user,
    image: resolveUserImageUrl(user.image, env, origin),
  };
}

export async function resolveAuthSessionImageResponse(
  response: Response,
  env: R2UrlEnv,
  origin: string
): Promise<Response> {
  if (
    !response.ok ||
    !response.headers.get('Content-Type')?.includes('application/json')
  ) {
    return response;
  }

  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch (error) {
    console.error(
      'auth: unable to normalize session user image response',
      error
    );
    return response;
  }

  if (!payload || typeof payload !== 'object' || !('user' in payload)) {
    return response;
  }

  const user = payload.user;
  if (
    !user ||
    typeof user !== 'object' ||
    !('image' in user) ||
    typeof user.image !== 'string'
  ) {
    return response;
  }

  const image = resolveUserImageUrl(user.image, env, origin);
  if (image === user.image) return response;

  const normalizedPayload = {
    ...payload,
    user: { ...user, image },
  };
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  headers.delete('Transfer-Encoding');

  return new Response(JSON.stringify(normalizedPayload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
