// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return 'Never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatRelative(value: string | Date | null | undefined) {
  if (!value) return 'Never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), 'day');
  return formatDateTime(date);
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function looksLikeEmail(value: string) {
  return value.includes('@');
}

export function formatPermissionText(value: string) {
  return value
    .replace(/[:_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getPermissionGroup(permission: string) {
  return formatPermissionText(permission.split(':')[0] ?? 'Other');
}

export function getPermissionAction(permission: string) {
  return formatPermissionText(permission.split(':')[1] ?? permission);
}