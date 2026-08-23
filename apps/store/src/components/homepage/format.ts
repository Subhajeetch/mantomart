export function formatPriceCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return "";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Savings amount: whole dollars without cents, otherwise two decimal places. */
export function formatSavingsAmount(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents) || cents <= 0) {
    return "";
  }
  const amount = cents / 100;
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

export function formatRating(rating: number | null | undefined): string {
  if (
    rating === null ||
    rating === undefined ||
    !Number.isFinite(rating) ||
    rating <= 0
  ) {
    return "";
  }
  return (Math.round(rating * 10) / 10).toFixed(1);
}

export function formatReviewCount(count: number | null | undefined): string {
  if (
    count === null ||
    count === undefined ||
    !Number.isFinite(count) ||
    count <= 0
  ) {
    return "";
  }
  const n = Math.floor(count);
  if (n < 1000) return String(n);
  if (n < 10_000) {
    const tenths = Math.round(n / 100) / 10;
    return Number.isInteger(tenths) ? `${tenths}k` : `${tenths.toFixed(1)}k`;
  }
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  const millions = Math.round(n / 100_000) / 10;
  return Number.isInteger(millions)
    ? `${millions}m`
    : `${millions.toFixed(1)}m`;
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
