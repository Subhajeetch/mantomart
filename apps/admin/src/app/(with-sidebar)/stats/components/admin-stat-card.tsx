import { Ban, Crown, Medal, Package, Shield, ShoppingBag, Users } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { AdminStatRow, StatsSort } from '../utils';
import {
  formatMoney,
  formatNumber,
  formatRelative,
  getInitials,
  metricValue,
  primaryMetric,
  primaryMetricLabel,
} from '../utils';

function RoleBadge({ role }: { role: string }) {
  if (role === 'owner') {
    return (
      <Badge className="gap-1 bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-400">
        <Crown className="size-3" />
        Owner
      </Badge>
    );
  }
  if (role === 'admin') {
    return (
      <Badge className="gap-1 bg-sky-500/15 text-sky-700 ring-1 ring-sky-500/25 dark:text-sky-400">
        <Shield className="size-3" />
        Admin
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Users className="size-3" />
      Former
    </Badge>
  );
}

function RankMark({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 ring-1 ring-amber-500/25 dark:text-amber-400">
        <Medal className="size-4" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-400/15 text-slate-600 ring-1 ring-slate-400/30 dark:text-slate-300">
        <Medal className="size-4" />
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-orange-600/10 text-orange-700 ring-1 ring-orange-500/25 dark:text-orange-400">
        <Medal className="size-4" />
      </div>
    );
  }
  return (
    <div className="text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
      {rank}
    </div>
  );
}

export function AdminStatCardSkeleton() {
  return (
    <Card size="sm" className="overflow-hidden">
      <CardContent className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="size-11 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-1.5 w-full" />
        </div>
        <Skeleton className="h-8 w-16" />
      </CardContent>
    </Card>
  );
}

export function AdminStatCard({
  row,
  sort,
  isSelf,
  leaderValue,
}: {
  row: AdminStatRow;
  sort: StatsSort;
  isSelf: boolean;
  leaderValue: number;
}) {
  const value = metricValue(row, sort);
  const pct =
    leaderValue > 0 ? Math.min(100, Math.round((value / leaderValue) * 100)) : 0;

  return (
    <Card
      size="sm"
      className={cn(
        'relative overflow-hidden transition-shadow hover:shadow-md',
        isSelf && 'ring-1 ring-primary/30',
        row.rank === 1 && 'ring-1 ring-amber-500/20'
      )}
    >
      {row.rank === 1 && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500" />
      )}

      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <RankMark rank={row.rank} />

          <Avatar className="size-11 ring-2 ring-background shadow-sm">
            <AvatarImage src={row.image ?? undefined} alt={row.name} />
            <AvatarFallback className="bg-muted text-sm font-semibold">
              {getInitials(row.name || row.email)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate font-medium leading-tight">{row.name}</p>
              {isSelf && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  You
                </Badge>
              )}
              {row.isBanned && (
                <Badge variant="destructive" className="gap-1 text-[10px]">
                  <Ban className="size-3" />
                  Banned
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {row.email}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <RoleBadge role={row.role} />
              {!row.isStaff && !row.isDeleted && (
                <Badge variant="outline" className="text-[10px]">
                  Contributor
                </Badge>
              )}
              {row.isDeleted && (
                <Badge variant="outline" className="text-[10px]">
                  Deleted
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-[220px] sm:items-end">
          <div className="text-left sm:text-right">
            <p className="text-xl font-semibold tabular-nums leading-none">
              {primaryMetric(row, sort)}
            </p>
            <p className="text-muted-foreground mt-1 text-[11px] uppercase tracking-wide">
              {primaryMetricLabel(sort)}
            </p>
          </div>

          <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs sm:justify-end">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Package className="size-3" />
              {formatNumber(row.productsAdded)}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <ShoppingBag className="size-3" />
              {formatNumber(row.ordersCount)}
            </span>
            <span className="tabular-nums">{formatMoney(row.revenueCents)}</span>
          </div>

          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                'h-full rounded-full transition-[width]',
                row.rank === 1
                  ? 'bg-amber-500'
                  : row.rank === 2
                    ? 'bg-slate-400'
                    : row.rank === 3
                      ? 'bg-orange-500/80'
                      : 'bg-primary/70'
              )}
              style={{ width: `${pct}%` }}
            />
          </div>

          <p className="text-muted-foreground text-[11px]">
            {row.lastProductAddedAt
              ? `Last product ${formatRelative(row.lastProductAddedAt)}`
              : 'No products yet'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
