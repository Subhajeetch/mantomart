'use client';

import { Ban, Crown, Shield, UserCheck, Users } from 'lucide-react';

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

import type { UserStats } from '../utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: UserStats | null;
  loading: boolean;
};

function StatCard({
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
          className={`flex size-9 items-center justify-center rounded-lg ${iconClassName ?? 'bg-primary/10 text-primary'}`}
        >
          {icon}
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{label}</p>
          <p className="text-lg font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function UserStatsDialog({ open, onOpenChange, stats, loading }: Props) {
  const placeholder = loading ? '—' : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>User Statistics</DialogTitle>
          <DialogDescription>
            Overview of all registered accounts.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            icon={<Users className="size-4" />}
            label="Total Users"
            value={loading ? placeholder : (stats?.total?.toString() ?? placeholder)}
          />
          <StatCard
            icon={<UserCheck className="size-4" />}
            label="Active"
            value={loading ? placeholder : (stats?.active?.toString() ?? placeholder)}
            iconClassName="bg-green-500/10 text-green-600 dark:text-green-400"
          />
          <StatCard
            icon={<Ban className="size-4" />}
            label="Banned"
            value={loading ? placeholder : (stats?.banned?.toString() ?? placeholder)}
            iconClassName="bg-destructive/10 text-destructive"
          />
          <StatCard
            icon={<Crown className="size-4" />}
            label="Admins & Owners"
            value={
              loading
                ? placeholder
                : String((stats?.byRole?.admin ?? 0) + (stats?.byRole?.owner ?? 0))
            }
            iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <StatCard
            icon={<UserCheck className="size-4" />}
            label="Customers"
            value={loading ? placeholder : (stats?.byRole?.customer?.toString() ?? placeholder)}
            iconClassName="bg-muted text-muted-foreground"
          />
          <StatCard
            icon={<Shield className="size-4" />}
            label="Admins"
            value={loading ? placeholder : (stats?.byRole?.admin?.toString() ?? placeholder)}
            iconClassName="bg-sky-500/10 text-sky-600 dark:text-sky-400"
          />
          <StatCard
            icon={<Crown className="size-4" />}
            label="Owners"
            value={loading ? placeholder : (stats?.byRole?.owner?.toString() ?? placeholder)}
            iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}