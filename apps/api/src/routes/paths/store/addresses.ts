import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { City, State } from 'country-state-city';
import { createAuth } from '@repo/auth/server';
import { addresses, createDb, users } from '@repo/db';
import type Env from '@/types/env';
import { errorJson, type EnvContext } from '@/utils/errorJson';
import config from '@/mine.config';

const storeAddresses = new Hono<{ Bindings: Env }>();

function createAuthForRequest(c: EnvContext) {
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
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user?.id || !session.session?.id) {
      return { ok: false as const, response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.') };
    }
    const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
    if (!user || user.isDeleted || user.isBanned) {
      return { ok: false as const, response: errorJson(c, 401, 'UNAUTHORIZED', 'Authentication required.') };
    }
    return { ok: true as const, db, user };
  } catch (error) {
    console.error('store addresses: session lookup failed', error);
    return { ok: false as const, response: errorJson(c, 500, 'SESSION_ERROR', 'Unable to verify your session.') };
  }
}

function allowedOrigins(env: Env) {
  return new Set((env.ORIGINS?.split(',').map((value) => value.trim().replace(/\/$/, '')).filter(Boolean)
    ?? [config.storeFrontURI, config.adminURI, 'http://localhost:8000', 'http://localhost:8001'])
    .map((value) => value.replace(/\/$/, '')));
}

function requireTrustedMutationOrigin(c: EnvContext) {
  const origin = c.req.header('Origin')?.trim().replace(/\/$/, '');
  const referer = c.req.header('Referer');
  let refererOrigin: string | null = null;
  if (referer) {
    try { refererOrigin = new URL(referer).origin; } catch { refererOrigin = null; }
  }
  const requestOrigin = origin || refererOrigin;
  if (!requestOrigin || !allowedOrigins(c.env).has(requestOrigin) || (origin && refererOrigin && origin !== refererOrigin)) {
    return errorJson(c, 403, 'UNTRUSTED_ORIGIN', 'This request did not come from an approved application.');
  }
  return null;
}

function isText(value: unknown, min: number, max: number) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

function parseAddress(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'A JSON object is required.' };
  const data = body as Record<string, unknown>;
  const required = ['firstName', 'lastName', 'countryCode', 'countryName', 'phoneCountryCode', 'phone', 'addressLine1', 'city', 'state', 'postalCode'];
  for (const key of required) {
    if (!isText(data[key], 1, key === 'addressLine1' ? 160 : 120)) return { error: `${key} is required and invalid.` };
  }
  const countryCode = String(data.countryCode).trim().toUpperCase();
  const phoneCountryCode = String(data.phoneCountryCode).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z]{2}$/.test(phoneCountryCode)) return { error: 'Country codes must be ISO-3166 alpha-2 codes.' };
  const parsedPhone = parsePhoneNumberFromString(String(data.phone).trim(), phoneCountryCode as never);
  if (!parsedPhone?.isValid() || parsedPhone.country !== phoneCountryCode) return { error: 'Enter a valid phone number for the selected phone country.' };
  const optional = (key: string, max: number) => data[key] == null || data[key] === '' ? null : isText(data[key], 1, max) ? String(data[key]).trim() : undefined;
  const addressLine2 = optional('addressLine2', 120);
  const deliveryInstructions = optional('deliveryInstructions', 500);
  if (addressLine2 === undefined || deliveryInstructions === undefined) return { error: 'Optional address fields are invalid.' };
  const latitude = data.latitude == null ? null : Number(data.latitude);
  const longitude = data.longitude == null ? null : Number(data.longitude);
  if ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) return { error: 'Address coordinates are invalid.' };
  return {
    value: {
      firstName: String(data.firstName).trim(),
      lastName: String(data.lastName).trim(),
      countryCode,
      countryName: String(data.countryName).trim(),
      phoneCountryCode,
      phone: parsedPhone.number,
      addressLine1: String(data.addressLine1).trim(),
      addressLine2,
      city: String(data.city).trim(),
      state: String(data.state).trim(),
      postalCode: String(data.postalCode).trim(),
      deliveryInstructions,
      mapboxPlaceId: isText(data.mapboxPlaceId, 1, 200) ? String(data.mapboxPlaceId).trim() : null,
      latitude,
      longitude,
      isDefault: data.isDefault === true,
    },
  };
}

function serialize(address: typeof addresses.$inferSelect) {
  return { ...address, createdAt: address.createdAt.toISOString(), updatedAt: address.updatedAt.toISOString() };
}

storeAddresses.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});

storeAddresses.get('/', async (c) => {
  const access = await requireUser(c);
  if (!access.ok) return access.response;
  try {
    const rows = await access.db.select().from(addresses).where(eq(addresses.userId, access.user.id)).orderBy(desc(addresses.isDefault), desc(addresses.updatedAt));
    return c.json({ success: true, data: { addresses: rows.map(serialize) } });
  } catch (error) {
    console.error('store addresses: list failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to load your addresses.');
  }
});

storeAddresses.get('/locations', async (c) => {
  const access = await requireUser(c);
  if (!access.ok) return access.response;
  const country = c.req.query('country')?.trim().toUpperCase();
  const type = c.req.query('type');
  const query = c.req.query('q')?.trim().toLowerCase() ?? '';
  const state = c.req.query('state')?.trim().toUpperCase();
  if (!country || !/^[A-Z]{2}$/.test(country)) return errorJson(c, 400, 'INVALID_COUNTRY', 'A valid ISO country code is required.');
  if (type !== 'state' && type !== 'city') return errorJson(c, 400, 'INVALID_LOCATION_TYPE', 'Location type must be state or city.');

  const options = type === 'state'
    ? State.getStatesOfCountry(country)
        .filter((item) => !query || item.name.toLowerCase().includes(query))
        .slice(0, 100)
        .map((item) => ({ id: item.isoCode, label: item.name, code: item.isoCode }))
    : state
      ? City.getCitiesOfState(country, state)
          .filter((item) => !query || item.name.toLowerCase().includes(query))
          .slice(0, 100)
          .map((item) => ({ id: `${item.countryCode}-${item.stateCode}-${item.name}`, label: item.name, code: item.name }))
      : [];

  return c.json({ success: true, data: { options } });
});

storeAddresses.get('/search', async (c) => {
  const access = await requireUser(c);
  if (!access.ok) return access.response;
  const query = c.req.query('q')?.trim();
  const country = c.req.query('country')?.trim().toLowerCase();
  const requestedTypes = c.req.query('types')?.trim();
  if (!query || query.length < 3 || query.length > 160) return errorJson(c, 400, 'INVALID_QUERY', 'Search must be between 3 and 160 characters.');
  if (!country || !/^[a-z]{2}$/.test(country)) return errorJson(c, 400, 'INVALID_COUNTRY', 'A valid ISO country code is required.');
  const mapboxToken = c.env.MAPBOX_ACCESS_TOKEN?.trim();
  if (!mapboxToken) return errorJson(c, 503, 'MAPBOX_NOT_CONFIGURED', 'Address search is temporarily unavailable.');
  try {
    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
    url.searchParams.set('q', query);
    url.searchParams.set('access_token', mapboxToken);
    url.searchParams.set('autocomplete', 'true');
    url.searchParams.set('limit', '5');
    const allowedTypes = new Set(['address', 'place', 'postcode', 'locality', 'region', 'street']);
    const types = requestedTypes
      ?.split(',')
      .map((type) => type.trim())
      .filter((type) => allowedTypes.has(type))
      .join(',');
    url.searchParams.set('types', types || 'address,place,postcode,locality,region,street');
    url.searchParams.set('language', 'en');
    url.searchParams.set('country', country);
    const response = await fetch(url);
    if (!response.ok) {
      console.error('store addresses: Mapbox returned an error', response.status, await response.text());
      return errorJson(c, 502, 'MAPBOX_ERROR', 'Address search is temporarily unavailable.');
    }
    const payload = await response.json() as {
      features?: Array<{
        id?: string;
        properties?: { full_address?: string; name?: string; address?: string; context?: Record<string, { name?: string; country_code?: string }> };
        geometry?: { coordinates?: [number, number] };
      }>;
    };
    return c.json({
      success: true,
      data: {
        results: (payload.features ?? []).map((feature) => ({
          id: feature.id ?? '',
          label: feature.properties?.full_address
            ?? [feature.properties?.address, feature.properties?.name].filter(Boolean).join(', ')
            ?? '',
          longitude: feature.geometry?.coordinates?.[0] ?? null,
          latitude: feature.geometry?.coordinates?.[1] ?? null,
          context: feature.properties?.context ?? {},
        })),
      },
    });
  } catch (error) {
    console.error('store addresses: mapbox search failed', error);
    return errorJson(c, 502, 'MAPBOX_ERROR', 'Address search is temporarily unavailable.');
  }
});

storeAddresses.post('/', async (c) => {
  const originError = requireTrustedMutationOrigin(c);
  if (originError) return originError;
  if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return errorJson(c, 415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON is required.');
  const access = await requireUser(c);
  if (!access.ok) return access.response;
  try {
    const parsed = parseAddress(await c.req.json<unknown>());
    if ('error' in parsed) return errorJson(c, 400, 'INVALID_ADDRESS', parsed.error ?? 'Invalid address.');
    const now = new Date();
    const id = nanoid(24);
    if (parsed.value.isDefault) {
      await access.db.update(addresses).set({ isDefault: false, updatedAt: now }).where(and(eq(addresses.userId, access.user.id), eq(addresses.isDefault, true)));
    }
    await access.db.insert(addresses).values({ ...parsed.value, id, userId: access.user.id, createdAt: now, updatedAt: now });
    if (parsed.value.isDefault) {
      await access.db.update(users).set({ defaultAddressId: id, updatedAt: now }).where(eq(users.id, access.user.id));
    }
    const [created] = await access.db.select().from(addresses).where(and(eq(addresses.id, id), eq(addresses.userId, access.user.id))).limit(1);
    return c.json({ success: true, data: { address: serialize(created!) } }, 201);
  } catch (error) {
    console.error('store addresses: create failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to save your address.');
  }
});

storeAddresses.patch('/:id', async (c) => {
  const originError = requireTrustedMutationOrigin(c);
  if (originError) return originError;
  if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return errorJson(c, 415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON is required.');
  const access = await requireUser(c);
  if (!access.ok) return access.response;
  const id = c.req.param('id');
  try {
    const [existing] = await access.db.select().from(addresses).where(and(eq(addresses.id, id), eq(addresses.userId, access.user.id))).limit(1);
    if (!existing) return errorJson(c, 404, 'ADDRESS_NOT_FOUND', 'Address not found.');
    const parsed = parseAddress(await c.req.json<unknown>());
    if ('error' in parsed) return errorJson(c, 400, 'INVALID_ADDRESS', parsed.error ?? 'Invalid address.');
    const now = new Date();
    if (parsed.value.isDefault) {
      await access.db.update(addresses).set({ isDefault: false, updatedAt: now }).where(and(eq(addresses.userId, access.user.id), eq(addresses.isDefault, true)));
    }
    await access.db.update(addresses).set({ ...parsed.value, updatedAt: now }).where(and(eq(addresses.id, id), eq(addresses.userId, access.user.id)));
    if (parsed.value.isDefault) {
      await access.db.update(users).set({ defaultAddressId: id, updatedAt: now }).where(eq(users.id, access.user.id));
    } else if (existing.isDefault) {
      await access.db.update(users).set({ defaultAddressId: null, updatedAt: now }).where(eq(users.id, access.user.id));
    }
    const [updated] = await access.db.select().from(addresses).where(and(eq(addresses.id, id), eq(addresses.userId, access.user.id))).limit(1);
    return c.json({ success: true, data: { address: serialize(updated!) } });
  } catch (error) {
    console.error('store addresses: update failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to update your address.');
  }
});

storeAddresses.delete('/:id', async (c) => {
  const originError = requireTrustedMutationOrigin(c);
  if (originError) return originError;
  const access = await requireUser(c);
  if (!access.ok) return access.response;
  const id = c.req.param('id');
  try {
    const result = await access.db.delete(addresses).where(and(eq(addresses.id, id), eq(addresses.userId, access.user.id))).run();
    if (result.meta.changes === 0) return errorJson(c, 404, 'ADDRESS_NOT_FOUND', 'Address not found.');
    if (access.user.defaultAddressId === id) await access.db.update(users).set({ defaultAddressId: null, updatedAt: new Date() }).where(eq(users.id, access.user.id));
    return c.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error('store addresses: delete failed', error);
    return errorJson(c, 500, 'INTERNAL_ERROR', 'Unable to delete your address.');
  }
});

storeAddresses.all('*', (c) => errorJson(c, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));

export default storeAddresses;
