import type { ImageCropUploadResult, ImageUploadFolder } from './types';

export class ImageUploadError extends Error {
  code?: string;
  status: number;

  constructor(
    message: string,
    options: { code?: string; status?: number } = {}
  ) {
    super(message);
    this.name = 'ImageUploadError';
    this.code = options.code;
    this.status = options.status ?? 500;
  }
}

function getImagesApiBase(): string {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  return origin ? `${origin}/api/admin/images` : '/api/admin/images';
}

type UploadSuccessBody = {
  success: true;
  message?: string;
  data: {
    url: string | null;
    key: string;
    filename: string;
    folder: string;
    purpose: string;
    name: string;
    size: number;
    contentType: string;
    epoch: number;
    etag?: string | null;
  };
};

type UploadErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

/**
 * Upload a cropped WebP blob to the admin image API.
 * Auth is cookie-based (`credentials: 'include'`).
 */
export async function uploadImageBlob(options: {
  blob: Blob;
  folder: ImageUploadFolder;
  name: string;
  purpose?: string;
  /** Optional local preview URL already created by the caller. */
  previewUrl?: string;
}): Promise<ImageCropUploadResult> {
  const form = new FormData();
  const filename = `${options.name || 'image'}.webp`;
  form.append('file', options.blob, filename);
  form.append('folder', options.folder);
  form.append('name', options.name);
  if (options.purpose) {
    form.append('purpose', options.purpose);
  }

  const url = `${getImagesApiBase()}/upload`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: form,
      credentials: 'include',
      // Do NOT set Content-Type — browser sets multipart boundary.
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new ImageUploadError(
      'Unable to reach the server. Please try again.',
      { status: 0, code: 'NETWORK_ERROR' }
    );
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new ImageUploadError(
      response.ok
        ? 'Server returned an invalid response.'
        : `Upload failed with status ${response.status}.`,
      { status: response.status }
    );
  }

  if (!response.ok) {
    const err = data as UploadErrorBody;
    throw new ImageUploadError(
      err.error || err.message || `Upload failed with status ${response.status}.`,
      { code: err.code, status: response.status }
    );
  }

  const body = data as UploadSuccessBody;
  if (!body.success || !body.data) {
    const err = data as UploadErrorBody;
    throw new ImageUploadError(
      err.error || err.message || 'Upload failed.',
      { code: err.code, status: response.status }
    );
  }

  const previewUrl =
    options.previewUrl ?? URL.createObjectURL(options.blob);

  return {
    url: body.data.url,
    key: body.data.key,
    filename: body.data.filename,
    folder: body.data.folder,
    purpose: body.data.purpose,
    size: body.data.size,
    previewUrl,
    blob: options.blob,
  };
}
