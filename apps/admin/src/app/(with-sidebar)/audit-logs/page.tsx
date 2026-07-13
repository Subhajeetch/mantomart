'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Database,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

import {
  AuditLogCardSkeleton,
  AuditLogGroupCard,
} from './components/audit-log-group';
import { AuditLogDetailDialog } from './components/audit-log-detail-dialog';
import {
  groupAuditLogs,
  requestJson,
  type AuditLog,
  type AuditMeta,
  type AuditSeverity,
  type AuditStats,
  type AuditStatus,
  type ListMeta,
} from './utils';

const PAGE_SIZE = 25;

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [catalog, setCatalog] = useState<AuditMeta | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<AuditSeverity | 'all'>(
    'all'
  );
  const [statusFilter, setStatusFilter] = useState<AuditStatus | 'all'>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<AuditLog | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [categoryFilter, severityFilter, statusFilter, actionFilter]);

  const loadLogs = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (page > 1) params.set('page', String(page));
        params.set('pageSize', String(PAGE_SIZE));
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (categoryFilter !== 'all') params.set('category', categoryFilter);
        if (severityFilter !== 'all') params.set('severity', severityFilter);
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (actionFilter !== 'all') params.set('action', actionFilter);

        const qs = params.toString();
        const res = await requestJson<{
          success: true;
          data: AuditLog[];
          meta: ListMeta;
        }>(`/all${qs ? `?${qs}` : ''}`);

        setLogs(res.data);
        setMeta(res.meta);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load audit logs.';
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      page,
      debouncedSearch,
      categoryFilter,
      severityFilter,
      statusFilter,
      actionFilter,
    ]
  );

  const loadStats = useCallback(async () => {
    try {
      const res = await requestJson<{ success: true; data: AuditStats }>(
        '/stats'
      );
      setStats(res.data);
    } catch (err) {
      console.error('Failed to load audit stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await requestJson<{ success: true; data: AuditMeta }>(
        '/meta'
      );
      setCatalog(res.data);
    } catch (err) {
      console.error('Failed to load audit meta:', err);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    void loadStats();
    void loadCatalog();
  }, [loadStats, loadCatalog]);

  const categories = catalog?.usedCategories?.length
    ? catalog.usedCategories
    : (catalog?.knownCategories ?? []);
  const actions = catalog?.usedActions?.length
    ? catalog.usedActions
    : (catalog?.knownActions ?? []);

  const hasFilters =
    !!debouncedSearch ||
    categoryFilter !== 'all' ||
    severityFilter !== 'all' ||
    statusFilter !== 'all' ||
    actionFilter !== 'all';

  const groups = useMemo(() => groupAuditLogs(logs), [logs]);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-7"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Audit Logs</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="sr-only text-2xl font-semibold tracking-tight">
              Audit Logs
            </h1>
            <p className="text-muted-foreground max-w-xl text-sm">
              Who changed what, when, and from where. Only the latest{' '}
              {stats?.maxEntries ?? meta?.maxEntries ?? 1000} entries are kept.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void loadLogs(true);
                void loadStats();
                void loadCatalog();
              }}
              disabled={loading || refreshing}
              className="gap-1.5"
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-3">
              <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                <ScrollText className="size-4" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Stored entries</p>
                <p className="text-lg font-semibold tabular-nums">
                  {statsLoading ? '—' : (stats?.total ?? '—')}
                  <span className="text-muted-foreground ml-1 text-xs font-normal">
                    / {stats?.maxEntries ?? 1000}
                  </span>
                </p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-3">
              <div className="bg-destructive/10 text-destructive flex size-9 items-center justify-center rounded-lg">
                <AlertTriangle className="size-4" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Critical</p>
                <p className="text-lg font-semibold tabular-nums">
                  {statsLoading ? '—' : (stats?.critical ?? '—')}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <ShieldAlert className="size-4" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Warnings</p>
                <p className="text-lg font-semibold tabular-nums">
                  {statsLoading ? '—' : (stats?.bySeverity?.warning ?? 0)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Database className="size-4" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Capacity left</p>
                <p className="text-lg font-semibold tabular-nums">
                  {statsLoading ? '—' : (stats?.remaining ?? '—')}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3">
          <div className="relative max-w-md flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              type="search"
              placeholder="Search description, actor, target, action…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={severityFilter}
              onValueChange={(v) =>
                setSeverityFilter(v as AuditSeverity | 'all')
              }
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as AuditStatus | 'all')}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failure">Failure</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
              </SelectContent>
            </Select>

            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {actions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchInput('');
                  setDebouncedSearch('');
                  setCategoryFilter('all');
                  setSeverityFilter('all');
                  setStatusFilter('all');
                  setActionFilter('all');
                  setPage(1);
                }}
              >
                Reset filters
              </Button>
            )}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <AuditLogCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <ShieldAlert className="text-destructive size-8" />
              <div>
                <p className="font-medium">Could not load audit logs</p>
                <p className="text-muted-foreground mt-1 text-sm">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadLogs()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : logs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="bg-muted flex size-12 items-center justify-center rounded-full">
                <ScrollText className="text-muted-foreground size-6" />
              </div>
              <div>
                <p className="font-medium">No audit logs found</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {hasFilters
                    ? 'Try adjusting your filters.'
                    : 'Admin actions will appear here as they happen.'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="bg-card/40 overflow-hidden py-0">
              <div className="divide-y">
                {groups.map((group) => (
                  <AuditLogGroupCard
                    key={group.id}
                    group={group}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            </Card>

            {logs.length > 0 && groups.length < logs.length ? (
              <p className="text-muted-foreground text-center text-xs">
                Showing {groups.length} group
                {groups.length === 1 ? '' : 's'} from {logs.length} event
                {logs.length === 1 ? '' : 's'} on this page
              </p>
            ) : null}

            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={meta.page <= 1 || loading}
                >
                  Previous
                </Button>
                <span className="text-muted-foreground text-sm tabular-nums">
                  Page {meta.page} of {meta.totalPages}
                  <span className="ml-2 opacity-70">({meta.total} total)</span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPage((p) => Math.min(meta.totalPages, p + 1))
                  }
                  disabled={meta.page >= meta.totalPages || loading}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      <AuditLogDetailDialog
        log={selected}
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}
