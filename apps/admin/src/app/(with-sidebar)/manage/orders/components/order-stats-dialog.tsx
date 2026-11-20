'use client';

import {
  AlertCircle,
  CreditCard,
  DollarSign,
  Loader2,
  RefreshCw,
  ShoppingBag,
  Truck,
} from 'lucide-react';

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
import { Badge } from '@/components/ui/badge';
import type { OrderStats } from '../types';
import { formatMoney } from '../utils';

interface OrderStatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: OrderStats | null;
  loading: boolean;
  onRefresh?: () => void;
}

function StatCard({
  icon,
  label,
  value,
  subLabel,
  iconClassName,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  subLabel?: string;
  iconClassName?: string;
}) {
  return (
    <Card size="sm" className="bg-card/60 p-3 shadow-xs">
      <CardContent className="flex items-center gap-3 p-0">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
            iconClassName ?? 'bg-primary/10 text-primary'
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            {label}
          </p>
          <div className="text-lg font-bold tabular-nums text-foreground">
            {value}
          </div>
          {subLabel && (
            <p className="text-[11px] text-muted-foreground truncate">{subLabel}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function OrderStatsDialog({
  open,
  onOpenChange,
  stats,
  loading,
  onRefresh,
}: OrderStatsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <ShoppingBag className="size-5 text-primary" />
            Order Statistics
          </DialogTitle>
          <DialogDescription>
            Live overview of sales, revenues, and fulfillment metrics.
          </DialogDescription>
        </DialogHeader>

        {loading && !stats ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary mb-3" />
            <p className="text-sm font-medium">Loading order statistics...</p>
            <p className="text-xs text-muted-foreground/80 mt-1">
              Fetching latest revenue and fulfillment data...
            </p>
          </div>
        ) : stats ? (
          <div className="space-y-4 py-2">
            {/* Top Key Metrics */}
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard
                icon={<ShoppingBag className="size-5" />}
                label="Total Orders"
                value={stats.totalOrders.toLocaleString()}
                subLabel="Customer purchases placed"
              />
              <StatCard
                icon={<DollarSign className="size-5" />}
                label="Total Revenue"
                value={formatMoney(stats.totalRevenueCents)}
                subLabel="Settled paid order revenue"
                iconClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              />
              <StatCard
                icon={<Truck className="size-5" />}
                label="Pending Fulfillment"
                value={
                  <div className="flex items-center gap-2">
                    <span>{stats.unfulfilledCount.toLocaleString()}</span>
                    {stats.unfulfilledCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px]"
                      >
                        Action Needed
                      </Badge>
                    )}
                  </div>
                }
                subLabel="Awaiting shipment or processing"
                iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
              />
              <StatCard
                icon={<CreditCard className="size-5" />}
                label="Awaiting Payment"
                value={stats.pendingPaymentCount.toLocaleString()}
                subLabel="Pending authorization"
                iconClassName="bg-blue-500/10 text-blue-600 dark:text-blue-400"
              />
            </div>

            {/* Status Breakdown Section */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Orders by Status
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                <div className="rounded-md border bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">Ordered</p>
                  <p className="text-base font-bold tabular-nums text-foreground">
                    {stats.byStatus.ordered || 0}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">Processing</p>
                  <p className="text-base font-bold tabular-nums text-foreground">
                    {stats.byStatus.processing || 0}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">Fulfilled</p>
                  <p className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {stats.byStatus.fulfilled || 0}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/30 p-2">
                  <p className="text-xs text-muted-foreground">Cancelled</p>
                  <p className="text-base font-bold tabular-nums text-destructive">
                    {stats.byStatus.cancelled || 0}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/30 p-2 col-span-2 sm:col-span-1">
                  <p className="text-xs text-muted-foreground">Refunded</p>
                  <p className="text-base font-bold tabular-nums text-purple-600 dark:text-purple-400">
                    {stats.byStatus.refunded || 0}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <AlertCircle className="size-8 text-destructive/80 mb-2" />
            <p className="text-sm font-medium">Failed to load statistics.</p>
            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                className="mt-3 text-xs"
              >
                Try Again
              </Button>
            )}
          </div>
        )}

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw
                className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              Refresh Stats
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
