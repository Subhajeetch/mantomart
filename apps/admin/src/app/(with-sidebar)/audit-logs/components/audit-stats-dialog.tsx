'use client';

import { AlertTriangle, Database, ScrollText, ShieldAlert } from 'lucide-react';

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

import type { AuditStats } from '../utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: AuditStats | null;
  loading: boolean;
};

function StatCard({
  icon,
  label,
  value,
  subtitle,
  iconClassName,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
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
          <p className="text-lg font-semibold tabular-nums">
            {value}
            {subtitle ? (
              <span className="text-muted-foreground ml-1 text-xs font-normal">
                {subtitle}
              </span>
            ) : null}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function AuditStatsDialog({ open, onOpenChange, stats, loading }: Props) {
  const placeholder = loading ? '—' : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Audit Log Statistics</DialogTitle>
          <DialogDescription>
            Storage and severity overview for the audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            icon={<ScrollText className="size-4" />}
            label="Stored entries"
            value={loading ? placeholder : (stats?.total?.toString() ?? placeholder)}
            subtitle={`/ ${stats?.maxEntries ?? 1000}`}
          />
          <StatCard
            icon={<AlertTriangle className="size-4" />}
            label="Critical"
            value={loading ? placeholder : (stats?.critical?.toString() ?? placeholder)}
            iconClassName="bg-destructive/10 text-destructive"
          />
          <StatCard
            icon={<ShieldAlert className="size-4" />}
            label="Warnings"
            value={
              loading ? placeholder : String(stats?.bySeverity?.warning ?? 0)
            }
            iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          />
          <StatCard
            icon={<Database className="size-4" />}
            label="Capacity left"
            value={loading ? placeholder : (stats?.remaining?.toString() ?? placeholder)}
            iconClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
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