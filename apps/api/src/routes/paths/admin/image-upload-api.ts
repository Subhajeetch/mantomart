/**
 * Admin image upload API — Cloudflare R2 binding, WebP-only.
 *
 * POST /api/admin/images/upload
 *   Content-Type: multipart/form-data
 *   Fields:
 *     file     — required, image/webp binary (client crops + converts)
 *     folder   — required, allow-listed folder (category | product | …)
 *     name     — required, free-form label used in the object key
 *     purpose  — optional, defaults to folder (e.g. category-fashion)
 *
 * Security:
 *   - requireAdminMiddleware (session cookie → admin/owner only)
 *   - Magic-byte WebP validation, size cap, folder allow-list, path-safe keys
 *   - Actor id/name/email taken from auth context (already loaded once)
 *
 * Response 201:
 *   { success, data: { url, key, filename, folder, purpose, size, epoch } }
 *
 * Storage:
 *   - Always uses the R2_IMAGES Worker binding
 *   - Local `wrangler dev` → .wrangler/state/v3/r2 (Miniflare)
 *   - Production deploy → real R2 bucket
 *   - Public URL defaults to `{API_URL}/api/images/{key}` (Worker-served)
 *   - Optional R2_PUBLIC_URL overrides to a CDN / custom domain
 */

import { Hono } from 'hono';
import {
  errorJson,
  type AppEnv,
  type AppContext,
} from '@/utils/errorJson';
import {
  requireAdminMiddleware,
  getActor,
} from '@/middleware/permission';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_TARGET_TYPES,
  logAuditFromContext,
} from '@/utils/auditLog';
import {
  MAX_UPLOAD_BYTES,
  ALLOWED_IMAGE_FOLDERS,
  buildImageObjectKey,
  isWebPBuffer,
  isAllowedUploadContentType,
  parseUploadMeta,
} from '@/utils/imageUpload';
import {
  isR2Configured,
  uploadToR2,
  buildPublicObjectUrl,
  hasR2Binding,
  getR2PublicBaseUrl,
} from '@/utils/r2';

// ─── Router ───────────────────────────────────────────────────────────────────

const imageUploadRouter = new Hono<AppEnv>();

imageUploadRouter.use('*', requireAdminMiddleware);

function requestOrigin(c: AppContext): string {
  try {
    return new URL(c.req.url).origin;
  } catch {
    return '';
  }
}

// ─── GET /meta — client can discover limits / folders without uploading ───────
imageUploadRouter.get('/meta', (c) => {
  const origin = requestOrigin(c);
  return c.json({
    success: true,
    data: {
      maxBytes: MAX_UPLOAD_BYTES,
      allowedFolders: ALLOWED_IMAGE_FOLDERS,
      requiredFormat: 'image/webp',
      filenamePattern: '{name}_{purpose}_{unixEpoch}.webp',
      keyPattern: '{folder}/{filename}',
      r2Configured: isR2Configured(c.env),
      hasBinding: hasR2Binding(c.env),
      publicBaseUrl: getR2PublicBaseUrl(c.env, { origin }),
      publicUrlConfigured: Boolean(buildPublicObjectUrl(c.env, 'probe', { origin })),
      /**
       * Always "binding".
       * Local wrangler → Miniflare disk. Deployed → real R2.
       */
      transport: hasR2Binding(c.env) ? 'binding' : 'none',
    },
  });
});

// ─── POST /upload ─────────────────────────────────────────────────────────────
imageUploadRouter.post('/upload', async (c) => {
  const actor = getActor(c);
  const origin = requestOrigin(c);

  if (!isR2Configured(c.env)) {
    return errorJson(
      c,
      503,
      'R2_NOT_CONFIGURED',
      'Object storage is not configured. Bind R2_IMAGES in wrangler.jsonc.'
    );
  }

  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return errorJson(
      c,
      400,
      'INVALID_CONTENT_TYPE',
      'Upload must be multipart/form-data with a WebP file field named "file".'
    );
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch (error) {
    console.error('Failed to parse multipart body:', error);
    return errorJson(
      c,
      400,
      'INVALID_MULTIPART',
      'Could not parse multipart form data.'
    );
  }

  const fileEntry = form.get('file');
  if (!fileEntry || !(fileEntry instanceof File)) {
    return errorJson(
      c,
      400,
      'MISSING_FILE',
      'A file field named "file" is required.'
    );
  }

  const file = fileEntry;

  if (file.size <= 0) {
    return errorJson(c, 400, 'EMPTY_FILE', 'Uploaded file is empty.');
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return errorJson(
      c,
      400,
      'FILE_TOO_LARGE',
      `File exceeds the maximum size of ${Math.floor(MAX_UPLOAD_BYTES / 1024)} KiB.`
    );
  }

  // Content-Type from the client is advisory — we still magic-byte check.
  if (file.type && !isAllowedUploadContentType(file.type)) {
    return errorJson(
      c,
      400,
      'INVALID_FILE_TYPE',
      'Only image/webp uploads are accepted. Convert on the client before uploading.'
    );
  }

  const meta = parseUploadMeta({
    folder: form.get('folder'),
    name: form.get('name'),
    purpose: form.get('purpose'),
    about: form.get('about'),
  });
  if (!meta.ok) {
    return errorJson(c, 400, meta.error.code, meta.error.message);
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    console.error('Failed to read upload body:', error);
    return errorJson(
      c,
      400,
      'FILE_READ_FAILED',
      'Could not read the uploaded file.'
    );
  }

  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return errorJson(
      c,
      400,
      'FILE_TOO_LARGE',
      `File exceeds the maximum size of ${Math.floor(MAX_UPLOAD_BYTES / 1024)} KiB.`
    );
  }

  if (!isWebPBuffer(bytes)) {
    return errorJson(
      c,
      400,
      'NOT_WEBP',
      'File is not a valid WebP image. Convert and re-export as .webp before uploading.'
    );
  }

  const { key, filename, epoch } = buildImageObjectKey({
    folder: meta.data.folder,
    name: meta.data.name,
    purpose: meta.data.purpose,
  });

  const uploaded = await uploadToR2(
    c.env,
    {
      key,
      body: bytes,
      contentType: 'image/webp',
      customMetadata: {
        // Actor comes from auth middleware — no extra DB lookup.
        uploadedBy: actor.id,
        folder: meta.data.folder,
        purpose: meta.data.purpose,
        name: meta.data.name,
      },
    },
    { origin }
  );

  if (!uploaded.ok) {
    const status =
      uploaded.error.code === 'R2_NOT_CONFIGURED' ? 503 : 500;

    return errorJson(
      c,
      status,
      uploaded.error.code,
      uploaded.error.message
    );
  }

  const publicUrl = uploaded.result.publicUrl;
  if (!publicUrl) {
    console.warn(
      'Image uploaded but public URL base is unset (set API_URL or R2_PUBLIC_URL).'
    );
  }

  c.executionCtx.waitUntil(
    logAuditFromContext(c, {
      action: AUDIT_ACTIONS.SYSTEM,
      category: AUDIT_CATEGORIES.SYSTEM,
      description: `Uploaded image ${filename} to ${meta.data.folder}/`,
      targetType: AUDIT_TARGET_TYPES.SYSTEM,
      targetId: key,
      targetLabel: filename,
      severity: 'info',
      metadata: {
        kind: 'image_upload',
        key,
        folder: meta.data.folder,
        purpose: meta.data.purpose,
        name: meta.data.name,
        size: bytes.byteLength,
        via: uploaded.result.via,
        actorId: actor.id,
      },
    }).then(() => undefined)
  );

  return c.json(
    {
      success: true,
      message: 'Image uploaded.',
      data: {
        url: publicUrl,
        key: uploaded.result.key,
        filename,
        folder: meta.data.folder,
        purpose: meta.data.purpose,
        name: meta.data.name,
        size: bytes.byteLength,
        contentType: 'image/webp',
        epoch,
        etag: uploaded.result.etag ?? null,
        via: uploaded.result.via,
      },
    },
    201
  );
});

// ─── Fallbacks ────────────────────────────────────────────────────────────────

imageUploadRouter.all('/upload', (c) =>
  errorJson(
    c,
    405,
    'METHOD_NOT_ALLOWED',
    'Use POST multipart/form-data to upload images.'
  )
);

imageUploadRouter.notFound((c: AppContext) =>
  errorJson(c, 404, 'NOT_FOUND', 'Image upload API route not found.')
);

export default imageUploadRouter;
