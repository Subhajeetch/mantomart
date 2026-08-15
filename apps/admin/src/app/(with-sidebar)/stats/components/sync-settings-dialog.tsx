'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { SyncResult, SyncStatus } from '../utils';
import {
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  formatRelative,
  requestJson,
} from '../utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onSynced: () => void;
};

function CheckRow({
  label,
  stored,
  live,
  money = false,
}: {
  label: string;
  stored: number;
  live: number;
  money?: boolean;
}) {
  const fmt = money ? formatMoney : formatNumber;
  const mismatch = stored !== live;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          Stored {fmt(stored)}
          <span className="mx-1.5">·</span>
          Live {fmt(live)}
        </p>
      </div>
      {mismatch ? (
        <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700 dark:text-amber-400">
          Drift
        </Badge>
      ) : (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          In sync
        </Badge>
      )}
    </div>
  );
}

export function SyncSettingsDialog({
  open,
  onOpenChange,
  canManage,
  onSynced,
}: Props) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await requestJson<{ success: true; data: SyncStatus }>(
        '/sync?drift=1'
      );
      setStatus(res.data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load sync status.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setLastResult(null);
      setError(null);
      return;
    }
    void loadStatus();
  }, [open, loadStatus]);

  async function handleSync() {
    if (!canManage || syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const res = await requestJson<{
        success: true;
        message?: string;
        data: { result: SyncResult };
      }>('/sync', {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      setLastResult(res.data.result);
      toast.success(res.message || 'Admin stats synced.');
      await loadStatus();
      onSynced();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to sync admin stats.';
      setError(message);
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  const job = status?.job;
  const drift = status?.drift;
  const running = Boolean(status?.running) || syncing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Stats settings</DialogTitle>
          <DialogDescription>
            Rebuild the leaderboard from live products, order counts, and
            revenue. Use this after importing products that predate the stats
            table.
          </DialogDescription>
        </DialogHeader>

        {!canManage && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>You can view sync status, but only users with manage permission can rebuild stats.</p>
          </div>
        )}

        {loading && !status ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading sync status…
          </div>
        ) : (
          <div className="space-y-4">
            <Card size="sm" className="bg-card/60">
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Last sync</p>
                  <Badge
                    variant={
                      job?.status === 'failed'
                        ? 'destructive'
                        : job?.status === 'success'
                          ? 'secondary'
                          : 'outline'
                    }
                    className="text-[10px] capitalize"
                  >
                    {job?.status ?? 'idle'}
                  </Badge>
                </div>
                <dl className="grid gap-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">When</dt>
                    <dd className="text-right">
                      {formatRelative(job?.lastSuccessAt)}
                      {job?.lastSuccessAt && (
                        <span className="text-muted-foreground mt-0.5 block text-xs">
                          {formatDateTime(job.lastSuccessAt)}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Triggered by</dt>
                    <dd>{job?.triggeredByName || '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Duration</dt>
                    <dd className="tabular-nums">
                      {job?.lastSuccessAt ? formatDuration(job.durationMs) : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Admins updated</dt>
                    <dd className="tabular-nums">
                      {formatNumber(job?.adminsUpdated ?? 0)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Products scanned</dt>
                    <dd className="tabular-nums">
                      {formatNumber(job?.productsScanned ?? 0)}
                    </dd>
                  </div>
                </dl>
                {job?.status === 'failed' && job.error && (
                  <p className="text-destructive text-xs">{job.error}</p>
                )}
              </CardContent>
            </Card>

            <div className="space-y-2">
              <p className="text-sm font-medium">Live vs stored</p>
              <p className="text-muted-foreground text-xs">
                Sync reads products in one grouped query, then writes one row
                per admin. Order and revenue come from product counters until
                an orders table exists.
              </p>
              {drift ? (
                <div className="grid gap-2">
                  <CheckRow
                    label="Products added"
                    stored={drift.stored.productsAdded}
                    live={drift.live.productsAdded}
                  />
                  <CheckRow
                    label="Orders"
                    stored={drift.stored.ordersCount}
                    live={drift.live.ordersCount}
                  />
                  <CheckRow
                    label="Products with orders"
                    stored={drift.stored.productsWithOrders}
                    live={drift.live.productsWithOrders}
                  />
                  <CheckRow
                    label="Revenue"
                    stored={drift.stored.revenueCents}
                    live={drift.live.revenueCents}
                    money
                  />
                  <CheckRow
                    label="Estimated profit"
                    stored={drift.stored.profitCents}
                    live={drift.live.profitCents}
                    money
                  />
                  {drift.live.unattributedProducts > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <p>
                        {formatNumber(drift.live.unattributedProducts)} product
                        {drift.live.unattributedProducts === 1 ? '' : 's'} have
                        no added-by admin and will not count toward anyone.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Drift details unavailable.
                </p>
              )}
            </div>

            {lastResult && (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-sm text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <p>
                  Rebuilt {formatNumber(lastResult.adminsUpdated)} admin
                  {lastResult.adminsUpdated === 1 ? '' : 's'} from{' '}
                  {formatNumber(lastResult.productsScanned)} product
                  {lastResult.productsScanned === 1 ? '' : 's'}.
                </p>
              </div>
            )}

            {error && (
              <p className="text-destructive text-sm">{error}</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadStatus()}
            disabled={loading || syncing}
            className="gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Recheck
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            {canManage && (
              <Button
                size="sm"
                onClick={() => void handleSync()}
                disabled={running || loading}
                className="gap-1.5"
              >
                {running ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {running ? 'Syncing…' : 'Sync now'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
