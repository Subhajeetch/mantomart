export function formatPriceCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return "";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function percentOff(
  price: number | null | undefined,
  compareAt: number | null | undefined
): number {
  if (
    price === null ||
    price === undefined ||
    compareAt === null ||
    compareAt === undefined ||
    !(compareAt > price) ||
    compareAt <= 0
  ) {
    return 0;
  }
  return Math.max(1, Math.round((1 - price / compareAt) * 100));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
