import { Hono } from 'hono';
import { and, asc, eq, gt } from 'drizzle-orm';
import { createAuth } from '@repo/auth/server';
import { accounts, createDb, sessions, users } from '@repo/db';
import type Env from '@/types/env';
import { errorJson, type EnvContext } from '@/utils/http/errorJson';
import config from '@/mine.config';
import {
  deleteFromR2,
  uploadToR2,
} from '@/utils/cf-tools/r2';
import {
  MAX_PROFILE_IMAGE_BYTES,
  MAX_PROFILE_IMAGE_REQUEST_BYTES,
  validateProfileImage,
} from '@/utils/images/profileImage';
import { resolveUserImageUrl } from '@/utils/users/userImage';

const storeAccount = new Hono<{ Bindings: Env }>();

type ConsumerGender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

const genders: ConsumerGender[] = [
  'male',
  'female',
  'other',
  'prefer_not_to_say',
];

function createAuthForRequest(c: {
  env: Env;
  req: { raw: Request };
}) {
  const db = createDb(c.env.DB);
  const auth = createAuth(db, {
    GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
    NODE_ENV: c.env.NODE_ENV,
    API_URL: c.env.API_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    ORIGINS: c.env.ORIGINS,
    DOMAIN: c.env.DOMAIN,
  });
  return { db, auth };
}

async function requireUser(c: EnvContext) {
  const { db, auth } = createAuthForRequest(c);
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;

  try {
    session = await auth.api.getSession({ headers: c.req.raw.headers });
  } catch (error) {
    console.error('store account: session lookup failed', error);
    return {
      ok: false as const,
      response: errorJson(c, 500, 'SESSION_ERROR', 'Unable to verify your session.'),
    };
  }

  if (!session?.user?.id || !session.session?.id) {
    return {
      ok: false as const,
      response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.'),
    };
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const user = userRows[0];

  if (!user || user.isDeleted || user.isBanned) {
    return {
      ok: false as const,
      response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.'),
    };
  }

  return { ok: true as const, db, user, session };
}

function allowedOrigins(env: Env): Set<string> {
  const configured = env.ORIGINS
    ?.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return new Set(
    (configured?.length
      ? configured
      : [config.storeFrontURI, config.adminURI, 'http://localhost:8000', 'http://localhost:8001']
    ).map((origin) => origin.replace(/\/$/, ''))
  );
}

async function readRequestBodyWithinLimit(
  request: Request,
  maxBytes: number
): Promise<Uint8Array | null> {
  const reader = request.clone().body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Cookie-authenticated mutations need an explicit same-site origin signal.
 * This prevents another site from replaying a user's browser cookies through
 * a cross-site form or fetch request.
 */
function requireTrustedMutationOrigin(c: EnvContext) {
  const origin = c.req.header('Origin')?.trim().replace(/\/$/, '');
  const referer = c.req.header('Referer');
  let refererOrigin: string | null = null;
  if (referer) {
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      refererOrigin = null;
    }
  }
  const requestOrigin = origin || refererOrigin;

  if (
    !requestOrigin ||
    !allowedOrigins(c.env).has(requestOrigin) ||
    (origin && refererOrigin && origin !== refererOrigin)
  ) {
    return errorJson(
      c,
      403,
      'UNTRUSTED_ORIGIN',
      'This request did not come from an approved application.'
    );
  }

  return null;
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeProfile(
  user: typeof users.$inferSelect,
  env: Env,
  origin: string
) {
  return {
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: resolveUserImageUrl(user.image, env, origin),
    firstName: user.firstName,
    lastName: user.lastName,
    dateOfBirth: toIso(user.dateOfBirth),
    gender: (user.gender as ConsumerGender | null) ?? null,
    emailNotifications: user.emailNotifications,
    smsNotifications: user.smsNotifications,
    currency: user.currency,
    locale: user.locale,
    timezone: user.timezone,
  };
}

function serializeSession(
  session: typeof sessions.$inferSelect,
  currentSessionId: string
) {
  return {
    id: session.id,
    userAgent: session.userAgent,
    createdAt: toIso(session.createdAt),
    updatedAt: toIso(session.updatedAt),
    expiresAt: toIso(session.expiresAt),
    current: session.id === currentSessionId,
  };
}

function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function parseDateOfBirth(value: unknown): Date | null | undefined {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date > new Date()) return undefined;
  return date;
}

storeAccount.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  c.header('Pragma', 'no-cache');
  c.header('Vary', 'Cookie');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});

storeAccount.get('/', async (c) => {
  try {
    const access = await requireUser(c);
    if (!access.ok) return access.response;

    const [providerRows, sessionRows] = await Promise.all([
      access.db
        .select({ providerId: accounts.providerId })
        .from(accounts)
        .where(eq(accounts.userId, access.user.id)),
      access.db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, access.user.id),
            gt(sessions.expiresAt, new Date())
          )
        )
        .orderBy(asc(sessions.createdAt)),
    ]);

    const linkedProviders = [...new Set(
      providerRows
        .map((row) => row.providerId.trim().toLowerCase())
        .filter(Boolean)
    )];

    return c.json({
      success: true,
      data: {
        profile: serializeProfile(access.user, c.env, new URL(c.req.url).origin),
        linkedProviders,
        sessions: sessionRows.map((session) =>
          serializeSession(session, access.session.session.id)
        ),
      },
    });
  } catch (error) {
    console.error('store account: profile load failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to load your account.');
  }
});

storeAccount.patch('/', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;
    if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return errorJson(c, 415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON is required.');
    }

    const access = await requireUser(c);
    if (!access.ok) return access.response;

    const body = await c.req.json<unknown>();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorJson(c, 400, 'INVALID_BODY', 'A JSON object is required.');
    }
    const fields = body as Record<string, unknown>;
    const changes: Partial<typeof users.$inferInsert> = {};

    if ('name' in fields) {
      if (typeof fields.name !== 'string' || fields.name.trim().length < 1 || fields.name.trim().length > 120) {
        return errorJson(c, 400, 'INVALID_NAME', 'Name must be between 1 and 120 characters.');
      }
      changes.name = fields.name.trim();
    }

    if ('dateOfBirth' in fields) {
      const parsed = parseDateOfBirth(fields.dateOfBirth);
      if (parsed === undefined) {
        return errorJson(c, 400, 'INVALID_DATE_OF_BIRTH', 'Date of birth must be a valid past date.');
      }
      changes.dateOfBirth = parsed;
    }

    if ('gender' in fields) {
      if (fields.gender !== null && (!genders.includes(fields.gender as ConsumerGender))) {
        return errorJson(c, 400, 'INVALID_GENDER', 'Gender is not supported.');
      }
      changes.gender = fields.gender as ConsumerGender | null;
    }

    if ('emailNotifications' in fields || 'smsNotifications' in fields) {
      for (const field of ['emailNotifications', 'smsNotifications'] as const) {
        if (field in fields && typeof fields[field] !== 'boolean') {
          return errorJson(c, 400, 'INVALID_PREFERENCE', `${field} must be a boolean.`);
        }
        if (field in fields) changes[field] = fields[field] as boolean;
      }
    }

    if ('currency' in fields) {
      if (typeof fields.currency !== 'string' || !/^[A-Za-z]{3}$/.test(fields.currency.trim())) {
        return errorJson(c, 400, 'INVALID_CURRENCY', 'Currency must be a three-letter code.');
      }
      changes.currency = fields.currency.trim().toUpperCase();
    }

    if ('locale' in fields) {
      if (typeof fields.locale !== 'string' || fields.locale.trim().length < 2 || fields.locale.trim().length > 32) {
        return errorJson(c, 400, 'INVALID_LOCALE', 'Locale is invalid.');
      }
      changes.locale = fields.locale.trim();
    }

    if ('timezone' in fields) {
      if (typeof fields.timezone !== 'string' || !isValidTimezone(fields.timezone.trim())) {
        return errorJson(c, 400, 'INVALID_TIMEZONE', 'Timezone must be a valid IANA timezone.');
      }
      changes.timezone = fields.timezone.trim();
    }

    if (Object.keys(changes).length > 0) {
      changes.updatedAt = new Date();
      await access.db.update(users).set(changes).where(eq(users.id, access.user.id));
    }

    const [updated] = await access.db
      .select()
      .from(users)
      .where(eq(users.id, access.user.id))
      .limit(1);

    return c.json({
      success: true,
      data: serializeProfile(updated ?? access.user, c.env, new URL(c.req.url).origin),
    });
  } catch (error) {
    console.error('store account: profile update failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to update your account.');
  }
});

storeAccount.post('/image', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;

    const contentType = c.req.header('Content-Type')?.trim() ?? '';
    const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'multipart/form-data' || !contentType.includes(';')) {
      return errorJson(
        c,
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Upload a cropped WebP image using multipart form data.'
      );
    }

    const contentLength = c.req.header('Content-Length');
    if (contentLength) {
      const length = Number(contentLength);
      if (!Number.isSafeInteger(length) || length < 0) {
        return errorJson(c, 400, 'INVALID_CONTENT_LENGTH', 'Upload size is invalid.');
      }
      if (length > MAX_PROFILE_IMAGE_REQUEST_BYTES) {
        return errorJson(c, 413, 'REQUEST_TOO_LARGE', 'The image upload request is too large.');
      }
    }

    const access = await requireUser(c);
    if (!access.ok) return access.response;

    if (!c.env.R2_IMAGES) {
      return errorJson(
        c,
        503,
        'R2_NOT_CONFIGURED',
        'Image storage is temporarily unavailable.'
      );
    }

    let requestBody: Uint8Array | null;
    try {
      requestBody = await readRequestBodyWithinLimit(
        c.req.raw,
        MAX_PROFILE_IMAGE_REQUEST_BYTES
      );
    } catch (error) {
      console.error('store account: profile image request read failed', error);
      return errorJson(c, 400, 'INVALID_MULTIPART', 'Could not read the image upload.');
    }
    if (!requestBody) {
      return errorJson(c, 413, 'REQUEST_TOO_LARGE', 'The image upload request is too large.');
    }

    let form: FormData;
    try {
      form = await new Response(requestBody, {
        headers: { 'Content-Type': contentType },
      }).formData();
    } catch (error) {
      console.error('store account: profile image form parsing failed', error);
      return errorJson(c, 400, 'INVALID_MULTIPART', 'Could not read the image upload.');
    }

    const files = form.getAll('file');
    if (
      files.length !== 1 ||
      [...form.keys()].some((key) => key !== 'file') ||
      !(files[0] instanceof File)
    ) {
      return errorJson(c, 400, 'INVALID_FILE', 'Provide exactly one image file.');
    }

    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.webp') || file.type !== 'image/webp') {
      return errorJson(
        c,
        415,
        'INVALID_FILE_TYPE',
        'Only optimized WebP profile images are accepted.'
      );
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      return errorJson(c, 413, 'IMAGE_TOO_LARGE', 'The optimized image must be 30 KB or smaller.');
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      console.error('store account: profile image read failed', error);
      return errorJson(c, 400, 'FILE_READ_FAILED', 'Could not read the image file.');
    }

    const validation = validateProfileImage(bytes);
    if (!validation.ok) {
      const status = validation.code === 'IMAGE_TOO_LARGE' ? 413 : 400;
      return errorJson(c, status, validation.code, validation.message);
    }

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(access.user.id)) {
      console.error('store account: invalid user id for profile image key');
      return errorJson(c, 500, 'INVALID_USER_ID', 'Unable to save your profile image.');
    }

    const epoch = Date.now();
    const key = `user/image/${access.user.id}-${epoch}.webp`;
    const uploaded = await uploadToR2(
      c.env,
      {
        key,
        body: bytes,
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      },
      { origin: new URL(c.req.url).origin }
    );

    if (!uploaded.ok) {
      const status = uploaded.error.code === 'R2_NOT_CONFIGURED' ? 503 : 502;
      return errorJson(c, status, uploaded.error.code, 'Unable to store your profile image.');
    }

    const storedPath = `/${key}`;
    try {
      const result = await access.db
        .update(users)
        .set({ image: storedPath, updatedAt: new Date() })
        .where(eq(users.id, access.user.id))
        .run();

      if (result.meta.changes === 0) {
        await deleteFromR2(c.env, key);
        return errorJson(c, 404, 'USER_NOT_FOUND', 'Your account could not be found.');
      }
    } catch (error) {
      console.error('store account: profile image database update failed', error);
      const cleanup = await deleteFromR2(c.env, key);
      if (!cleanup.ok) {
        console.error('store account: failed to clean up unreferenced profile image', cleanup);
      }
      return errorJson(c, 500, 'PROFILE_IMAGE_SAVE_FAILED', 'Unable to save your profile image.');
    }

    const updatedUser = { ...access.user, image: storedPath, updatedAt: new Date() };
    return c.json(
      {
        success: true,
        data: serializeProfile(updatedUser, c.env, new URL(c.req.url).origin),
      },
      201
    );
  } catch (error) {
    console.error('store account: profile image upload failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to update your profile image.');
  }
});

storeAccount.delete('/sessions/:sessionId', async (c) => {
  try {
    const originError = requireTrustedMutationOrigin(c);
    if (originError) return originError;

    const access = await requireUser(c);
    if (!access.ok) return access.response;

    const sessionId = c.req.param('sessionId')?.trim();
    if (!sessionId || sessionId.length > 128) {
      return errorJson(c, 400, 'INVALID_SESSION', 'Invalid session.');
    }

    const result = await access.db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, access.user.id)))
      .run();

    if (result.meta.changes === 0) {
      return errorJson(c, 404, 'SESSION_NOT_FOUND', 'Session not found.');
    }

    return c.json({ success: true, data: { revoked: true } });
  } catch (error) {
    console.error('store account: session revoke failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to sign out that session.');
  }
});

storeAccount.all('*', (c) =>
  errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
);

export default storeAccount;
