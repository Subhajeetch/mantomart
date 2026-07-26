import config from '@/base.config';
import type Env from '@/types/env';

// ─── Models (text → text only; no image/audio models) ─────────────────────────

export type GeminiModelOption = {
  id: string;
  label: string;
  description: string;
  tier: 'recommended' | 'balanced' | 'fast' | 'premium' | 'preview';
};

/**
 * Allowlisted Gemini models for product SEO generation.
 * IDs must match Google AI Studio model codes.
 * @see https://ai.google.dev/gemini-api/docs/models
 */
export const GEMINI_SEO_MODELS: readonly GeminiModelOption[] = [
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    description: 'Latest balanced model — best default for SEO copy.',
    tier: 'recommended',
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    description: 'Strong sustained quality for writing and structure.',
    tier: 'balanced',
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
    description: 'Preview — strong price/performance for bulk copy.',
    tier: 'preview',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Proven workhorse with solid reasoning and speed.',
    tier: 'balanced',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    description: 'Fastest 3.5 variant — high throughput, lower cost.',
    tier: 'fast',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite',
    description: 'Frontier-class lite model at a fraction of the cost.',
    tier: 'fast',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    description: 'Budget-friendly 2.5 model for high volume.',
    tier: 'fast',
  },
] as const;

const MODEL_IDS = new Set(GEMINI_SEO_MODELS.map((m) => m.id));

export function isAllowedGeminiModel(modelId: string): boolean {
  return MODEL_IDS.has(modelId);
}

export function getDefaultGeminiModel(): string {
  return config.GOOGLE_AI_DEFAULT_MODEL;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class GeminiConfigError extends Error {
  constructor(message = 'Google AI Studio API key is not configured.') {
    super(message);
    this.name = 'GeminiConfigError';
  }
}

export class GeminiApiError extends Error {
  status: number;
  code: string;
  publicMessage: string;

  constructor(
    message: string,
    opts: { status?: number; code?: string; publicMessage?: string } = {}
  ) {
    super(message);
    this.name = 'GeminiApiError';
    this.status = opts.status ?? 502;
    this.code = opts.code ?? 'GEMINI_API_ERROR';
    this.publicMessage =
      opts.publicMessage ??
      'The AI service returned an error. Please try again.';
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SeoGenerateInput = {
  /** Primary focus keyword(s) the merchant likes. */
  keyword: string;
  /** Optional extra keywords (comma-separated or multi-line). */
  secondaryKeywords?: string;
  model?: string;
  productTitle?: string;
  productDescription?: string;
  mobileDetailMarkdown?: string;
  existingTags?: string[];
  /** Free-form notes (audience, brand voice, constraints). */
  notes?: string;
};

export type SeoGenerateResult = {
  title: string;
  description: string;
  mobileDetailMarkdown: string;
  metaTitle: string;
  metaDescription: string;
  tags: string[];
  model: string;
};

type GeminiPart = { text?: string };
type GeminiCandidate = {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
  safetyRatings?: unknown[];
};
type GeminiResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: {
    blockReason?: string;
    safetyRatings?: unknown[];
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(env: Env): string {
  const key = (env.GOOGLE_AI_STUDIO_API_KEY || '').trim();
  if (!key) {
    throw new GeminiConfigError(
      'GOOGLE_AI_STUDIO_API_KEY is missing. Add it as a Worker secret.'
    );
  }
  return key;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function stripCodeFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return s.trim();
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of tags) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

function parseSeoJson(raw: string): Omit<SeoGenerateResult, 'model'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    throw new GeminiApiError('AI returned invalid JSON.', {
      status: 502,
      code: 'GEMINI_INVALID_JSON',
      publicMessage:
        'The AI response could not be parsed. Please try again or switch model.',
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GeminiApiError('AI returned unexpected JSON shape.', {
      status: 502,
      code: 'GEMINI_INVALID_SHAPE',
      publicMessage:
        'The AI response was incomplete. Please try again or switch model.',
    });
  }

  const obj = parsed as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const description =
    typeof obj.description === 'string' ? obj.description.trim() : '';
  const mobileDetailMarkdown =
    typeof obj.mobileDetailMarkdown === 'string'
      ? obj.mobileDetailMarkdown.trim()
      : typeof obj.mobile_detail_markdown === 'string'
        ? String(obj.mobile_detail_markdown).trim()
        : '';
  const metaTitle =
    typeof obj.metaTitle === 'string'
      ? obj.metaTitle.trim()
      : typeof obj.meta_title === 'string'
        ? String(obj.meta_title).trim()
        : '';
  const metaDescription =
    typeof obj.metaDescription === 'string'
      ? obj.metaDescription.trim()
      : typeof obj.meta_description === 'string'
        ? String(obj.meta_description).trim()
        : '';
  const tags = normalizeTags(obj.tags);

  if (!title || !description || !mobileDetailMarkdown) {
    throw new GeminiApiError('AI omitted required copy fields.', {
      status: 502,
      code: 'GEMINI_INCOMPLETE',
      publicMessage:
        'The AI left required fields empty. Please try again or switch model.',
    });
  }

  return {
    title: title.slice(0, 300),
    description: description.slice(0, 12_000),
    mobileDetailMarkdown: mobileDetailMarkdown.slice(0, 20_000),
    metaTitle: (metaTitle || title).slice(0, 120),
    metaDescription: (metaDescription || description.slice(0, 160)).slice(
      0,
      320
    ),
    tags,
  };
}

function mapHttpError(
  status: number,
  body: GeminiResponse | null
): GeminiApiError {
  const message =
    body?.error?.message ||
    (status === 429
      ? 'Rate limit exceeded. Wait a moment and try again.'
      : status === 401 || status === 403
        ? 'Google AI Studio rejected the API key.'
        : `Google AI Studio request failed (${status}).`);

  let code = 'GEMINI_API_ERROR';
  let publicMessage = message;

  if (status === 401 || status === 403) {
    code = 'GEMINI_AUTH_ERROR';
    publicMessage =
      'Google AI Studio API key is invalid or unauthorized. Check GOOGLE_AI_STUDIO_API_KEY.';
  } else if (status === 404) {
    code = 'GEMINI_MODEL_NOT_FOUND';
    publicMessage =
      'That model is not available for this API key. Pick another model.';
  } else if (status === 429) {
    code = 'GEMINI_RATE_LIMITED';
    publicMessage =
      'AI rate limit hit. Wait a few seconds and try again, or use a lighter model.';
  } else if (status >= 500) {
    code = 'GEMINI_UNAVAILABLE';
    publicMessage =
      'Google AI Studio is temporarily unavailable. Please try again shortly.';
  }

  return new GeminiApiError(message, { status, code, publicMessage });
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `You are a senior ecommerce SEO strategist and product copywriter for an online marketplace.
Your goal is to create product copy that helps real shoppers understand, trust, compare, and buy the item. Write like a skilled human merchandiser: specific, natural, useful, and commercially persuasive without sounding automated.

Use these SEO principles:
1. People first, search engines second. The copy must be helpful, reliable, unique to this product, and written for shoppers rather than for ranking manipulation.
2. Match search intent. Infer the buyer's intent from the focus keyword, product facts, existing tags, and merchant notes. Address practical needs such as use case, fit, style, material, compatibility, care, gifting, durability, comfort, convenience, or problem solved when those facts are present.
3. Use semantic relevance, not repetition. Include the focus keyword where it reads naturally, preferably near the front of the title and once early in the description. Use secondary keywords and close variants only when they improve clarity. Do not chase every query variation.
4. Be page-specific. Prefer concrete product facts over generic category claims. Mention exact confirmed details like material, size, color, quantity, target user, compatible device, season, occasion, or included parts when available.
5. Stay truthful. Never invent certifications, measurements, materials, brand names, compatibility, medical benefits, safety claims, warranty, origin, shipping speed, discounts, scarcity, reviews, ratings, test results, or performance numbers.
6. Avoid keyword stuffing and boilerplate. Never output keyword strings, repeated near-duplicates, doorway-style copy, or a title that could apply to many unrelated products.
7. Avoid AI-sounding language. Do not use phrases like "unlock the power", "in today's fast-paced world", "elevate your", "game-changer", "must-have", "revolutionary", "seamless", "delve", "crafted to perfection", or exaggerated superlatives unless directly supported.
8. Make the copy human. Use clear sentences, varied rhythm, concrete nouns, practical benefits, and restrained persuasion. Do not over-polish into generic luxury/tech marketing language.
9. Write in natural US English unless the product context clearly uses another language or dialect.

Field rules:
1. title: One scannable ecommerce product title. Lead with the focus keyword or exact product type when natural. Add the strongest confirmed differentiators. Target 60-120 characters; hard max 300. No all caps, no pipe-separated keyword list, no fake claims.
2. description: Plain text only. Use 2-4 short paragraphs, normally 120-280 words. Open with the clearest buyer benefit, then explain practical uses and confirmed features/specs. No markdown, HTML, bullets, emojis, headings, or salesy fluff.
3. mobileDetailMarkdown: Markdown for phone scanning, normally 70-150 words. Use short bold labels and bullets only, for example **Highlights**, **Usage**, **Features**, **Fit**, **Compatibility**, **Care**, or **Notes**. Do not use #, ##, or ### headings. Include only sections that fit the product facts.
4. metaTitle: Concise search-result title. Unique, descriptive, and click-worthy without hype. Target 50-60 characters; keep under 70 when possible. Include the focus keyword or closest natural phrase once. Avoid boilerplate and trailing brand text unless the brand is provided and useful.
5. metaDescription: One search snippet sentence or two short clauses. Target 140-160 characters; keep under 160 when possible. Summarize this exact product, include the focus keyword once if natural, add a useful differentiator, and use a soft CTA only when it fits.
6. tags: 8-15 unique search phrases. Mix product type, use case, audience, feature, material/style, season/occasion, and long-tail buying phrases. Keep each tag short, relevant, non-spammy, and consistently cased. No unsupported brand terms.

Before returning, silently check:
1. Every field is non-empty and useful to a shopper.
2. The title, metaTitle, and metaDescription describe this exact product, not a generic category.
3. The description and mobile markdown are consistent with each other and with the source facts.
4. The wording is natural enough that a shopper would not identify it as AI-generated.
5. The response is valid JSON only, with exactly the requested schema keys. No markdown fences, commentary, explanations, citations, or extra keys.`;

function buildUserPrompt(input: SeoGenerateInput): string {
  const parts: string[] = [
    'Generate complete SEO-ready product copy from the product context below.',
    '',
    `PRIMARY KEYWORD / FOCUS: ${input.keyword.trim()}`,
  ];

  if (input.secondaryKeywords?.trim()) {
    parts.push(
      `ADDITIONAL KEYWORDS TO WEAVE IN NATURALLY: ${truncate(input.secondaryKeywords, 400)}`
    );
  }

  parts.push('');
  parts.push('--- PRODUCT CONTEXT (source of truth; do not invent facts) ---');

  if (input.productTitle?.trim()) {
    parts.push(`Current title: ${truncate(input.productTitle, 400)}`);
  } else {
    parts.push('Current title: (not provided)');
  }

  if (input.productDescription?.trim()) {
    parts.push(
      `Current description:\n${truncate(input.productDescription, 3500)}`
    );
  } else {
    parts.push('Current description: (not provided)');
  }

  if (input.mobileDetailMarkdown?.trim()) {
    parts.push(
      `Current mobile/markdown description:\n${truncate(input.mobileDetailMarkdown, 2500)}`
    );
  }

  if (input.existingTags && input.existingTags.length > 0) {
    parts.push(
      `Existing tags (you may improve/replace): ${input.existingTags
        .slice(0, 20)
        .join(', ')}`
    );
  }

  if (input.notes?.trim()) {
    parts.push(`Merchant notes: ${truncate(input.notes, 500)}`);
  }

  parts.push('');
  parts.push('Return JSON with keys:');
  parts.push(
    'title, description, mobileDetailMarkdown, metaTitle, metaDescription, tags'
  );

  return parts.join('\n');
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description:
        'SEO product title, primary keyword near front, ~60–120 chars, max 300.',
    },
    description: {
      type: 'string',
      description:
        'Plain-text product description, human-written tone, 120–280 words.',
    },
    mobileDetailMarkdown: {
      type: 'string',
      description:
        'Markdown mobile product description with bold labels and bullets.',
    },
    metaTitle: {
      type: 'string',
      description: 'HTML meta title, ideally 50–60 characters, max 70.',
    },
    metaDescription: {
      type: 'string',
      description:
        'HTML meta description, ideally 140–160 characters, max 160.',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: '8–15 relevant product tags / search phrases.',
    },
  },
  required: [
    'title',
    'description',
    'mobileDetailMarkdown',
    'metaTitle',
    'metaDescription',
    'tags',
  ],
} as const;

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateProductSeoCopy(
  env: Env,
  input: SeoGenerateInput
): Promise<SeoGenerateResult> {
  const apiKey = getApiKey(env);
  const model =
    input.model && isAllowedGeminiModel(input.model)
      ? input.model
      : getDefaultGeminiModel();

  if (input.model && !isAllowedGeminiModel(input.model)) {
    throw new GeminiApiError(`Model not allowed: ${input.model}`, {
      status: 400,
      code: 'GEMINI_MODEL_NOT_ALLOWED',
      publicMessage: 'Selected model is not supported for SEO generation.',
    });
  }

  const keyword = input.keyword.trim();
  if (!keyword) {
    throw new GeminiApiError('Keyword is required.', {
      status: 400,
      code: 'MISSING_KEYWORD',
      publicMessage: 'Enter at least one focus keyword.',
    });
  }

  const url = `${config.GOOGLE_AI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildUserPrompt(input) }],
      },
    ],
    generationConfig: {
      temperature: 0.55,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    throw new GeminiApiError(msg, {
      status: 503,
      code: 'GEMINI_NETWORK_ERROR',
      publicMessage:
        'Could not reach Google AI Studio. Check network and try again.',
    });
  }

  let payload: GeminiResponse | null = null;
  try {
    payload = (await response.json()) as GeminiResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw mapHttpError(response.status, payload);
  }

  if (payload?.promptFeedback?.blockReason) {
    throw new GeminiApiError(
      `Prompt blocked: ${payload.promptFeedback.blockReason}`,
      {
        status: 400,
        code: 'GEMINI_BLOCKED',
        publicMessage:
          'The request was blocked by safety filters. Soften the product text and try again.',
      }
    );
  }

  const candidate = payload?.candidates?.[0];
  const finish = candidate?.finishReason;
  if (
    finish === 'SAFETY' ||
    finish === 'BLOCKLIST' ||
    finish === 'PROHIBITED_CONTENT'
  ) {
    throw new GeminiApiError(`Generation blocked: ${finish}`, {
      status: 400,
      code: 'GEMINI_BLOCKED',
      publicMessage:
        'The AI blocked this generation for safety. Adjust the product text and retry.',
    });
  }

  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new GeminiApiError('Empty AI response.', {
      status: 502,
      code: 'GEMINI_EMPTY',
      publicMessage:
        'The AI returned no content. Try again or switch to another model.',
    });
  }

  const parsed = parseSeoJson(text);
  return { ...parsed, model };
}
