export type ShippingQuotePayload = {
  sessionId: string;
  itemId: string;
  addressId: string;
  addressFingerprint: string;
  serviceName: string;
  logisticsServiceName: string;
  amountCents: number;
  currency: 'USD';
  minDays: number | null;
  maxDays: number | null;
  expiresAt: number;
};

export function getShippingQuoteSecret(secret: string | undefined) {
  const normalized = secret?.trim();
  return normalized && normalized.length >= 32 ? normalized : null;
}

export async function fingerprintShippingAddress(address: {
  countryCode: string;
  state: string;
  city: string;
  postalCode: string;
  addressLine1: string;
  addressLine2: string | null;
}) {
  const value = JSON.stringify([
    address.countryCode,
    address.state,
    address.city,
    address.postalCode,
    address.addressLine1,
    address.addressLine2,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey(secret: string) {
  const normalized = getShippingQuoteSecret(secret);
  if (!normalized) {
    throw new Error('SHIPPING_SIGNING_SECRET_UNCONFIGURED');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalized),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createShippingQuoteToken(payload: ShippingQuotePayload, secret: string) {
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    new TextEncoder().encode(encodedPayload)
  );
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function readShippingQuoteToken(token: string, secret: string): Promise<ShippingQuotePayload | null> {
  const [encodedPayload, encodedSignature, extra] = token.split('.');
  if (!encodedPayload || !encodedSignature || extra !== undefined) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await signingKey(secret),
      fromBase64Url(encodedSignature),
      new TextEncoder().encode(encodedPayload)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as Partial<ShippingQuotePayload>;
    if (
      typeof payload.sessionId !== 'string' ||
      typeof payload.itemId !== 'string' ||
      typeof payload.addressId !== 'string' ||
      typeof payload.addressFingerprint !== 'string' ||
      typeof payload.serviceName !== 'string' ||
      typeof payload.logisticsServiceName !== 'string' ||
      !Number.isSafeInteger(payload.amountCents) ||
      (payload.amountCents ?? -1) < 0 ||
      payload.currency !== 'USD' ||
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= Date.now() ||
      (payload.minDays !== null && typeof payload.minDays !== 'number') ||
      (payload.maxDays !== null && typeof payload.maxDays !== 'number')
    ) return null;
    return payload as ShippingQuotePayload;
  } catch {
    return null;
  }
}
