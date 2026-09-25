import { Hono } from 'hono';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  requireAdminMiddleware,
  requireAnyPermission,
} from '@/middleware/permission';
import {
  AiApiError,
  AiConfigError,
  generateProductSeoCopyStream,
  getDefaultModel,
  isAllowedModel,
  type SeoGenerateInput,
} from '@/utils/callModels';
import {
  AI_PROVIDERS,
  type AiProviderId,
} from '@/data-raw/ai-models-config';
import { errorJson, type AppEnv, type ErrorStatus } from '@/utils/errorJson';

const aiEndpoints = new Hono<AppEnv>();

// ─── Error mapping ────────────────────────────────────────────────────────────

type MappedError = {
  status: ErrorStatus;
  code: string;
  message: string;
};

function toErrorStatus(status: number): ErrorStatus {
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 409 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503
  ) {
    return status;
  }
  return 502;
}

function mapUpstreamError(error: unknown): MappedError {
  if (error instanceof AiConfigError) {
    const providerCode =
      error.message.match(/^([A-Z]+)_API_KEY is missing/)?.[1] || 'GEMINI';
    return {
      status: 503,
      code: `${providerCode}_CONFIG_MISSING`,
      message:
        error.message ||
        'The selected AI provider is not configured.',
    };
  }

  if (error instanceof AiApiError) {
    return {
      status: toErrorStatus(error.status),
      code: error.code,
      message: error.publicMessage || error.message,
    };
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      lower.includes('network') ||
      lower.includes('fetch failed') ||
      lower.includes('timeout')
    ) {
      return {
        status: 503,
        code: 'GEMINI_UNAVAILABLE',
        message: 'Google AI Studio is temporarily unavailable. Try again later.',
      };
    }

    return {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: error.message || 'An unexpected error occurred.',
    };
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  };
}

// ─── Body parsing ─────────────────────────────────────────────────────────────

const MAX_KEYWORD = 200;
const MAX_SECONDARY = 500;
const MAX_TITLE = 400;
const MAX_DESCRIPTION = 8000;
const MAX_MOBILE = 8000;
const MAX_NOTES = 800;
const MAX_TAGS = 25;

function asTrimmedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

function asStringArray(value: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const t = item.trim().slice(0, 60);
    if (!t) continue;
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out.length > 0 ? out : undefined;
}

function parseGenerateBody(body: unknown): {
  ok: true;
  input: SeoGenerateInput;
} | {
  ok: false;
  code: string;
  message: string;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      code: 'INVALID_BODY',
      message: 'Request body must be a JSON object.',
    };
  }

  const raw = body as Record<string, unknown>;

  const keyword =
    asTrimmedString(raw.keyword, MAX_KEYWORD) ||
    asTrimmedString(raw.focusKeyword, MAX_KEYWORD) ||
    asTrimmedString(raw.q, MAX_KEYWORD);

  if (!keyword) {
    return {
      ok: false,
      code: 'MISSING_KEYWORD',
      message: 'Provide a focus keyword (field: keyword).',
    };
  }

  const modelRaw = asTrimmedString(raw.model, 80);
  if (modelRaw && !isAllowedModel(modelRaw)) {
    return {
      ok: false,
      code: 'AI_MODEL_NOT_ALLOWED',
      message: `Model "${modelRaw}" is not supported. Use GET /api/ai/models for the allowlist.`,
    };
  }

  const product =
    raw.product && typeof raw.product === 'object' && !Array.isArray(raw.product)
      ? (raw.product as Record<string, unknown>)
      : null;

  const input: SeoGenerateInput = {
    keyword,
    secondaryKeywords: asTrimmedString(
      raw.secondaryKeywords ?? raw.keywords,
      MAX_SECONDARY
    ),
    model: modelRaw || getDefaultModel(),
    productTitle: asTrimmedString(
      raw.productTitle ?? raw.title ?? product?.title ?? product?.name,
      MAX_TITLE
    ),
    productDescription: asTrimmedString(
      raw.productDescription ?? raw.description ?? product?.description,
      MAX_DESCRIPTION
    ),
    mobileDetailMarkdown: asTrimmedString(
      raw.mobileDetailMarkdown ??
        raw.mobileDescription ??
        product?.mobileDetailMarkdown,
      MAX_MOBILE
    ),
    existingTags: asStringArray(
      raw.existingTags ?? raw.tags ?? product?.tags,
      MAX_TAGS
    ),
    notes: asTrimmedString(raw.notes, MAX_NOTES),
  };

  return { ok: true, input };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

aiEndpoints.use('*', requireAdminMiddleware);

const seoPermissions = requireAnyPermission(
  PERMISSIONS.AI_SEO_GENERATE,
  PERMISSIONS.PRODUCT_CREATE,
  PERMISSIONS.PRODUCT_UPDATE
);

/**
 * List allowlisted AI models for the AI SEO generator.
 * GET /api/ai/models
 */
aiEndpoints.get('/models', seoPermissions, (c) => {
  const keyNames: Record<AiProviderId, keyof typeof c.env> = {
    gemini: 'GOOGLE_AI_STUDIO_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    groq: 'GROQ_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    nvidia: 'NVIDIA_BUILD_API_KEY',
  };
  const providers = AI_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    shortLabel: provider.shortLabel,
    configured: Boolean(String(c.env[keyNames[provider.id]] ?? '').trim()),
    models: provider.models.map((model) => ({
      ...model,
      providerId: provider.id,
    })),
  }));

  return c.json({
    success: true,
    data: {
      configured: providers.some((provider) => provider.configured),
      defaultModel: getDefaultModel(),
      providers,
      models: providers.flatMap((provider) => provider.models),
    },
  });
});

/**
 * Stream SEO product copy (title, descriptions, meta, tags) via the selected AI provider.
 * POST /api/ai/seo/generate
 *
 * Validation / auth errors are JSON. A successful start is text/event-stream:
 *   event: start  { model }
 *   event: field  { field, delta, done }
 *   event: done   { title, description, mobileDetailMarkdown, metaTitle, metaDescription, tags, model }
 *   event: error  { code, message }
 *
 * Body:
 * {
 *   keyword: string;                 // required focus keyword(s)
 *   model?: string;                  // model id from GET /api/ai/models
 *   secondaryKeywords?: string;
 *   productTitle?: string;
 *   productDescription?: string;
 *   mobileDetailMarkdown?: string;
 *   existingTags?: string[];
 *   notes?: string;
 *   // or nested: product: { title, description, mobileDetailMarkdown, tags }
 * }
 */
aiEndpoints.post('/seo/generate', seoPermissions, async (c) => {
  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    return errorJson(c, 400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const parsed = parseGenerateBody(body);
  if (!parsed.ok) {
    return errorJson(c, 400, parsed.code, parsed.message);
  }

  const encoder = new TextEncoder();
  const clientSignal = c.req.raw.signal;
  const ac = new AbortController();
  const abort = () => {
    if (!ac.signal.aborted) ac.abort();
  };

  if (clientSignal.aborted) {
    abort();
  } else {
    clientSignal.addEventListener('abort', abort, { once: true });
  }

  const encodeSse = (event: string, data: unknown): Uint8Array =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Native ReadableStream (not Hono streamSSE): Hono sets Transfer-Encoding:
  // chunked, which Cloudflare / wrangler often buffer until the stream ends.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: string, data: unknown) => {
        if (ac.signal.aborted) return;
        try {
          controller.enqueue(encodeSse(event, data));
        } catch {
          abort();
        }
      };

      try {
        // Comment frame so the client gets headers + first bytes immediately.
        controller.enqueue(encoder.encode(': connected\n\n'));
      } catch {
        abort();
        return;
      }

      try {
        for await (const event of generateProductSeoCopyStream(
          c.env,
          parsed.input,
          ac.signal
        )) {
          if (ac.signal.aborted) break;

          if (event.type === 'start') {
            write('start', { model: event.model });
          } else if (event.type === 'field') {
            write('field', {
              field: event.field,
              delta: event.delta,
              done: event.done,
            });
          } else if (event.type === 'done') {
            write('done', event.data);
          } else if (event.type === 'error') {
            write('error', {
              code: event.code,
              message: event.message,
            });
          }
        }
      } catch (error) {
        if (!ac.signal.aborted) {
          console.error('AI SEO stream error:', error);
          const mapped = mapUpstreamError(error);
          write('error', {
            code: mapped.code,
            message: mapped.message,
          });
        }
      } finally {
        clientSignal.removeEventListener('abort', abort);
        try {
          controller.close();
        } catch {
          // already closed / cancelled
        }
      }
    },
    cancel() {
      abort();
    },
  });

  return c.newResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export default aiEndpoints;
