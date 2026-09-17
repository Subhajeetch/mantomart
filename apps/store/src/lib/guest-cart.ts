/**
 * Guest cart identity — an anonymous token persisted in localStorage.
 *
 * The token is sent to the API as the `X-Guest-Id` header so an anonymous
 * shopper can keep a cart across pages/reloads. When they sign in, the API
 * merges the guest cart into their account cart and the client clears the
 * token (`syncGuestIdentity` runs against every cart response).
 */

const GUEST_ID_KEY = "ragimart.guest.cart";

export function getStoredGuestId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(GUEST_ID_KEY);
  } catch {
    return null; // storage unavailable (private mode / disabled)
  }
}

function persistGuestId(id: string) {
  try {
    window.localStorage.setItem(GUEST_ID_KEY, id);
  } catch {
    /* ignore storage quota / availability errors */
  }
}

export function clearStoredGuestId() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(GUEST_ID_KEY);
  } catch {
    /* ignore */
  }
}

/** Fresh random token used when the client makes its first guest mutation. */
export function createGuestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }
}

let inFlightId: string | null = null;

/**
 * Attach the guest token to a request's headers.
 *
 * If none is stored yet, this self-provisions one so the very first guest
 * mutation ("Add to Cart" while logged out) already carries an identity — the
 * API rejects guest writes that can't be attributed to a cart.
 */
export function withGuestHeader(init?: RequestInit): RequestInit {
  const stored = getStoredGuestId();
  const id = stored ?? inFlightId ?? createGuestId();
  inFlightId = id;
  if (id !== stored) persistGuestId(id);
  return {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      "X-Guest-Id": id,
    },
  };
}

/**
 * Reflect the API's `{ mode, guestId }` meta back into localStorage:
 * a `guest` response persists the token we're using, and a `user` response
 * clears any leftover token now that the account cart owns the session.
 */
export function syncGuestIdentity(data: unknown) {
  if (!data || typeof data !== "object") return;
  const mode = (data as { mode?: unknown }).mode;
  const guestId = (data as { guestId?: unknown }).guestId;
  if (mode === "user") {
    clearStoredGuestId();
    inFlightId = null;
    return;
  }
  if (mode === "guest" && typeof guestId === "string" && guestId) {
    inFlightId = guestId;
    persistGuestId(guestId);
  }
}