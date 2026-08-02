/**
 * Shared image-upload helpers: validation, naming, folder allow-list, WebP checks.
 *
 * Filename convention:
 *   {name}_{purpose}_{unixEpoch}.webp
 * Example:
 *   fashion_category_1712345678.webp
 *
 * Object key:
 *   {folder}/{filename}
 * Example:
 *   category/fashion_category_1712345678.webp
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard max body size accepted by the upload API (after client-side crop). */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MiB

/** Soft recommendation for category icons after crop (informational). */
export const CATEGORY_ICON_SIZE = 128;

/**
 * Allowed storage folders. Keep this tight — path traversal is rejected
 * separately, but only these top-level folders are accepted.
 */
export const ALLOWED_IMAGE_FOLDERS = [
  'category',
  'product',
  'product-gallery',
  'product-variant',
  'banner',
  'brand',
  'review',
  'user',
  'misc',
] as const;

export type ImageFolder = (typeof ALLOWED_IMAGE_FOLDERS)[number];

/** Purpose / about-image labels that pair with folders for filenames. */
export const ALLOWED_IMAGE_PURPOSES = [
  'category',
  'product',
  'product-gallery',
  'product-variant',
  'product-main',
  'banner',
  'brand',
  'review',
  'avatar',
  'size-chart',
  'misc',
] as const;

export type ImagePurpose = (typeof ALLOWED_IMAGE_PURPOSES)[number];

/** WebP RIFF magic: "RIFF....WEBP" */
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46] as const; // RIFF
const WEBP_WEBP = [0x57, 0x45, 0x42, 0x50] as const; // WEBP at offset 8

// ─── Validation ───────────────────────────────────────────────────────────────

export function isAllowedFolder(value: string): value is ImageFolder {
  return (ALLOWED_IMAGE_FOLDERS as readonly string[]).includes(value);
}

export function isAllowedPurpose(value: string): value is ImagePurpose {
  return (ALLOWED_IMAGE_PURPOSES as readonly string[]).includes(value);
}

/**
 * Slugify a free-form name into a safe filename segment.
 * Returns null if nothing usable remains.
 */
export function sanitizeImageNameSegment(
  input: string,
  maxLength = 80
): string | null {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLength);

  return slug.length > 0 ? slug : null;
}

/**
 * Validate purpose string. Allows known purposes OR a compound like
 * "category-fashion" (folder-name) when it matches /^[a-z0-9]+(-[a-z0-9]+)*$/.
 */
export function sanitizeImagePurpose(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 64) return null;

  if (isAllowedPurpose(trimmed)) return trimmed;

  // Allow compound purposes: category-fashion, product-main, etc.
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(trimmed)) return null;
  // Must start with a known base purpose
  const base = trimmed.split('-')[0] ?? '';
  if (!isAllowedPurpose(base) && base !== 'category' && base !== 'product') {
    // still allow if full string is well-formed and base is in folders
    if (!(ALLOWED_IMAGE_FOLDERS as readonly string[]).includes(base)) {
      return null;
    }
  }
  return trimmed;
}

export function sanitizeImageFolder(value: string): ImageFolder | null {
  const trimmed = value.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  if (!isAllowedFolder(trimmed)) return null;
  return trimmed;
}

/** True if bytes look like a WebP file (RIFF container + WEBP fourcc). */
export function isWebPBuffer(bytes: ArrayBuffer | Uint8Array): boolean {
  const view =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.byteLength < 12) return false;

  for (let i = 0; i < 4; i++) {
    if (view[i] !== WEBP_RIFF[i]) return false;
  }
  for (let i = 0; i < 4; i++) {
    if (view[8 + i] !== WEBP_WEBP[i]) return false;
  }
  return true;
}

/**
 * Build object key + filename.
 * `{name}_{purpose}_{unixEpoch}.webp` under `{folder}/`
 */
export function buildImageObjectKey(options: {
  folder: ImageFolder;
  name: string;
  purpose: string;
  /** Override epoch; defaults to Date.now() */
  epochMs?: number;
}): { key: string; filename: string; epoch: number } {
  const epoch = options.epochMs ?? Date.now();
  const filename = `${options.name}_${options.purpose}_${epoch}.webp`;
  const key = `${options.folder}/${filename}`;
  return { key, filename, epoch };
}

export type ParsedUploadFields = {
  folder: ImageFolder;
  name: string;
  purpose: string;
};

export type ParseFieldsError = {
  code: string;
  message: string;
};

/**
 * Parse and validate folder / name / purpose from form fields or JSON.
 */
export function parseUploadMeta(input: {
  folder?: unknown;
  name?: unknown;
  purpose?: unknown;
  /** Alias for purpose accepted from clients */
  about?: unknown;
}): { ok: true; data: ParsedUploadFields } | { ok: false; error: ParseFieldsError } {
  const folderRaw =
    typeof input.folder === 'string' ? input.folder : undefined;
  const nameRaw = typeof input.name === 'string' ? input.name : undefined;
  const purposeRaw =
    typeof input.purpose === 'string'
      ? input.purpose
      : typeof input.about === 'string'
        ? input.about
        : undefined;

  if (!folderRaw) {
    return {
      ok: false,
      error: {
        code: 'MISSING_FOLDER',
        message: `folder is required. Allowed: ${ALLOWED_IMAGE_FOLDERS.join(', ')}.`,
      },
    };
  }

  const folder = sanitizeImageFolder(folderRaw);
  if (!folder) {
    return {
      ok: false,
      error: {
        code: 'INVALID_FOLDER',
        message: `Invalid folder. Allowed: ${ALLOWED_IMAGE_FOLDERS.join(', ')}.`,
      },
    };
  }

  if (!nameRaw || !nameRaw.trim()) {
    return {
      ok: false,
      error: {
        code: 'MISSING_NAME',
        message: 'name is required (used in the object filename).',
      },
    };
  }

  const name = sanitizeImageNameSegment(nameRaw);
  if (!name) {
    return {
      ok: false,
      error: {
        code: 'INVALID_NAME',
        message:
          'name must contain at least one letter or number after sanitization.',
      },
    };
  }

  // Default purpose from folder when omitted: e.g. folder=category → purpose=category
  const purposeSource = purposeRaw?.trim() || folder;
  const purpose = sanitizeImagePurpose(purposeSource);
  if (!purpose) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PURPOSE',
        message:
          'purpose must be a lowercase slug (e.g. "category", "category-fashion", "product-main").',
      },
    };
  }

  return { ok: true, data: { folder, name, purpose } };
}

/** Detect content-type; only image/webp is accepted by the API. */
export function isAllowedUploadContentType(value: string | null | undefined): boolean {
  if (!value) return false;
  const base = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'image/webp';
}
