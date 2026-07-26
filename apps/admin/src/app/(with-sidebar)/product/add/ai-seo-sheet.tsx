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

type GenerateResponse = {
  success: true;
  data: AiSeoResult;
};

type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

type Step = 'input' | 'result';
type Phase = 'idle' | 'exit' | 'enter-init' | 'enter';

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
  } catch {
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

  const body = data as ApiErrorBody;
  if (!response.ok || body.success === false) {
    throw new ApiError(
      body.error || body.message || `Request failed (${response.status}).`,
      { code: body.code, status: response.status }
    );
  }

  return data as T;
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

// ─── Result field card ────────────────────────────────────────────────────────

function ResultField({
  label,
  hint,
  value,
  multiline,
  markdown,
  onUse,
  onCopy,
  used,
}: {
  label: string;
  hint?: string;
  value: string;
  multiline?: boolean;
  markdown?: boolean;
  onUse: () => void;
  onCopy: () => void;
  used?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {hint ? (
            <p className="text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={onCopy}
            title="Copy"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={used ? 'secondary' : 'default'}
            className="h-8"
            onClick={onUse}
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
      </div>
      {multiline || markdown ? (
        <pre
          className={cn(
            'max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2.5 text-xs leading-relaxed',
            markdown && 'font-mono'
          )}
        >
          {value}
        </pre>
      ) : (
        <p className="rounded-md border bg-background p-2.5 text-sm leading-relaxed">
          {value}
        </p>
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
  const [usedFields, setUsedFields] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>('input');
  const [phase, setPhase] = useState<Phase>('idle');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  const modelsLoadedRef = useRef(false);
  const lastProductKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);

  const clearTransitionTimers = useCallback(() => {
    timeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
    timeoutsRef.current = [];

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

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
      const res = await requestJson<ModelsResponse>('/api/ai/models');
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

    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const res = await requestJson<GenerateResponse>('/api/ai/seo/generate', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
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
        }),
      });

      setResult(res.data);
      setUsedFields(new Set());
      setConfigured(true);
      transitionTo('result', 'forward');
      toast.success('SEO copy generated.');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;

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
      setLoading(false);
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
    if (!result) return;
    onApply({
      name: result.title,
      description: result.description,
      mobileDetailMarkdown: result.mobileDetailMarkdown,
      metaTitle: result.metaTitle,
      metaDescription: result.metaDescription,
      tags: result.tags,
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

  const configMissing =
    configured === false ||
    errorCode === 'GEMINI_CONFIG_MISSING' ||
    errorCode === 'GEMINI_AUTH_ERROR';

  const permissionDenied = errorCode === 'INSUFFICIENT_PERMISSION';

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
                      {result ? 'Regenerate' : 'Generate'}
                    </Button>
                    {result ? (
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

                {!result && !loading && !error && !permissionDenied ? (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Enter a focus keyword, choose a Gemini model, then generate
                    organised product title, description, mobile markdown, and
                    SEO metadata. Your product title and description are
                    included for better context.
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 'result' && result ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-3 border-b p-4">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={() => transitionTo('input', 'back')}
                    disabled={phase !== 'idle' || loading}
                    aria-label="Back to AI SEO inputs"
                    className="h-8 w-8 rounded-full"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">Generated copy</h3>
                    <p className="truncate text-xs text-muted-foreground">
                      Model: {result.model}. Results stay when you close this
                      sheet or edit inputs.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={loading}
                    onClick={applyAll}
                    className="shrink-0"
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Use all
                  </Button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  <ResultField
                    label="Product title"
                    hint={`${result.title.length} chars · Step 1`}
                    value={result.title}
                    used={usedFields.has('title')}
                    onUse={() => applyField('title', { name: result.title })}
                    onCopy={() => void copyText(result.title, 'Title')}
                  />

                  <ResultField
                    label="Product description"
                    hint={`${result.description.length} chars · Step 1`}
                    value={result.description}
                    multiline
                    used={usedFields.has('description')}
                    onUse={() =>
                      applyField('description', {
                        description: result.description,
                      })
                    }
                    onCopy={() =>
                      void copyText(result.description, 'Description')
                    }
                  />

                  <ResultField
                    label="Mobile description (Markdown)"
                    hint="Step 1 · markdown editor"
                    value={result.mobileDetailMarkdown}
                    multiline
                    markdown
                    used={usedFields.has('mobile')}
                    onUse={() =>
                      applyField('mobile', {
                        mobileDetailMarkdown: result.mobileDetailMarkdown,
                      })
                    }
                    onCopy={() =>
                      void copyText(
                        result.mobileDetailMarkdown,
                        'Mobile description'
                      )
                    }
                  />

                  <ResultField
                    label="Meta title"
                    hint={`${result.metaTitle.length}/70 recommended · Step 5 SEO`}
                    value={result.metaTitle}
                    used={usedFields.has('metaTitle')}
                    onUse={() =>
                      applyField('metaTitle', {
                        metaTitle: result.metaTitle.slice(0, 120),
                      })
                    }
                    onCopy={() => void copyText(result.metaTitle, 'Meta title')}
                  />

                  <ResultField
                    label="Meta description"
                    hint={`${result.metaDescription.length}/160 recommended · Step 5 SEO`}
                    value={result.metaDescription}
                    multiline
                    used={usedFields.has('metaDescription')}
                    onUse={() =>
                      applyField('metaDescription', {
                        metaDescription: result.metaDescription.slice(0, 320),
                      })
                    }
                    onCopy={() =>
                      void copyText(result.metaDescription, 'Meta description')
                    }
                  />

                  <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">Tags</p>
                        <p className="text-xs text-muted-foreground">
                          {result.tags.length} tags · Step 5 SEO
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2"
                          onClick={() =>
                            void copyText(result.tags.join(', '), 'Tags')
                          }
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            usedFields.has('tags') ? 'secondary' : 'default'
                          }
                          className="h-8"
                          onClick={() =>
                            applyField('tags', { tags: result.tags })
                          }
                        >
                          {usedFields.has('tags') ? (
                            <>
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Used
                            </>
                          ) : (
                            'Use'
                          )}
                        </Button>
                      </div>
                    </div>
                    {result.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {result.tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="text-xs"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No tags returned.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
