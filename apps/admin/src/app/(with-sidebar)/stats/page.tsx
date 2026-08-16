'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChartColumn,
  Info,
  Package,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Wallet,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import {
  AdminStatCard,
  AdminStatCardSkeleton,
} from './components/admin-stat-card';
import { SyncSettingsDialog } from './components/sync-settings-dialog';
import type { AdminStatRow, ListMeta, StatsSort } from './utils';
import {
  SORT_OPTIONS,
  formatMoney,
  formatNumber,
  metricValue,
  requestJson,
} from './utils';

function SummaryCard({
  icon,
  label,
  value,
  iconClassName,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  iconClassName?: string;
}) {
  return (
    <Card size="sm" className="bg-card/60">
      <CardContent className="flex items-center gap-3">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            iconClassName ?? 'bg-primary/10 text-primary'
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">{label}</p>
          <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminStatsPage() {
  const [rows, setRows] = useState<AdminStatRow[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [sort, setSort] = useState<StatsSort>('products');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadStats = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('sort', sort);
        if (debouncedSearch) params.set('search', debouncedSearch);

        const res = await requestJson<{
          success: true;
          data: AdminStatRow[];
          meta: ListMeta;
        }>(`/all?${params.toString()}`);

        setRows(res.data);
        setMeta(res.meta);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load admin stats.';
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [sort, debouncedSearch]
  );

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const canManage = meta?.canManage ?? false;
  const currentUserId = meta?.currentUserId ?? '';
  const totals = meta?.totals;
  const leaderValue = useMemo(() => {
    if (rows.length === 0) return 0;
    return Math.max(...rows.map((row) => metricValue(row, sort)));
  }, [rows, sort]);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex flex-1 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-7"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Admin Stats</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        {canManage && (
          <div className="pr-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Stats settings"
                >
                  <Settings className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sync settings</TooltipContent>
            </Tooltip>
          </div>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="sr-only text-2xl font-semibold tracking-tight">
              Admin Stats
            </h1>
            <p className="text-muted-foreground max-w-xl text-sm">
              Rank admins by products they added, orders those products
              received, or revenue from those orders.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <div className="flex flex-wrap items-center gap-2">
              {SORT_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  variant={sort === option.value ? 'default' : 'outline'}
                  onClick={() => setSort(option.value)}
                  aria-pressed={sort === option.value}
                >
                  {option.shortLabel}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadStats(true)}
                disabled={loading || refreshing}
                className="gap-1.5"
              >
                <RefreshCw
                  className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
                />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInfoOpen(true)}
                className="gap-1.5"
              >
                <Info className="size-3.5" />
                Info
              </Button>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            placeholder="Search name or email…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <AdminStatCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <ShieldAlert className="text-destructive size-8" />
              <div>
                <p className="font-medium">Could not load admin stats</p>
                <p className="text-muted-foreground mt-1 text-sm">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadStats()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="bg-muted flex size-12 items-center justify-center rounded-full">
                <ChartColumn className="text-muted-foreground size-6" />
              </div>
              <div>
                <p className="font-medium">
                  {debouncedSearch ? 'No matching admins' : 'No stats yet'}
                </p>
                <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                  {debouncedSearch
                    ? 'Try a different name or email.'
                    : canManage
                      ? 'Products already in the catalog are not counted until you sync.'
                      : 'Ask an owner to sync admin stats from existing products.'}
                </p>
              </div>
              {canManage && !debouncedSearch && (
                <Button
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                  className="gap-1.5"
                >
                  <Settings className="size-3.5" />
                  Open sync settings
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((row) => (
              <AdminStatCard
                key={row.userId}
                row={row}
                sort={sort}
                isSelf={row.userId === currentUserId}
                leaderValue={leaderValue}
              />
            ))}
          </div>
        )}
      </main>

      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Info</DialogTitle>
            <DialogDescription>
              Totals across contributors on this leaderboard.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryCard
              icon={<ChartColumn className="size-4" />}
              label="Contributors"
              value={totals ? formatNumber(totals.contributors) : '—'}
            />
            <SummaryCard
              icon={<Package className="size-4" />}
              label="Products added"
              value={totals ? formatNumber(totals.productsAdded) : '—'}
              iconClassName="bg-sky-500/10 text-sky-600 dark:text-sky-400"
            />
            <SummaryCard
              icon={<ShoppingBag className="size-4" />}
              label="Orders"
              value={totals ? formatNumber(totals.ordersCount) : '—'}
              iconClassName="bg-violet-500/10 text-violet-600 dark:text-violet-400"
            />
            <SummaryCard
              icon={<Wallet className="size-4" />}
              label="Revenue"
              value={totals ? formatMoney(totals.revenueCents) : '—'}
              iconClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            />
          </div>
        </DialogContent>
      </Dialog>

      {canManage && (
        <SyncSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          canManage={canManage}
          onSynced={() => void loadStats(true)}
        />
      )}
    </>
  );
}
