import { Ban, Crown, Package, Shield, ShoppingBag, Users } from 'lucide-react';

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
  const safeRank = Number.isFinite(rank) && rank > 0 ? Math.floor(rank) : null;
  const colorClass =
    safeRank === 1
      ? 'text-amber-500 dark:text-amber-400'
      : safeRank === 2
        ? 'text-slate-400 dark:text-slate-300'
        : safeRank === 3
          ? 'text-orange-700 dark:text-orange-400'
          : 'text-muted-foreground';
  const label = safeRank ? `Rank ${safeRank}` : 'Unranked';

  return (
    <svg
      aria-label={label}
      className={cn('size-11 shrink-0', colorClass)}
      role="img"
      viewBox="0 0 64 64"
    >
      <path
        d="M30 57C17 52 9 42 8 28C8 17 15 8 27 4M34 57c13-5 21-15 22-29C56 17 49 8 37 4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
      <g fill="currentColor">
        <g>
          <path d="M10 43C6 41 4 38 4 34C8 35 11 38 10 43Z" />
          <path d="M8 36C4 34 2.5 30 3 26C7 27 10 31 8 36Z" />
          <path d="M8 29C4.5 27 3.5 23 5 19C8.5 21 10 25 8 29Z" />
          <path d="M10 22C7 19 7 15 9 11.5C12 14 13 18 10 22Z" />
          <path d="M14 16C11.5 12 12 8.5 15 5.5C17.5 9 17 13 14 16Z" />
          <path d="M19 11C17 7 18 4 21 1.5C23 5 22 8.5 19 11Z" />
          <path d="M24.5 8C23 4.5 24.5 1.5 27.5 0C29 3.5 28 6.5 24.5 8Z" />
          <path d="M12 41C15 37 19 36 22 38C20 42 16 44 12 41Z" />
          <path d="M9 34C12 30 16 29.5 19 32C17 36 13 37 9 34Z" />
          <path d="M9 27C12 23 16 22.5 19 25C17 29 13 30 9 27Z" />
          <path d="M11 20C14 16 18 15.5 21 18C19 22 15 23 11 20Z" />
          <path d="M15 14C18 10.5 21.5 10 24 12.5C22 16 18.5 17 15 14Z" />
          <path d="M20 9C23 6 26 6 28 8.5C25.5 11 22.5 11.5 20 9Z" />
        </g>
        <g transform="translate(64 0) scale(-1 1)">
          <path d="M10 43C6 41 4 38 4 34C8 35 11 38 10 43Z" />
          <path d="M8 36C4 34 2.5 30 3 26C7 27 10 31 8 36Z" />
          <path d="M8 29C4.5 27 3.5 23 5 19C8.5 21 10 25 8 29Z" />
          <path d="M10 22C7 19 7 15 9 11.5C12 14 13 18 10 22Z" />
          <path d="M14 16C11.5 12 12 8.5 15 5.5C17.5 9 17 13 14 16Z" />
          <path d="M19 11C17 7 18 4 21 1.5C23 5 22 8.5 19 11Z" />
          <path d="M24.5 8C23 4.5 24.5 1.5 27.5 0C29 3.5 28 6.5 24.5 8Z" />
          <path d="M12 41C15 37 19 36 22 38C20 42 16 44 12 41Z" />
          <path d="M9 34C12 30 16 29.5 19 32C17 36 13 37 9 34Z" />
          <path d="M9 27C12 23 16 22.5 19 25C17 29 13 30 9 27Z" />
          <path d="M11 20C14 16 18 15.5 21 18C19 22 15 23 11 20Z" />
          <path d="M15 14C18 10.5 21.5 10 24 12.5C22 16 18.5 17 15 14Z" />
          <path d="M20 9C23 6 26 6 28 8.5C25.5 11 22.5 11.5 20 9Z" />
        </g>
      </g>
      <text
        x="32"
        y="39"
        fill="currentColor"
        fontFamily="inherit"
        fontSize="24"
        fontWeight="800"
        textAnchor="middle"
      >
        {safeRank ?? '—'}
      </text>
    </svg>
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
    leaderValue > 0
      ? Math.min(100, Math.round((value / leaderValue) * 100))
      : 0;

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
            <span className="tabular-nums">
              {formatMoney(row.revenueCents)}
            </span>
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
