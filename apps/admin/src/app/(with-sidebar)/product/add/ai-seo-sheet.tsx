'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AiSeoResult = {
  title: string;
  description: string;
  mobileDetailMarkdown: string;
  metaTitle: string;
  metaDescription: string;
  tags: string[];
  model: string;
};

export type AiSeoApplyPayload = {
  name?: string;
  description?: string;
  mobileDetailMarkdown?: string;
  metaTitle?: string;
  metaDescription?: string;
  tags?: string[];
};

export type AiSeoProductContext = {
  name: string;
  description: string;
  mobileDetailMarkdown: string;
  tags: string[];
};

type GeminiModelOption = {
  id: string;
  label: string;
  description: string;
  tier: string;
  recommended?: boolean;
};

type ModelsResponse = {
  success: true;
  data: {
    configured: boolean;
    defaultModel: string;
    models: GeminiModelOption[];
  };
};

type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

type Step = 'input' | 'result';
type Phase = 'idle' | 'exit' | 'enter-init' | 'enter';
type FieldStatus = 'pending' | 'streaming' | 'done';
type StringFieldKey =
  | 'title'
  | 'description'
  | 'mobileDetailMarkdown'
  | 'metaTitle'
  | 'metaDescription';
type FieldKey = StringFieldKey | 'tags';

type StringFieldState = { value: string; status: FieldStatus };
type TagsFieldState = { value: string[]; status: FieldStatus };

type FieldsState = {
  title: StringFieldState;
  description: StringFieldState;
  mobileDetailMarkdown: StringFieldState;
  metaTitle: StringFieldState;
  metaDescription: StringFieldState;
  tags: TagsFieldState;
};

type StreamFieldName = FieldKey;

type SseEvent = { event: string; data: string };

function getAiApiBase(): string {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  // Same-origin `/api` is rewritten by Next.js, which buffers SSE until the
  // Worker closes the stream. Talk to the API origin directly so chunks land live.
  return origin ? `${origin}/api/ai` : '/api/ai';
}

function waitAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}

// ─── Fallback models (used if /models fails) ──────────────────────────────────

const FALLBACK_MODELS: GeminiModelOption[] = [
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    description: 'Latest balanced model — best default for SEO copy.',
    tier: 'recommended',
    recommended: true,
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    description: 'Strong sustained quality for writing and structure.',
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
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'Highest quality in the 2.5 family — slower, richer copy.',
    tier: 'premium',
  },
];

const FIELD_ORDER: readonly FieldKey[] = [
  'title',
  'description',
  'mobileDetailMarkdown',
  'metaTitle',
  'metaDescription',
  'tags',
] as const;

const FIELD_LABELS: Record<FieldKey, string> = {
  title: 'Product title',
  description: 'Product description',
  mobileDetailMarkdown: 'Mobile description (Markdown)',
  metaTitle: 'Meta title',
  metaDescription: 'Meta description',
  tags: 'Tags',
};

const EMPTY_FIELDS: FieldsState = {
  title: { value: '', status: 'pending' },
  description: { value: '', status: 'pending' },
  mobileDetailMarkdown: { value: '', status: 'pending' },
  metaTitle: { value: '', status: 'pending' },
  metaDescription: { value: '', status: 'pending' },
  tags: { value: [], status: 'pending' },
};

function activeStreamField(
  fields: FieldsState,
  loading: boolean
): FieldKey | null {
  for (const key of FIELD_ORDER) {
    if (fields[key].status === 'streaming') return key;
  }

  if (!loading) return null;

  for (const key of FIELD_ORDER) {
    if (fields[key].status !== 'done') return key;
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message);
    this.code = opts.code;
    this.status = opts.status ?? 500;
  }
}

function emptyFields(): FieldsState {
  return {
    title: { value: '', status: 'pending' },
    description: { value: '', status: 'pending' },
    mobileDetailMarkdown: { value: '', status: 'pending' },
    metaTitle: { value: '', status: 'pending' },
    metaDescription: { value: '', status: 'pending' },
    tags: { value: [], status: 'pending' },
  };
}

function fieldsFromResult(result: AiSeoResult): FieldsState {
  return {
    title: { value: result.title, status: 'done' },
    description: { value: result.description, status: 'done' },
    mobileDetailMarkdown: { value: result.mobileDetailMarkdown, status: 'done' },
    metaTitle: { value: result.metaTitle, status: 'done' },
    metaDescription: { value: result.metaDescription, status: 'done' },
    tags: { value: result.tags, status: 'done' },
  };
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return err instanceof Error && err.name === 'AbortError';
}

function isStreamFieldName(value: unknown): value is StreamFieldName {
  return (
    value === 'title' ||
    value === 'description' ||
    value === 'mobileDetailMarkdown' ||
    value === 'metaTitle' ||
    value === 'metaDescription' ||
    value === 'tags'
  );
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function parseAiSeoResult(raw: unknown): AiSeoResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== 'string') return null;
  if (typeof obj.description !== 'string') return null;
  if (typeof obj.mobileDetailMarkdown !== 'string') return null;
  return {
    title: obj.title.trim(),
    description: obj.description.trim(),
    mobileDetailMarkdown: obj.mobileDetailMarkdown.trim(),
    metaTitle:
      typeof obj.metaTitle === 'string' ? obj.metaTitle.trim() : '',
    metaDescription:
      typeof obj.metaDescription === 'string'
        ? obj.metaDescription.trim()
        : '',
    tags: asStringArray(obj.tags),
    model: typeof obj.model === 'string' ? obj.model : '',
  };
}

function salvageResult(
  fields: FieldsState,
  model: string
): AiSeoResult | null {
  if (
    fields.title.status !== 'done' ||
    !fields.title.value.trim() ||
    fields.description.status !== 'done' ||
    !fields.description.value.trim() ||
    fields.mobileDetailMarkdown.status !== 'done' ||
    !fields.mobileDetailMarkdown.value.trim()
  ) {
    return null;
  }

  return {
    title: fields.title.value,
    description: fields.description.value,
    mobileDetailMarkdown: fields.mobileDetailMarkdown.value,
    metaTitle: fields.metaTitle.value || fields.title.value,
    metaDescription:
      fields.metaDescription.value || fields.description.value.slice(0, 160),
    tags: fields.tags.value,
    model,
  };
}

function consumeSseBlocks(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  const events: SseEvent[] = [];

  for (const block of parts) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;

    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^\s/, ''));
      }
    }
    if (dataLines.length > 0) {
      events.push({ event, data: dataLines.join('\n') });
    }
  }

  return { events, rest };
}

function throwIfApiErrorPayload(data: unknown, status: number): void {
  const body = (data ?? {}) as ApiErrorBody;
  if (body.success === false || status >= 400) {
    throw new ApiError(
      body.error || body.message || `Request failed (${status}).`,
      { code: body.code, status }
    );
  }
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      cache: 'no-store',
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError('Unable to reach the server. Please try again.', {
      status: 0,
      code: 'NETWORK_ERROR',
    });
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      response.ok
        ? 'Server returned an invalid response.'
        : `Request failed with status ${response.status}.`,
      { status: response.status }
    );
  }

  throwIfApiErrorPayload(data, response.status);
  return data as T;
}

type StreamFieldUpdate = {
  field: StreamFieldName;
  delta?: string;
  value?: string | string[];
  done: boolean;
};

type StreamHandlers = {
  onStart: (model: string) => void;
  onField: (update: StreamFieldUpdate) => void;
  onDone: (result: AiSeoResult) => void;
};

type PendingFieldUpdate = {
  append?: string;
  tags?: string[];
  replace?: string | string[];
  done: boolean;
};

function appendUniqueTags(existing: string[], incoming: string[]): string[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((tag) => tag.toLowerCase()));
  const out = [...existing];
  for (const tag of incoming) {
    const normalized = tag.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

async function streamSeoGenerate(
  payload: Record<string, unknown>,
  signal: AbortSignal,
  handlers: StreamHandlers
): Promise<AiSeoResult> {
  let response: Response;
  try {
    response = await fetch(`${getAiApiBase()}/seo/generate`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      signal,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError('Unable to reach the server. Please try again.', {
      status: 0,
      code: 'NETWORK_ERROR',
    });
  }

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(`Request failed with status ${response.status}.`, {
        status: response.status,
      });
    }
    throwIfApiErrorPayload(data, response.status);
    throw new ApiError(`Request failed (${response.status}).`, {
      status: response.status,
    });
  }

  // Compatibility: a non-streaming worker still returns JSON.
  if (contentType.includes('application/json')) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      throw new ApiError('Server returned an invalid response.', {
        status: response.status,
      });
    }
    throwIfApiErrorPayload(data, response.status);
    const parsed = parseAiSeoResult(
      data && typeof data === 'object'
        ? (data as { data?: unknown }).data
        : null
    );
    if (!parsed) {
      throw new ApiError('Server returned an invalid response.', {
        status: response.status,
        code: 'INVALID_RESPONSE',
      });
    }
    handlers.onStart(parsed.model);
    for (const key of FIELD_ORDER) {
      handlers.onField({ field: key, value: parsed[key], done: true });
    }
    handlers.onDone(parsed);
    return parsed;
  }

  if (!response.body) {
    throw new ApiError('The server closed the stream unexpectedly.', {
      status: response.status,
      code: 'STREAM_EMPTY',
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: AiSeoResult | null = null;
  let streamError: ApiError | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const consumed = consumeSseBlocks(buffer);
      buffer = consumed.rest;

      for (const event of consumed.events) {
        if (event.event === 'ping') continue;

        let parsed: unknown = null;
        if (event.data) {
          try {
            parsed = JSON.parse(event.data);
          } catch {
            continue;
          }
        }

        if (event.event === 'start') {
          const model =
            parsed &&
            typeof parsed === 'object' &&
            typeof (parsed as { model?: unknown }).model === 'string'
              ? (parsed as { model: string }).model
              : '';
          handlers.onStart(model);
          continue;
        }

        if (event.event === 'field') {
          if (!parsed || typeof parsed !== 'object') continue;
          const rec = parsed as {
            field?: unknown;
            delta?: unknown;
            value?: unknown;
            done?: unknown;
          };
          if (!isStreamFieldName(rec.field)) continue;
          const doneField = rec.done === true;
          if (typeof rec.delta === 'string') {
            handlers.onField({
              field: rec.field,
              delta: rec.delta,
              done: doneField,
            });
          } else if (rec.field === 'tags') {
            handlers.onField({
              field: rec.field,
              value: asStringArray(rec.value),
              done: doneField,
            });
          } else if (typeof rec.value === 'string') {
            handlers.onField({
              field: rec.field,
              value: rec.value,
              done: doneField,
            });
          } else if (doneField) {
            handlers.onField({ field: rec.field, delta: '', done: true });
          }
          continue;
        }

        if (event.event === 'done') {
          const parsedResult = parseAiSeoResult(parsed);
          if (!parsedResult) {
            streamError = new ApiError(
              'The AI response could not be parsed. Please try again.',
              { code: 'GEMINI_INVALID_JSON', status: 502 }
            );
            continue;
          }
          result = parsedResult;
          handlers.onDone(parsedResult);
          continue;
        }

        if (event.event === 'error') {
          const rec =
            parsed && typeof parsed === 'object'
              ? (parsed as { code?: unknown; message?: unknown })
              : {};
          streamError = new ApiError(
            typeof rec.message === 'string'
              ? rec.message
              : 'SEO generation failed.',
            {
              code: typeof rec.code === 'string' ? rec.code : 'GEMINI_API_ERROR',
              status: 502,
            }
          );
        }

        // Yield so React can paint this event before the next one in the same
        // TCP read is applied. Otherwise a burst looks like one dump.
        if (
          event.event === 'start' ||
          event.event === 'field' ||
          event.event === 'done'
        ) {
          await waitAnimationFrame();
        }
      }

      if (streamError) break;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }

  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (streamError) throw streamError;
  if (result) return result;

  throw new ApiError('Connection closed before generation finished.', {
    status: 0,
    code: 'STREAM_INTERRUPTED',
  });
}

function tierBadgeVariant(
  tier: string
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (tier === 'recommended') return 'default';
  if (tier === 'premium') return 'secondary';
  if (tier === 'preview') return 'outline';
  return 'outline';
}

function tierLabel(tier: string) {
  if (tier === 'recommended') return 'Recommended';
  if (tier === 'premium') return 'Premium';
  if (tier === 'fast') return 'Fast';
  if (tier === 'preview') return 'Preview';
  if (tier === 'balanced') return 'Balanced';
  return tier;
}

function applyPayloadFor(
  field: StringFieldKey,
  value: string
): AiSeoApplyPayload {
  switch (field) {
    case 'title':
      return { name: value };
    case 'description':
      return { description: value };
    case 'mobileDetailMarkdown':
      return { mobileDetailMarkdown: value };
    case 'metaTitle':
      return { metaTitle: value.slice(0, 120) };
    case 'metaDescription':
      return { metaDescription: value.slice(0, 320) };
  }
}

// ─── Result field card ────────────────────────────────────────────────────────

function FieldActions({
  ready,
  used,
  onCopy,
  onUse,
}: {
  ready: boolean;
  used?: boolean;
  onCopy: () => void;
  onUse: () => void;
}) {
  return (
    <div className="flex shrink-0 gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 px-2"
        disabled={!ready}
        onClick={onCopy}
        title={ready ? 'Copy' : 'Wait until this field finishes writing'}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant={used ? 'secondary' : 'default'}
        className="h-8"
        disabled={!ready}
        onClick={onUse}
        title={ready ? 'Use this field' : 'Wait until this field finishes writing'}
      >
        {used ? (
          <>
            <Check className="mr-1 h-3.5 w-3.5" />
            Used
          </>
        ) : (
          'Use'
        )}
      </Button>
    </div>
  );
}

function StreamingCaret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-3 w-px translate-y-px animate-pulse bg-foreground align-text-bottom"
    />
  );
}

function WritingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
      <span className="size-1.5 animate-pulse rounded-full bg-primary" />
      <span className="ai-seo-writing-text" data-text="Writing">
        Writing
      </span>
    </span>
  );
}

function PendingPlaceholder({ lines = 1 }: { lines?: number }) {
  return (
    <div className="space-y-2 py-0.5">
      <div className="h-3 w-[78%] rounded bg-muted" />
      {lines > 1 ? <div className="h-3 w-[52%] rounded bg-muted/70" /> : null}
    </div>
  );
}

function ResultField({
  id,
  label,
  hint,
  value,
  status,
  multiline,
  markdown,
  onUse,
  onCopy,
  used,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  status: FieldStatus;
  multiline?: boolean;
  markdown?: boolean;
  onUse: () => void;
  onCopy: () => void;
  used?: boolean;
}) {
  const ready = status === 'done' && value.trim().length > 0;
  const bodyRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (status !== 'streaming') return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [status, value]);

  return (
    <div
      id={id}
      className={cn(
        'space-y-2 rounded-lg border p-3 transition-colors',
        status === 'pending' && 'border-dashed bg-muted/10',
        status === 'streaming' && 'border-primary/25 bg-primary/[0.04]',
        status === 'done' && 'bg-muted/20'
      )}
      aria-busy={status === 'streaming'}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{label}</p>
            {status === 'streaming' ? <WritingIndicator /> : null}
          </div>
          {hint ? (
            <p className="text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <FieldActions
          ready={ready}
          used={used}
          onCopy={onCopy}
          onUse={onUse}
        />
      </div>
      {status === 'pending' ? (
        <PendingPlaceholder lines={multiline || markdown ? 2 : 1} />
      ) : multiline || markdown ? (
        <pre
          ref={(el) => {
            bodyRef.current = el;
          }}
          className={cn(
            'max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2.5 text-xs leading-relaxed',
            markdown && 'font-mono'
          )}
        >
          {value}
          {status === 'streaming' ? <StreamingCaret /> : null}
        </pre>
      ) : (
        <p
          ref={(el) => {
            bodyRef.current = el;
          }}
          className="rounded-md border bg-background p-2.5 text-sm leading-relaxed"
        >
          {value}
          {status === 'streaming' ? <StreamingCaret /> : null}
        </p>
      )}
    </div>
  );
}

function ResultTags({
  tags,
  status,
  used,
  onUse,
  onCopy,
}: {
  tags: string[];
  status: FieldStatus;
  used?: boolean;
  onUse: () => void;
  onCopy: () => void;
}) {
  const ready = status === 'done';

  return (
    <div
      id="ai-seo-field-tags"
      className={cn(
        'space-y-2 rounded-lg border p-3 transition-colors',
        status === 'pending' && 'border-dashed bg-muted/10',
        status === 'streaming' && 'border-primary/25 bg-primary/[0.04]',
        status === 'done' && 'bg-muted/20'
      )}
      aria-busy={status === 'streaming'}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Tags</p>
            {status === 'streaming' ? <WritingIndicator /> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {status === 'pending'
              ? 'Step 5 SEO'
              : status === 'streaming'
                ? `${tags.length} so far · Step 5 SEO`
                : `${tags.length} tags · Step 5 SEO`}
          </p>
        </div>
        <FieldActions ready={ready} used={used} onCopy={onCopy} onUse={onUse} />
      </div>
      {status === 'pending' ? (
        <div className="flex flex-wrap gap-1.5">
          <span className="h-5 w-16 rounded-full bg-muted" />
          <span className="h-5 w-20 rounded-full bg-muted/80" />
          <span className="h-5 w-12 rounded-full bg-muted/60" />
        </div>
      ) : tags.length > 0 || status === 'streaming' ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
          {status === 'streaming' ? (
            <span className="inline-flex items-center text-xs text-muted-foreground">
              <StreamingCaret />
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No tags returned.</p>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export type AiSeoSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Product text context sent with the keyword (no images). */
  productContext: AiSeoProductContext;
  /**
   * Stable id for the current product/draft. When it changes, form inputs
   * can prefill from the new product — results stay until the user regenerates
   * or the parent unmounts the sheet.
   */
  productKey?: string | null;
  /** Apply one or more fields into the import wizard form. */
  onApply: (payload: AiSeoApplyPayload) => void;
};

export default function AiSeoSheet({
  open,
  onOpenChange,
  productContext,
  productKey = null,
  onApply,
}: AiSeoSheetProps) {
  const [keyword, setKeyword] = useState('');
  const [secondaryKeywords, setSecondaryKeywords] = useState('');
  const [notes, setNotes] = useState('');
  const [model, setModel] = useState('gemini-3.6-flash');
  const [models, setModels] = useState<GeminiModelOption[]>(FALLBACK_MODELS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<AiSeoResult | null>(null);
  const [fields, setFields] = useState<FieldsState>(EMPTY_FIELDS);
  const [usedFields, setUsedFields] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>('input');
  const [phase, setPhase] = useState<Phase>('idle');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  const modelsLoadedRef = useRef(false);
  const lastProductKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rafRef = useRef<number | null>(null);
  const fieldRafRef = useRef<number | null>(null);
  const pendingFieldsRef = useRef<Partial<Record<FieldKey, PendingFieldUpdate>>>(
    {}
  );
  const fieldsRef = useRef<FieldsState>(EMPTY_FIELDS);
  const streamModelRef = useRef(model);
  const timeoutsRef = useRef<number[]>([]);

  fieldsRef.current = fields;

  const clearTransitionTimers = useCallback(() => {
    timeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
    timeoutsRef.current = [];

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const flushFieldUpdates = useCallback(() => {
    if (fieldRafRef.current !== null) {
      cancelAnimationFrame(fieldRafRef.current);
      fieldRafRef.current = null;
    }

    const pending = pendingFieldsRef.current;
    pendingFieldsRef.current = {};
    const keys = Object.keys(pending) as FieldKey[];
    if (keys.length === 0) return fieldsRef.current;

    const next: FieldsState = { ...fieldsRef.current };
    for (const key of keys) {
      const update = pending[key];
      if (!update) continue;
      const status: FieldStatus = update.done ? 'done' : 'streaming';

      if (key === 'tags') {
        const replaced = Array.isArray(update.replace)
          ? asStringArray(update.replace)
          : null;
        next.tags = {
          value: appendUniqueTags(
            replaced ?? next.tags.value,
            update.tags ?? []
          ),
          status,
        };
      } else {
        const replaced =
          typeof update.replace === 'string' ? update.replace : null;
        let value =
          replaced !== null
            ? replaced
            : next[key].value + (update.append ?? '');
        if (update.done) value = value.replace(/\s+$/, '');
        next[key] = { value, status };
      }
    }
    fieldsRef.current = next;
    setFields(next);
    return next;
  }, []);

  const queueFieldUpdate = useCallback(
    (update: StreamFieldUpdate) => {
      const field = update.field;
      const prev = pendingFieldsRef.current[field] ?? { done: false };

      if (update.value !== undefined) {
        pendingFieldsRef.current[field] = {
          replace: update.value,
          done: prev.done || update.done,
        };
      } else if (field === 'tags') {
        pendingFieldsRef.current.tags = {
          tags: [...(prev.tags ?? []), ...(update.delta ? [update.delta] : [])],
          done: prev.done || update.done,
        };
      } else {
        pendingFieldsRef.current[field] = {
          append: (prev.append ?? '') + (update.delta ?? ''),
          done: prev.done || update.done,
        };
      }

      if (fieldRafRef.current !== null) return;
      fieldRafRef.current = requestAnimationFrame(() => {
        fieldRafRef.current = null;
        flushFieldUpdates();
      });
    },
    [flushFieldUpdates]
  );

  const applyFieldUpdate = useCallback(
    (update: StreamFieldUpdate) => {
      queueFieldUpdate(update);
      flushFieldUpdates();
    },
    [flushFieldUpdates, queueFieldUpdate]
  );

  const transitionTo = useCallback(
    (nextStep: Step, dir: 'forward' | 'back', onMidpoint?: () => void) => {
      if (step === nextStep && phase === 'idle') {
        onMidpoint?.();
        return;
      }

      clearTransitionTimers();
      setDirection(dir);
      setPhase('exit');

      const exitTimeout = window.setTimeout(() => {
        setStep(nextStep);
        onMidpoint?.();
        setPhase('enter-init');

        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = requestAnimationFrame(() => {
            setPhase('enter');

            const enterTimeout = window.setTimeout(() => {
              setPhase('idle');
            }, 350);

            timeoutsRef.current.push(enterTimeout);
          });
        });
      }, 300);

      timeoutsRef.current.push(exitTimeout);
    },
    [clearTransitionTimers, phase, step]
  );

  // Prefill keyword from product title when product changes and keyword empty
  useEffect(() => {
    if (!productKey) return;
    if (lastProductKeyRef.current === productKey) return;
    lastProductKeyRef.current = productKey;

    // Only seed when the user has not typed a keyword yet and no result cached
    if (!keyword.trim() && !result) {
      const seed = productContext.name.trim().slice(0, 80);
      if (seed) setKeyword(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: seed once per product
  }, [productKey]);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const res = await requestJson<ModelsResponse>(`${getAiApiBase()}/models`);
      setModels(res.data.models?.length ? res.data.models : FALLBACK_MODELS);
      setConfigured(Boolean(res.data.configured));
      if (res.data.defaultModel) {
        setModel((prev) => {
          const ids = new Set(res.data.models.map((m) => m.id));
          if (ids.has(prev)) return prev;
          return res.data.defaultModel;
        });
      }
      modelsLoadedRef.current = true;
    } catch (err) {
      // Non-fatal — fall back to static list; generate will surface real errors.
      setModels(FALLBACK_MODELS);
      setConfigured(null);
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_PERMISSION') {
        setError(err.message);
        setErrorCode(err.code);
      }
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Load models once when first opened (results & form state are intentionally kept)
  useEffect(() => {
    if (!open) return;
    if (!modelsLoadedRef.current) {
      void loadModels();
    }
  }, [open, loadModels]);

  // Cleanup in-flight request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearTransitionTimers();
      if (fieldRafRef.current !== null) {
        cancelAnimationFrame(fieldRafRef.current);
      }
    };
  }, [clearTransitionTimers]);

  useEffect(() => {
    if (open) return;
    clearTransitionTimers();
    setPhase('idle');
  }, [clearTransitionTimers, open]);

  const selectedModelMeta = useMemo(
    () => models.find((m) => m.id === model) ?? null,
    [models, model]
  );

  const activeField = useMemo(
    () => activeStreamField(fields, loading),
    [fields, loading]
  );

  const fieldStatuses = useMemo(() => {
    return FIELD_ORDER.reduce(
      (acc, key) => {
        acc[key] =
          loading && activeField === key && fields[key].status === 'pending'
            ? 'streaming'
            : fields[key].status;
        return acc;
      },
      {} as Record<FieldKey, FieldStatus>
    );
  }, [activeField, fields, loading]);

  const doneCount = useMemo(
    () => FIELD_ORDER.filter((key) => fieldStatuses[key] === 'done').length,
    [fieldStatuses]
  );

  const allFieldsReady = doneCount === FIELD_ORDER.length;

  const hasViewableResult =
    result !== null ||
    FIELD_ORDER.some(
      (key) =>
        fields[key].status === 'done' || fields[key].status === 'streaming'
    );

  const writingVisibleResult =
    loading || (hasViewableResult && !allFieldsReady && !error);

  useEffect(() => {
    if (!writingVisibleResult || !activeField) return;
    const el = document.getElementById(`ai-seo-field-${activeField}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeField, writingVisibleResult]);

  const getStyle = (): CSSProperties => {
    const exitX = direction === 'forward' ? '-60px' : '60px';
    const enterFromX = direction === 'forward' ? '60px' : '-60px';

    switch (phase) {
      case 'exit':
        return {
          opacity: 0,
          transform: `translateX(${exitX})`,
          transition:
            'opacity 280ms ease, transform 280ms cubic-bezier(0.4,0,0.2,1)',
        };
      case 'enter-init':
        return {
          opacity: 0,
          transform: `translateX(${enterFromX})`,
          transition: 'none',
        };
      case 'enter':
        return {
          opacity: 1,
          transform: 'translateX(0)',
          transition:
            'opacity 320ms ease, transform 320ms cubic-bezier(0.2,0,0,1)',
        };
      default:
        return {
          opacity: 1,
          transform: 'translateX(0)',
          transition: 'none',
        };
    }
  };

  const runGenerate = async (e?: FormEvent) => {
    e?.preventDefault();
    if (phase !== 'idle') return;

    const seed = keyword.trim();
    if (!seed) {
      setError('Enter a focus keyword you want the copy to rank for.');
      setErrorCode('MISSING_KEYWORD');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    pendingFieldsRef.current = {};
    if (fieldRafRef.current !== null) {
      cancelAnimationFrame(fieldRafRef.current);
      fieldRafRef.current = null;
    }

    const nextFields = emptyFields();
    fieldsRef.current = nextFields;
    streamModelRef.current = model;
    setFields(nextFields);
    setResult(null);
    setUsedFields(new Set());
    setLoading(true);
    setError(null);
    setErrorCode(null);
    transitionTo('result', 'forward');

    try {
      const generated = await streamSeoGenerate(
        {
          keyword: seed,
          secondaryKeywords: secondaryKeywords.trim() || undefined,
          notes: notes.trim() || undefined,
          model,
          productTitle: productContext.name || undefined,
          productDescription: productContext.description || undefined,
          mobileDetailMarkdown:
            productContext.mobileDetailMarkdown || undefined,
          existingTags:
            productContext.tags.length > 0 ? productContext.tags : undefined,
        },
        controller.signal,
        {
          onStart: (streamModel) => {
            if (streamModel) streamModelRef.current = streamModel;
          },
          onField: applyFieldUpdate,
          onDone: (data) => {
            flushFieldUpdates();
            const complete = fieldsFromResult(data);
            fieldsRef.current = complete;
            setFields(complete);
            setResult(data);
          },
        }
      );

      if (controller.signal.aborted) return;

      flushFieldUpdates();
      const complete = fieldsFromResult(generated);
      fieldsRef.current = complete;
      setFields(complete);
      setResult(generated);
      setConfigured(true);
      toast.success('SEO copy generated.');
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return;

      flushFieldUpdates();

      if (err instanceof ApiError && err.code === 'STREAM_INTERRUPTED') {
        const salvaged = salvageResult(
          fieldsRef.current,
          streamModelRef.current || model
        );
        if (salvaged) {
          setFields(fieldsFromResult(salvaged));
          setResult(salvaged);
          setConfigured(true);
          toast.success('SEO copy generated.');
          return;
        }
      }

      const message =
        err instanceof Error ? err.message : 'SEO generation failed.';
      const code = err instanceof ApiError ? (err.code ?? null) : null;
      setError(message);
      setErrorCode(code);
      toast.error(message);

      if (code === 'GEMINI_CONFIG_MISSING' || code === 'GEMINI_AUTH_ERROR') {
        setConfigured(false);
      }
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  };

  const markUsed = (field: string) => {
    setUsedFields((prev) => new Set(prev).add(field));
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied.`);
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  };

  const applyField = (field: string, payload: AiSeoApplyPayload) => {
    onApply(payload);
    markUsed(field);
    toast.success(`${field === 'all' ? 'All fields' : field} applied.`);
  };

  const applyAll = () => {
    if (!allFieldsReady) return;
    onApply({
      name: fields.title.value,
      description: fields.description.value,
      mobileDetailMarkdown: fields.mobileDetailMarkdown.value,
      metaTitle: fields.metaTitle.value,
      metaDescription: fields.metaDescription.value,
      tags: fields.tags.value,
    });
    setUsedFields(
      new Set([
        'title',
        'description',
        'mobile',
        'metaTitle',
        'metaDescription',
        'tags',
        'all',
      ])
    );
    toast.success('All generated fields applied to the product.');
  };

  const goBackToInput = () => {
    if (loading) {
      abortRef.current?.abort();
      setLoading(false);
    }
    transitionTo('input', 'back');
  };

  const configMissing =
    configured === false ||
    errorCode === 'GEMINI_CONFIG_MISSING' ||
    errorCode === 'GEMINI_AUTH_ERROR';

  const permissionDenied = errorCode === 'INSUFFICIENT_PERMISSION';

  const resultModel = result?.model || model;
  const statusLine = writingVisibleResult
    ? activeField
      ? `Writing ${FIELD_LABELS[activeField].toLowerCase()}…`
      : 'Starting generation…'
    : error
      ? 'Generation stopped'
      : `Model: ${resultModel}. Results stay when you close this sheet or edit inputs.`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="z-[60] flex w-full flex-col gap-0 p-0 sm:max-w-xl"
        showCloseButton
      >
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI SEO generator
          </SheetTitle>
          <SheetDescription className="text-xs sm:text-sm sr-only">
            Write a focus keyword, pick a Gemini model, then generate
            human-quality title, descriptions, meta tags, and product tags.
            Closing this panel keeps your last results.
          </SheetDescription>
        </SheetHeader>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col" style={getStyle()}>
            {step === 'input' ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                {modelsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading available models...
                  </div>
                ) : null}

                {permissionDenied ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Permission required</AlertTitle>
                    <AlertDescription>
                      You need the{' '}
                      <code className="text-xs">ai_seo:generate</code>{' '}
                      permission (or product create/update) to use this tool.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {configMissing ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Google AI Studio not configured</AlertTitle>
                    <AlertDescription>
                      {error ||
                        'Set the GOOGLE_AI_STUDIO_API_KEY Worker secret, then restart the API.'}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <form onSubmit={runGenerate} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ai-seo-keyword">Focus keyword</Label>
                    <Input
                      id="ai-seo-keyword"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="e.g. wireless noise cancelling earbuds"
                      maxLength={200}
                      disabled={loading || permissionDenied}
                      autoFocus={open && step === 'input'}
                    />
                    <p className="text-xs text-muted-foreground">
                      The main phrase you want the title and meta to rank for.
                      Current product title & description are also sent for
                      context (no images).
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ai-seo-secondary">
                      Extra keywords{' '}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="ai-seo-secondary"
                      value={secondaryKeywords}
                      onChange={(e) => setSecondaryKeywords(e.target.value)}
                      placeholder="bluetooth 5.3, long battery life, ..."
                      maxLength={500}
                      disabled={loading || permissionDenied}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ai-seo-notes">
                      Notes{' '}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <Textarea
                      id="ai-seo-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Audience, tone, must-include claims..."
                      rows={2}
                      maxLength={800}
                      disabled={loading || permissionDenied}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="ai-seo-model">Model</Label>
                      {selectedModelMeta ? (
                        <Badge
                          variant={tierBadgeVariant(selectedModelMeta.tier)}
                          className="text-[10px]"
                        >
                          {tierLabel(selectedModelMeta.tier)}
                        </Badge>
                      ) : null}
                    </div>
                    <Select
                      value={model}
                      onValueChange={setModel}
                      disabled={loading || permissionDenied}
                    >
                      <SelectTrigger id="ai-seo-model">
                        <SelectValue placeholder="Select a Gemini model" />
                      </SelectTrigger>
                      <SelectContent className="z-[80]">
                        {models.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.label}
                            {m.recommended || m.tier === 'recommended'
                              ? ' (Recommended)'
                              : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedModelMeta ? (
                      <p className="text-xs text-muted-foreground">
                        {selectedModelMeta.description}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      disabled={
                        loading ||
                        !keyword.trim() ||
                        permissionDenied ||
                        phase !== 'idle'
                      }
                      className="flex-1 sm:flex-none"
                    >
                      {loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Wand2 className="mr-2 h-4 w-4" />
                      )}
                      {hasViewableResult ? 'Regenerate' : 'Generate'}
                    </Button>
                    {hasViewableResult ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={loading || phase !== 'idle'}
                        onClick={() => transitionTo('result', 'forward')}
                      >
                        View result
                      </Button>
                    ) : null}
                  </div>
                </form>

                {error && !configMissing && !permissionDenied ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Generation failed</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <p>{error}</p>
                      {errorCode === 'GEMINI_RATE_LIMITED' ? (
                        <p className="text-xs">
                          Tip: wait a few seconds or switch to a Flash-Lite
                          model.
                        </p>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {!hasViewableResult &&
                !loading &&
                !error &&
                !permissionDenied ? (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Enter a focus keyword, choose a Gemini model, then generate
                    organised product title, description, mobile markdown, and
                    SEO metadata. Your product title and description are
                    included for better context.
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 'result' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-3 border-b p-4">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={goBackToInput}
                    disabled={phase !== 'idle'}
                    aria-label="Back to AI SEO inputs"
                    className="h-8 w-8 rounded-full"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">
                      {writingVisibleResult
                        ? 'Generating copy'
                        : 'Generated copy'}
                    </h3>
                    <p
                      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                      aria-live="polite"
                    >
                      <span className="truncate">{statusLine}</span>
                      {writingVisibleResult ? (
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {doneCount}/6
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={loading || !allFieldsReady}
                      onClick={applyAll}
                      className="shrink-0"
                      title={
                        allFieldsReady
                          ? 'Apply every field to the product'
                          : 'Wait until every field finishes writing'
                      }
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Use all
                    </Button>
                  </div>
                </div>
                <div
                  className="h-0.5 w-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={6}
                  aria-valuenow={doneCount}
                  aria-label="SEO fields ready"
                >
                  <div
                    className="h-full bg-primary transition-[width] duration-300 ease-out"
                    style={{ width: `${(doneCount / 6) * 100}%` }}
                  />
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {error && !configMissing && !permissionDenied ? (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Generation failed</AlertTitle>
                      <AlertDescription className="space-y-2">
                        <p>{error}</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={goBackToInput}
                        >
                          Try again
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <ResultField
                    id="ai-seo-field-title"
                    label="Product title"
                    hint={
                      fieldStatuses.title === 'done'
                        ? `${fields.title.value.length} chars · Step 1`
                        : fieldStatuses.title === 'streaming'
                          ? `${fields.title.value.length} chars · writing`
                          : 'Step 1'
                    }
                    value={fields.title.value}
                    status={fieldStatuses.title}
                    used={usedFields.has('title')}
                    onUse={() =>
                      applyField(
                        'title',
                        applyPayloadFor('title', fields.title.value)
                      )
                    }
                    onCopy={() => void copyText(fields.title.value, 'Title')}
                  />

                  <ResultField
                    id="ai-seo-field-description"
                    label="Product description"
                    hint={
                      fieldStatuses.description === 'done'
                        ? `${fields.description.value.length} chars · Step 2`
                        : fieldStatuses.description === 'streaming'
                          ? `${fields.description.value.length} chars · writing`
                          : 'Step 2'
                    }
                    value={fields.description.value}
                    status={fieldStatuses.description}
                    multiline
                    used={usedFields.has('description')}
                    onUse={() =>
                      applyField(
                        'description',
                        applyPayloadFor(
                          'description',
                          fields.description.value
                        )
                      )
                    }
                    onCopy={() =>
                      void copyText(fields.description.value, 'Description')
                    }
                  />

                  <ResultField
                    id="ai-seo-field-mobileDetailMarkdown"
                    label="Mobile description (Markdown)"
                    hint={
                      fieldStatuses.mobileDetailMarkdown === 'streaming'
                        ? 'Writing markdown · Step 3'
                        : 'Step 3 · markdown editor'
                    }
                    value={fields.mobileDetailMarkdown.value}
                    status={fieldStatuses.mobileDetailMarkdown}
                    multiline
                    markdown
                    used={usedFields.has('mobile')}
                    onUse={() =>
                      applyField(
                        'mobile',
                        applyPayloadFor(
                          'mobileDetailMarkdown',
                          fields.mobileDetailMarkdown.value
                        )
                      )
                    }
                    onCopy={() =>
                      void copyText(
                        fields.mobileDetailMarkdown.value,
                        'Mobile description'
                      )
                    }
                  />

                  <ResultField
                    id="ai-seo-field-metaTitle"
                    label="Meta title"
                    hint={
                      fieldStatuses.metaTitle === 'pending'
                        ? 'Step 5 SEO'
                        : `${fields.metaTitle.value.length}/70 recommended · Step 5 SEO`
                    }
                    value={fields.metaTitle.value}
                    status={fieldStatuses.metaTitle}
                    used={usedFields.has('metaTitle')}
                    onUse={() =>
                      applyField(
                        'metaTitle',
                        applyPayloadFor('metaTitle', fields.metaTitle.value)
                      )
                    }
                    onCopy={() =>
                      void copyText(fields.metaTitle.value, 'Meta title')
                    }
                  />

                  <ResultField
                    id="ai-seo-field-metaDescription"
                    label="Meta description"
                    hint={
                      fieldStatuses.metaDescription === 'pending'
                        ? 'Step 5 SEO'
                        : `${fields.metaDescription.value.length}/160 recommended · Step 5 SEO`
                    }
                    value={fields.metaDescription.value}
                    status={fieldStatuses.metaDescription}
                    multiline
                    used={usedFields.has('metaDescription')}
                    onUse={() =>
                      applyField(
                        'metaDescription',
                        applyPayloadFor(
                          'metaDescription',
                          fields.metaDescription.value
                        )
                      )
                    }
                    onCopy={() =>
                      void copyText(
                        fields.metaDescription.value,
                        'Meta description'
                      )
                    }
                  />

                  <ResultTags
                    tags={fields.tags.value}
                    status={fieldStatuses.tags}
                    used={usedFields.has('tags')}
                    onUse={() =>
                      applyField('tags', { tags: fields.tags.value })
                    }
                    onCopy={() =>
                      void copyText(fields.tags.value.join(', '), 'Tags')
                    }
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
