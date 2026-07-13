'use client';

import { Crown, Shield, Users } from 'lucide-react';

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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  ownerCount: number;
  adminCount: number;
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

export function AdminStatsDialog({
  open,
  onOpenChange,
  total,
  ownerCount,
  adminCount,
  loading,
}: Props) {
  const placeholder = loading ? '—' : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Admin Statistics</DialogTitle>
          <DialogDescription>
            Team members with elevated access.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            icon={<Users className="size-4" />}
            label="Total"
            value={loading ? placeholder : String(total)}
          />
          <StatCard
            icon={<Crown className="size-4" />}
            label="Owners"
            value={loading ? placeholder : String(ownerCount)}
            iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          />
          <StatCard
            icon={<Shield className="size-4" />}
            label="Admins"
            value={loading ? placeholder : String(adminCount)}
            iconClassName="bg-sky-500/10 text-sky-600 dark:text-sky-400"
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