'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  BarChart3,
  Copy,
  ExternalLink,
  Loader2,
  Search,
  TrendingUp,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type KeywordIdea = {
  keyword: string;
  avgMonthlySearches: number | null;
  competition: string | null;
  competitionIndex: number | null;
  monthlySearchVolumes?: Array<{
    year: number | null;
    month: string | null;
    monthlySearches: number | null;
  }>;
};

type ResearchResponse = {
  success: true;
  data: {
    keywords: KeywordIdea[];
    totalResults: number;
    seed: { keywords: string[]; url: string | null };
    geoTargetIds: string[];
    languageId: string;
  };
};

type StatusResponse = {
  success?: boolean;
  connected: boolean;
  expires_at?: number | null;
  is_expired?: boolean;
};

type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const GEO_OPTIONS = [
  { id: '2840', label: 'United States' },
  { id: '2826', label: 'United Kingdom' },
  { id: '2124', label: 'Canada' },
  { id: '2036', label: 'Australia' },
  { id: '2276', label: 'Germany' },
  { id: '2250', label: 'France' },
  { id: '2356', label: 'India' },
  { id: '2554', label: 'New Zealand' },
] as const;

const LANG_OPTIONS = [
  { id: '1000', label: 'English' },
  { id: '1001', label: 'German' },
  { id: '1002', label: 'French' },
  { id: '1003', label: 'Spanish' },
  { id: '1009', label: 'Portuguese' },
  { id: '1010', label: 'Chinese (simplified)' },
] as const;

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

function formatVolume(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

function competitionBadgeVariant(
  competition: string | null
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const c = (competition || '').toUpperCase();
  if (c === 'HIGH') return 'destructive';
  if (c === 'MEDIUM') return 'default';
  if (c === 'LOW') return 'secondary';
  return 'outline';
}

function competitionLabel(competition: string | null) {
  if (!competition) return '—';
  const c = competition.replace(/^KEYWORD_PLAN_COMPETITION_/, '');
  if (c === 'UNSPECIFIED' || c === 'UNKNOWN') return '—';
  return c.charAt(0) + c.slice(1).toLowerCase();
}

// ─── Component ────────────────────────────────────────────────────────────────

export type KeywordResearchSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill seed from product title when opening. */
  initialKeyword?: string;
};

export default function KeywordResearchSheet({
  open,
  onOpenChange,
  initialKeyword = '',
}: KeywordResearchSheetProps) {
  const [query, setQuery] = useState(initialKeyword);
  const [geo, setGeo] = useState<string>('2840');
  const [lang, setLang] = useState<string>('1000');
  const [results, setResults] = useState<KeywordIdea[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [sortKey, setSortKey] = useState<'volume' | 'competition' | 'keyword'>(
    'volume'
  );

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const data = await requestJson<StatusResponse>('/api/google/status');
      setConnected(Boolean(data.connected) && !data.is_expired);
    } catch {
      // Status failure should not block the sheet — research will surface auth errors.
      setConnected(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery((prev) => (prev.trim() ? prev : initialKeyword));
    setError(null);
    setErrorCode(null);
    void loadStatus();
  }, [open, initialKeyword, loadStatus]);

  const sortedResults = useMemo(() => {
    const list = [...results];
    list.sort((a, b) => {
      if (sortKey === 'keyword') {
        return a.keyword.localeCompare(b.keyword);
      }
      if (sortKey === 'competition') {
        return (b.competitionIndex ?? -1) - (a.competitionIndex ?? -1);
      }
      return (b.avgMonthlySearches ?? -1) - (a.avgMonthlySearches ?? -1);
    });
    return list;
  }, [results, sortKey]);

  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const seed = query.trim();
    if (!seed) {
      setError('Enter a keyword to research.');
      setErrorCode('MISSING_SEED');
      return;
    }

    setLoading(true);
    setError(null);
    setErrorCode(null);
    setSearched(true);

    try {
      const res = await requestJson<ResearchResponse>(
        '/api/google/keywords/research',
        {
          method: 'POST',
          body: JSON.stringify({
            keywords: [seed],
            geoTargetIds: [geo],
            languageId: lang,
            pageSize: 50,
          }),
        }
      );

      setResults(res.data.keywords ?? []);
      setConnected(true);
      if ((res.data.keywords ?? []).length === 0) {
        toast.message('No keyword ideas returned for that seed.');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Keyword research failed.';
      const code = err instanceof ApiError ? (err.code ?? null) : null;
      setError(message);
      setErrorCode(code);
      setResults([]);

      if (
        code === 'GOOGLE_ADS_NOT_CONNECTED' ||
        code === 'GOOGLE_ADS_AUTH_EXPIRED' ||
        code === 'GOOGLE_ADS_CONFIG_MISSING'
      ) {
        setConnected(false);
      }

      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const copyKeyword = async (keyword: string) => {
    try {
      await navigator.clipboard.writeText(keyword);
      toast.success('Keyword copied.');
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  };

  const needsConnect =
    connected === false ||
    errorCode === 'GOOGLE_ADS_NOT_CONNECTED' ||
    errorCode === 'GOOGLE_ADS_AUTH_EXPIRED' ||
    errorCode === 'GOOGLE_ADS_CONFIG_MISSING';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="z-[60] flex w-full flex-col gap-0 p-0 sm:max-w-xl"
        showCloseButton
      >
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Keyword research
          </SheetTitle>
          <SheetDescription className="sr-only">
            Search volumes and related ideas via Google Keyword Planner. Use
            results to refine product titles and tags.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {statusLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking Google Ads connection…
            </div>
          ) : null}

          {needsConnect ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Google Ads not ready</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  {error ||
                    'Connect Google Ads (with Keyword Planner access) to research keywords.'}
                </p>
                <Button asChild size="sm" variant="outline">
                  <Link href="/connections">
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    Open integrations
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={runSearch} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="kw-query">Seed keyword</Label>
              <div className="flex gap-2">
                <Input
                  id="kw-query"
                  value=""
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. wireless earbuds"
                  maxLength={80}
                  disabled={loading}
                  autoFocus
                />
                <Button type="submit" disabled={loading || !query.trim()}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  <span className="ml-2 hidden sm:inline">Search</span>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Select value={geo} onValueChange={setGeo} disabled={loading}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Location" />
                  </SelectTrigger>
                  <SelectContent className="z-[70]">
                    {GEO_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Select value={lang} onValueChange={setLang} disabled={loading}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Language" />
                  </SelectTrigger>
                  <SelectContent className="z-[70]">
                    {LANG_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </form>

          {error && !needsConnect ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Research failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {searched && !loading && results.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  <BarChart3 className="mr-1 inline h-3.5 w-3.5" />
                  {results.length} idea{results.length === 1 ? '' : 's'}
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Sort</span>
                  <div className="flex rounded-md border p-0.5">
                    {(
                      [
                        ['volume', 'Volume'],
                        ['competition', 'Competition'],
                        ['keyword', 'A–Z'],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSortKey(key)}
                        className={cn(
                          'rounded px-2 py-1 transition',
                          sortKey === key
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Keyword</TableHead>
                      <TableHead className="text-right">Vol / mo</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">
                        Competition
                      </TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedResults.map((row) => (
                      <TableRow key={row.keyword}>
                        <TableCell className="max-w-[160px] font-medium">
                          <span className="line-clamp-2">{row.keyword}</span>
                          <div className="mt-1 sm:hidden">
                            <Badge
                              variant={competitionBadgeVariant(row.competition)}
                              className="text-[10px]"
                            >
                              {competitionLabel(row.competition)}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatVolume(row.avgMonthlySearches)}
                        </TableCell>
                        <TableCell className="hidden text-right sm:table-cell">
                          <Badge
                            variant={competitionBadgeVariant(row.competition)}
                            className="text-[10px]"
                          >
                            {competitionLabel(row.competition)}
                            {row.competitionIndex != null
                              ? ` · ${row.competitionIndex}`
                              : ''}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              title="Copy keyword"
                              onClick={() => void copyKeyword(row.keyword)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          {searched && !loading && results.length === 0 && !error ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No keyword ideas found. Try a broader seed keyword.
            </div>
          ) : null}

          {!searched && !loading && !needsConnect ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Enter a product-related keyword to see monthly search volume,
              competition, and related ideas from Keyword Planner.
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
