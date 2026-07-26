import { Hono } from 'hono';
import { PERMISSIONS } from '@repo/auth/permissions';
import {
  requireAdminMiddleware,
  requireAnyPermission,
} from '@/middleware/permission';
import {
  GEMINI_SEO_MODELS,
  GeminiApiError,
  GeminiConfigError,
  generateProductSeoCopy,
  getDefaultGeminiModel,
  isAllowedGeminiModel,
  type SeoGenerateInput,
} from '@/utils/callGemini';
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
  if (error instanceof GeminiConfigError) {
    return {
      status: 503,
      code: 'GEMINI_CONFIG_MISSING',
      message:
        error.message ||
        'Google AI Studio is not configured. Set GOOGLE_AI_STUDIO_API_KEY.',
    };
  }

  if (error instanceof GeminiApiError) {
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
  if (modelRaw && !isAllowedGeminiModel(modelRaw)) {
    return {
      ok: false,
      code: 'GEMINI_MODEL_NOT_ALLOWED',
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
    model: modelRaw || getDefaultGeminiModel(),
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
 * List allowlisted Gemini models for the AI SEO generator.
 * GET /api/ai/models
 */
aiEndpoints.get('/models', seoPermissions, (c) => {
  const configured = Boolean((c.env.GOOGLE_AI_STUDIO_API_KEY || '').trim());

  return c.json({
    success: true,
    data: {
      configured,
      defaultModel: getDefaultGeminiModel(),
      models: GEMINI_SEO_MODELS.map((m) => ({
        id: m.id,
        label: m.label,
        description: m.description,
        tier: m.tier,
        recommended: m.tier === 'recommended',
      })),
    },
  });
});

/**
 * Generate SEO product copy (title, descriptions, meta, tags) via Gemini.
 * POST /api/ai/seo/generate
 *
 * Body:
 * {
 *   keyword: string;                 // required focus keyword(s)
 *   model?: string;                  // Gemini model id
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

  try {
    const result = await generateProductSeoCopy(c.env, parsed.input);
    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('AI SEO generate error:', error);
    const mapped = mapUpstreamError(error);
    return errorJson(c, mapped.status, mapped.code, mapped.message);
  }
});

export default aiEndpoints;
