import config from '@/base.config';
import type Env from '@/types/env';
import {
  AI_DEFAULT_MODEL,
  AI_PROVIDERS,
  getAiModelConfig,
  type AiProviderId,
} from '@/data-raw/ai-models-config';
import {
  parseSeoCopyText,
  SeoMarkerStreamParser,
  SeoParseError,
  SEO_STREAM_FIELD_ORDER,
  type SeoStreamFieldName,
} from '@/utils/seoMarkerStream';

export {
  SEO_STREAM_FIELD_ORDER,
  type SeoStreamFieldName,
} from '@/utils/seoMarkerStream';

export function isAllowedModel(modelId: string): boolean {
  return Boolean(getAiModelConfig(modelId));
}

export function getDefaultModel(): string {
  return AI_DEFAULT_MODEL || config.GOOGLE_AI_DEFAULT_MODEL;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class AiConfigError extends Error {
  constructor(message = 'The selected AI provider is not configured.') {
    super(message);
    this.name = 'AiConfigError';
  }
}

export class AiApiError extends Error {
  status: number;
  code: string;
  publicMessage: string;

  constructor(
    message: string,
    opts: { status?: number; code?: string; publicMessage?: string } = {}
  ) {
    super(message);
    this.name = 'AiApiError';
    this.status = opts.status ?? 502;
    this.code = opts.code ?? 'AI_API_ERROR';
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

export type SeoStreamEvent =
  | { type: 'start'; model: string }
  | {
      type: 'field';
      field: SeoStreamFieldName;
      delta: string;
      done: boolean;
    }
  | { type: 'done'; data: SeoGenerateResult }
  | { type: 'error'; code: string; message: string };

type GeminiPart = { text?: string; thought?: boolean };
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

type OpenAiResponse = {
  error?: { message?: string };
  message?: string;
  type?: string;
  code?: string | number;
  choices?: Array<{
    delta?: { content?: string | null };
    message?: { content?: string | null };
  }>;
};

const PROVIDER_ENV_KEYS: Record<Exclude<AiProviderId, 'gemini'>, keyof Env> = {
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  nvidia: 'NVIDIA_BUILD_API_KEY',
};

const PROVIDER_ENDPOINTS: Record<Exclude<AiProviderId, 'gemini'>, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
};

function providerForModel(modelId: string) {
  return getAiModelConfig(modelId);
}

function providerApiKey(
  env: Env,
  provider: Exclude<AiProviderId, 'gemini'>
): string {
  const key = env[PROVIDER_ENV_KEYS[provider]];
  if (typeof key !== 'string' || !key.trim()) {
    throw new AiConfigError(
      `${provider.toUpperCase()}_API_KEY is missing. Add it as a Worker secret.`
    );
  }
  return key.trim();
}

function openAiModelId(modelId: string): string {
  const separator = modelId.indexOf(':');
  return separator === -1 ? modelId : modelId.slice(separator + 1);
}

function mapProviderError(
  provider: Exclude<AiProviderId, 'gemini'>,
  status: number,
  body: OpenAiResponse | null
): AiApiError {
  const providerLabel =
    AI_PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
  const message =
    body?.error?.message ||
    body?.message ||
    `${providerLabel} request failed (${status}).`;
  let code = 'AI_API_ERROR';
  let publicMessage = message;
  if (status === 401 || status === 403) {
    code = `${provider.toUpperCase()}_AUTH_ERROR`;
    publicMessage = `${providerLabel} API key is invalid or unauthorized.`;
  } else if (status === 404) {
    code = `${provider.toUpperCase()}_MODEL_NOT_FOUND`;
    publicMessage = 'That model is not available. Pick another model.';
  } else if (status === 429) {
    code = `${provider.toUpperCase()}_RATE_LIMITED`;
    publicMessage = `${providerLabel} rate limit hit. Wait a moment or switch providers.`;
  } else if (status === 402) {
    code = `${provider.toUpperCase()}_PAYMENT_REQUIRED`;
    publicMessage = `${providerLabel} requires an active billing account or available credits.`;
  } else if (status >= 500) {
    code = `${provider.toUpperCase()}_UNAVAILABLE`;
    publicMessage = `${providerLabel} is temporarily unavailable. Try another provider.`;
  }
  return new AiApiError(message, { status, code, publicMessage });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getApiKey(env: Env): string {
  const key = (env.GOOGLE_AI_STUDIO_API_KEY || '').trim();
  if (!key) {
    throw new AiConfigError(
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

function throwGeminiParseError(err: unknown): never {
  if (err instanceof SeoParseError) {
    throw new AiApiError(err.message, {
      status: 502,
      code: err.code,
      publicMessage: err.publicMessage,
    });
  }
  throw err;
}

function mapHttpError(
  status: number,
  body: GeminiResponse | null
): AiApiError {
  const message =
    body?.error?.message ||
    (status === 429
      ? 'Rate limit exceeded. Wait a moment and try again.'
      : status === 401 || status === 403
        ? 'Google AI Studio rejected the API key.'
        : `Google AI Studio request failed (${status}).`);

  let code = 'AI_API_ERROR';
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

  return new AiApiError(message, { status, code, publicMessage });
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

OUTPUT FORMAT (mandatory, no exceptions):
- Reply with field markers and field content only.
- Do not output JSON, markdown fences, commentary, citations, or any text before the first marker or after <<<end>>>.
- Each marker must be alone on its own line, written exactly as shown, including the angle brackets.
- Never put <<< or >>> inside field content.
- Write the six fields in this exact order, then close with <<<end>>>.

<<<title>>>
product title text
<<<description>>>
plain description paragraphs
<<<mobileDetailMarkdown>>>
markdown mobile description
<<<metaTitle>>>
meta title text
<<<metaDescription>>>
meta description text
<<<tags>>>
- short tag one
- short tag two
<<<end>>>`;

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
  parts.push(
    'Emit the six fields using the exact <<<field>>> markers in this order: title, description, mobileDetailMarkdown, metaTitle, metaDescription, tags. Then <<<end>>>. No JSON. No extra text. Tags must be one hyphenated line each.'
  );

  return parts.join('\n');
}

function extractSseData(block: string): string | null {
  const lines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) {
      lines.push(line.slice(5).replace(/^\s/, ''));
    }
  }
  if (lines.length === 0) return null;
  return lines.join('\n');
}

async function* readSseDataLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      if (signal?.aborted) {
        try {
          await reader.cancel('aborted');
        } catch {
          // ignore
        }
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let sep = buf.indexOf('\n\n');
      while (sep !== -1) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const data = extractSseData(block);
        if (data && data !== '[DONE]') yield data;
        sep = buf.indexOf('\n\n');
      }
    }

    if (buf.trim()) {
      const data = extractSseData(buf.replace(/\r/g, ''));
      if (data && data !== '[DONE]') yield data;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released by cancel()
    }
  }
}

type GeminiThinkingConfig = {
  includeThoughts: false;
  thinkingBudget?: number;
  thinkingLevel?: 'minimal';
};

type GeminiRequest = {
  apiKey: string;
  model: string;
  body: {
    systemInstruction: { parts: { text: string }[] };
    contents: { role: string; parts: { text: string }[] }[];
    generationConfig: {
      temperature: number;
      topP: number;
      topK: number;
      maxOutputTokens: number;
      thinkingConfig: GeminiThinkingConfig;
    };
  };
};

/**
 * Gemini 2.5/3 think before they emit visible tokens. That delay is what
 * makes the SEO sheet sit idle, then dump the whole answer. Turn thinking
 * down so copy starts streaming immediately.
 */
function thinkingConfigFor(model: string): GeminiThinkingConfig {
  if (model.includes('gemini-2.5')) {
    return { includeThoughts: false, thinkingBudget: 0 };
  }
  return { includeThoughts: false, thinkingLevel: 'minimal' };
}

function buildSeoGenerationRequest(
  env: Env,
  input: SeoGenerateInput
): GeminiRequest {
  const apiKey = getApiKey(env);
  if (input.model && !isAllowedModel(input.model)) {
    throw new AiApiError(`Model not allowed: ${input.model}`, {
      status: 400,
      code: 'GEMINI_MODEL_NOT_ALLOWED',
      publicMessage: 'Selected model is not supported for SEO generation.',
    });
  }

  const model =
    input.model && isAllowedModel(input.model)
      ? input.model
      : getDefaultModel();

  if (!input.keyword.trim()) {
    throw new AiApiError('Keyword is required.', {
      status: 400,
      code: 'MISSING_KEYWORD',
      publicMessage: 'Enter at least one focus keyword.',
    });
  }

  return {
    apiKey,
    model,
    body: {
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
        thinkingConfig: thinkingConfigFor(model),
      },
    },
  };
}

function mapNetworkError(err: unknown): AiApiError {
  const msg = err instanceof Error ? err.message : 'Network error';
  return new AiApiError(msg, {
    status: 503,
    code: 'GEMINI_NETWORK_ERROR',
    publicMessage:
      'Could not reach Google AI Studio. Check network and try again.',
  });
}

function inspectGeminiPayload(payload: GeminiResponse): void {
  if (payload.promptFeedback?.blockReason) {
    throw new AiApiError(
      `Prompt blocked: ${payload.promptFeedback.blockReason}`,
      {
        status: 400,
        code: 'GEMINI_BLOCKED',
        publicMessage:
          'The request was blocked by safety filters. Soften the product text and try again.',
      }
    );
  }

  const finish = payload.candidates?.[0]?.finishReason;
  if (
    finish === 'SAFETY' ||
    finish === 'BLOCKLIST' ||
    finish === 'PROHIBITED_CONTENT'
  ) {
    throw new AiApiError(`Generation blocked: ${finish}`, {
      status: 400,
      code: 'GEMINI_BLOCKED',
      publicMessage:
        'The AI blocked this generation for safety. Adjust the product text and retry.',
    });
  }
}

function extractVisibleText(payload: GeminiResponse): string {
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text || '')
    .join('');
}

function finalizeSeoResult(
  accumulated: string,
  model: string
): SeoGenerateResult {
  try {
    return { ...parseSeoCopyText(accumulated), model };
  } catch (err) {
    throwGeminiParseError(err);
  }
}

function* emitParserEvents(
  events: { field: SeoStreamFieldName; delta: string; done: boolean }[]
): Generator<SeoStreamEvent> {
  for (const event of events) {
    yield {
      type: 'field',
      field: event.field,
      delta: event.delta,
      done: event.done,
    };
  }
}

function* emitFallbackFields(
  result: SeoGenerateResult,
  alreadyClosed: Set<SeoStreamFieldName>
): Generator<SeoStreamEvent> {
  for (const field of SEO_STREAM_FIELD_ORDER) {
    if (alreadyClosed.has(field)) continue;
    if (field === 'tags') {
      for (const tag of result.tags) {
        yield { type: 'field', field: 'tags', delta: tag, done: false };
      }
      yield { type: 'field', field: 'tags', delta: '', done: true };
      continue;
    }
    yield {
      type: 'field',
      field,
      delta: result[field],
      done: true,
    };
  }
}

async function* generateOpenAiCompatibleSeoCopyStream(
  env: Env,
  input: SeoGenerateInput,
  provider: Exclude<AiProviderId, 'gemini'>,
  model: string,
  signal?: AbortSignal
): AsyncGenerator<SeoStreamEvent> {
  let apiKey: string;
  try {
    apiKey = providerApiKey(env, provider);
  } catch (error) {
    if (error instanceof AiConfigError) {
      yield {
        type: 'error',
        code: `${provider.toUpperCase()}_CONFIG_MISSING`,
        message: error.message,
      };
      return;
    }
    throw error;
  }

  yield { type: 'start', model };
  if (signal?.aborted) return;

  let response: Response;
  try {
    response = await fetch(PROVIDER_ENDPOINTS[provider], {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(provider === 'openrouter'
          ? {
              'HTTP-Referer': 'https://mantomart.com',
              'X-Title': 'Mantomart AI SEO',
            }
          : {}),
      },
      body: JSON.stringify({
        model: openAiModelId(model),
        stream: true,
        temperature: 0.55,
        max_tokens: 8192,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: buildUserPrompt(input) },
        ],
      }),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    yield {
      type: 'error',
      code: `${provider.toUpperCase()}_NETWORK_ERROR`,
      message: 'Could not reach the selected AI provider. Try another provider.',
    };
    return;
  }

  if (!response.ok) {
    let payload: OpenAiResponse | null = null;
    try {
      payload = (await response.json()) as OpenAiResponse;
    } catch {
      payload = null;
    }
    const mapped = mapProviderError(provider, response.status, payload);
    yield { type: 'error', code: mapped.code, message: mapped.publicMessage };
    return;
  }
  if (!response.body) {
    yield {
      type: 'error',
      code: `${provider.toUpperCase()}_EMPTY`,
      message: 'The AI returned no content. Try another provider or model.',
    };
    return;
  }

  const parser = new SeoMarkerStreamParser();
  let accumulated = '';
  try {
    for await (const data of readSseDataLines(response.body, signal)) {
      if (signal?.aborted) return;
      let payload: OpenAiResponse;
      try {
        payload = JSON.parse(data) as OpenAiResponse;
      } catch {
        continue;
      }
      if (payload.error) {
        yield {
          type: 'error',
          code: `${provider.toUpperCase()}_API_ERROR`,
          message: payload.error.message || 'The AI provider returned an error.',
        };
        return;
      }
      const text = payload.choices?.[0]?.delta?.content || '';
      if (text) {
        accumulated += text;
        yield* emitParserEvents(parser.push(text));
      }
    }
  } catch {
    if (signal?.aborted) return;
    yield {
      type: 'error',
      code: `${provider.toUpperCase()}_NETWORK_ERROR`,
      message: 'The AI provider connection ended unexpectedly. Try again.',
    };
    return;
  }

  if (signal?.aborted) return;
  yield* emitParserEvents(parser.finish());
  try {
    const result = finalizeSeoResult(accumulated, model);
    const closed = new Set<SeoStreamFieldName>(
      SEO_STREAM_FIELD_ORDER.filter((field) => parser.isClosed(field))
    );
    if (!parser.sawMarker) {
      yield* emitFallbackFields(result, closed);
    } else {
      for (const field of SEO_STREAM_FIELD_ORDER) {
        if (!closed.has(field)) {
          yield { type: 'field', field, delta: '', done: true };
        }
      }
    }
    yield { type: 'done', data: result };
  } catch (error) {
    if (error instanceof AiApiError || error instanceof SeoParseError) {
      yield {
        type: 'error',
        code: error.code,
        message: error.publicMessage,
      };
      return;
    }
    yield {
      type: 'error',
      code: `${provider.toUpperCase()}_INVALID_RESPONSE`,
      message: 'The AI response could not be parsed. Try another provider or model.',
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateProductSeoCopy(
  env: Env,
  input: SeoGenerateInput
): Promise<SeoGenerateResult> {
  const selected = input.model ? providerForModel(input.model) : undefined;
  if (selected && selected.provider !== 'gemini') {
    for await (const event of generateOpenAiCompatibleSeoCopyStream(
      env,
      input,
      selected.provider,
      selected.model.id
    )) {
      if (event.type === 'done') return event.data;
      if (event.type === 'error') {
        throw new AiApiError(event.message, {
          status: 502,
          code: event.code,
          publicMessage: event.message,
        });
      }
    }
    throw new AiApiError('The AI provider returned no content.', {
      status: 502,
      code: 'AI_EMPTY',
      publicMessage: 'The AI returned no content. Try another provider or model.',
    });
  }

  const { apiKey, model, body } = buildSeoGenerationRequest(env, input);
  const url = `${config.GOOGLE_AI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

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
    throw mapNetworkError(err);
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

  if (!payload) {
    throw new AiApiError('Empty AI response.', {
      status: 502,
      code: 'GEMINI_EMPTY',
      publicMessage:
        'The AI returned no content. Try again or switch to another model.',
    });
  }

  inspectGeminiPayload(payload);

  return finalizeSeoResult(extractVisibleText(payload), model);
}

/**
 * Stream SEO copy as marked text arrives from the selected provider.
 * Yields `start`, incremental `{ field, delta, done }`, then `done` or `error`.
 */
export async function* generateProductSeoCopyStream(
  env: Env,
  input: SeoGenerateInput,
  signal?: AbortSignal
): AsyncGenerator<SeoStreamEvent> {
  const selected = input.model ? providerForModel(input.model) : undefined;
  if (selected && selected.provider !== 'gemini') {
    yield* generateOpenAiCompatibleSeoCopyStream(
      env,
      input,
      selected.provider,
      selected.model.id,
      signal
    );
    return;
  }

  let request: GeminiRequest;
  try {
    request = buildSeoGenerationRequest(env, input);
  } catch (err) {
    if (err instanceof AiConfigError) {
      yield {
        type: 'error',
        code: 'GEMINI_CONFIG_MISSING',
        message:
          err.message ||
          'Google AI Studio is not configured. Set GOOGLE_AI_STUDIO_API_KEY.',
      };
      return;
    }
    if (err instanceof AiApiError) {
      yield {
        type: 'error',
        code: err.code,
        message: err.publicMessage || err.message,
      };
      return;
    }
    throw err;
  }

  const { apiKey, model, body } = request;
  yield { type: 'start', model };

  if (signal?.aborted) return;

  const url = `${config.GOOGLE_AI_API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    const mapped = mapNetworkError(err);
    yield {
      type: 'error',
      code: mapped.code,
      message: mapped.publicMessage,
    };
    return;
  }

  if (!response.ok) {
    let payload: GeminiResponse | null = null;
    try {
      payload = (await response.json()) as GeminiResponse;
    } catch {
      payload = null;
    }
    const mapped = mapHttpError(response.status, payload);
    yield {
      type: 'error',
      code: mapped.code,
      message: mapped.publicMessage,
    };
    return;
  }

  if (!response.body) {
    yield {
      type: 'error',
      code: 'GEMINI_EMPTY',
      message: 'The AI returned no content. Try again or switch to another model.',
    };
    return;
  }

  const parser = new SeoMarkerStreamParser();
  let accumulated = '';

  try {
    for await (const data of readSseDataLines(response.body, signal)) {
      if (signal?.aborted) return;

      let payload: GeminiResponse;
      try {
        payload = JSON.parse(data) as GeminiResponse;
      } catch {
        continue;
      }

      if (payload.error) {
        const mapped = mapHttpError(
          typeof payload.error.code === 'number' ? payload.error.code : 502,
          payload
        );
        yield {
          type: 'error',
          code: mapped.code,
          message: mapped.publicMessage,
        };
        return;
      }

      try {
        inspectGeminiPayload(payload);
      } catch (err) {
        if (err instanceof AiApiError) {
          yield {
            type: 'error',
            code: err.code,
            message: err.publicMessage,
          };
          return;
        }
        throw err;
      }

      const text = extractVisibleText(payload);
      if (text) {
        accumulated += text;
        yield* emitParserEvents(parser.push(text));
      }
    }
  } catch (err) {
    if (signal?.aborted) return;
    if (err instanceof AiApiError) {
      yield {
        type: 'error',
        code: err.code,
        message: err.publicMessage,
      };
      return;
    }
    const mapped = mapNetworkError(err);
    yield {
      type: 'error',
      code: mapped.code,
      message: mapped.publicMessage,
    };
    return;
  }

  if (signal?.aborted) return;

  yield* emitParserEvents(parser.finish());

  try {
    const result = finalizeSeoResult(accumulated, model);
    const closed = new Set<SeoStreamFieldName>(
      SEO_STREAM_FIELD_ORDER.filter((field) => parser.isClosed(field))
    );
    // JSON fallback (no markers) still needs to surface fields once.
    if (!parser.sawMarker) {
      yield* emitFallbackFields(result, closed);
    } else {
      for (const field of SEO_STREAM_FIELD_ORDER) {
        if (!closed.has(field)) {
          yield { type: 'field', field, delta: '', done: true };
        }
      }
    }
    yield { type: 'done', data: result };
  } catch (err) {
    if (err instanceof AiApiError) {
      yield {
        type: 'error',
        code: err.code,
        message: err.publicMessage,
      };
      return;
    }
    if (err instanceof SeoParseError) {
      yield {
        type: 'error',
        code: err.code,
        message: err.publicMessage,
      };
      return;
    }
    yield {
      type: 'error',
      code: 'GEMINI_INVALID_JSON',
      message:
        'The AI response could not be parsed. Please try again or switch model.',
    };
  }
}
