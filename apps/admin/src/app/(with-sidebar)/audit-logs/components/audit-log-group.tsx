'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Globe,
  Layers,
  Shield,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import {
  formatActionLabel,
  formatDateTime,
  formatGroupSummary,
  formatRelative,
  getActorInitials,
  getCategoryColor,
  getGroupTargetPreview,
  getSeverityBadgeVariant,
  getStatusBadgeVariant,
  type AuditLog,
  type AuditLogGroup,
} from '../utils';

type GroupProps = {
  group: AuditLogGroup;
  onSelect: (log: AuditLog) => void;
};

function SeverityDot({ severity }: { severity: AuditLog['severity'] }) {
  return (
    <span
      className={cn(
        'size-2 shrink-0 rounded-full',
        severity === 'critical' && 'bg-destructive',
        severity === 'warning' && 'bg-amber-500',
        severity === 'info' && 'bg-sky-500'
      )}
      aria-hidden
    />
  );
}

/** Single log row inside an expanded group. */
function GroupMemberRow({
  log,
  onSelect,
  showConnector,
}: {
  log: AuditLog;
  onSelect: (log: AuditLog) => void;
  showConnector?: boolean;
}) {
  return (
    <div className="relative flex gap-3">
      {showConnector ? (
        <div
          className="bg-border absolute top-0 bottom-0 left-[15px] w-px"
          aria-hidden
        />
      ) : null}
      <div className="relative z-[1] mt-1.5 flex size-8 shrink-0 items-center justify-center">
        <SeverityDot severity={log.severity} />
      </div>
      <button
        type="button"
        onClick={() => onSelect(log)}
        className="hover:bg-muted/60 focus-visible:ring-ring min-w-0 flex-1 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border focus-visible:ring-2 focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-medium leading-snug">
            {log.description}
          </p>
          <span
            className="text-muted-foreground shrink-0 text-[11px] tabular-nums"
            title={formatDateTime(log.createdAt)}
          >
            {formatRelative(log.createdAt)}
          </span>
        </div>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {log.targetLabel ? (
            <span className="inline-flex max-w-full items-center gap-1">
              <Shield className="size-3 shrink-0" />
              <span className="truncate">
                {log.targetType ? `${log.targetType}: ` : ''}
                {log.targetLabel}
              </span>
            </span>
          ) : null}
          {log.ipAddress ? (
            <span className="inline-flex items-center gap-1">
              <Globe className="size-3" />
              {log.ipAddress}
            </span>
          ) : null}
          <Badge
            variant={getStatusBadgeVariant(log.status)}
            className="h-4 px-1.5 text-[10px]"
          >
            {log.status}
          </Badge>
          <Badge
            variant={getSeverityBadgeVariant(log.severity)}
            className="h-4 px-1.5 text-[10px]"
          >
            {log.severity}
          </Badge>
        </div>
        {log.requestMethod || log.requestPath ? (
          <p className="text-muted-foreground mt-1 truncate font-mono text-[10px]">
            {log.requestMethod} {log.requestPath}
          </p>
        ) : null}
      </button>
    </div>
  );
}

/**
 * Audit timeline group:
 * - 1 event → compact card (click opens detail)
 * - N same actor+action events → one card with collapsible stack
 */
export function AuditLogGroupCard({ group, onSelect }: GroupProps) {
  const [open, setOpen] = useState(false);
  const isStack = group.logs.length > 1;
  const summary = formatGroupSummary(group);
  const preview = getGroupTargetPreview(group, 3);
  const actorLabel = group.actorName || group.actorEmail || 'System';
  const initials = getActorInitials(group);

  // ── Single event (no collapsible chrome) ──────────────────────────────────
  if (!isStack) {
    const log = group.logs[0];
    if (!log) return null;

    return (
      <button
        type="button"
        onClick={() => onSelect(log)}
        className={cn(
          'hover:bg-muted/40 group flex w-full items-start gap-3 px-3 py-3 text-left transition-colors',
          log.severity === 'critical' && 'bg-destructive/5'
        )}
      >
        <div
          className={cn(
            'bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
            log.severity === 'critical' && 'bg-destructive/15 text-destructive',
            log.severity === 'warning' &&
              'bg-amber-500/15 text-amber-700 dark:text-amber-400'
          )}
          aria-hidden
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold">{actorLabel}</span>
            {group.actorRole ? (
              <span className="text-muted-foreground text-xs">
                {group.actorRole}
              </span>
            ) : null}
            <span
              className="text-muted-foreground text-xs tabular-nums"
              title={formatDateTime(log.createdAt)}
            >
              {formatRelative(log.createdAt)}
            </span>
          </div>
          <p className="text-sm leading-snug">{log.description}</p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <Badge variant={getSeverityBadgeVariant(log.severity)}>
              {log.severity === 'critical' && (
                <AlertTriangle className="size-3" />
              )}
              {log.severity}
            </Badge>
            <Badge variant={getStatusBadgeVariant(log.status)}>
              {log.status}
            </Badge>
            <Badge variant="outline" className={getCategoryColor(log.category)}>
              {log.category}
            </Badge>
            <code className="text-muted-foreground text-[11px]">
              {log.action}
            </code>
            {log.targetLabel ? (
              <span className="text-muted-foreground inline-flex max-w-[200px] items-center gap-1 truncate text-xs">
                <Shield className="size-3 shrink-0" />
                {log.targetLabel}
              </span>
            ) : null}
          </div>
        </div>
      </button>
    );
  }

  // ── Stacked group (collapsible) ───────────────────────────────────────────
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'hover:bg-muted/30 transition-colors',
          group.severity === 'critical' && 'bg-destructive/5',
          open && 'bg-muted/20'
        )}
      >
        <div className="flex items-start gap-3 px-3 py-3">
          <div
            className={cn(
              'bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              group.severity === 'critical' &&
                'bg-destructive/15 text-destructive',
              group.severity === 'warning' &&
                'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            )}
            aria-hidden
          >
            {initials}
          </div>

          <div className="min-w-0 flex-1">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="group/trigger flex w-full flex-col gap-1.5 text-left"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold">{actorLabel}</span>
                  {group.actorRole ? (
                    <span className="text-muted-foreground text-xs">
                      {group.actorRole}
                    </span>
                  ) : null}
                  <span
                    className="text-muted-foreground text-xs tabular-nums"
                    title={`${formatDateTime(group.oldestAt)} → ${formatDateTime(group.newestAt)}`}
                  >
                    {formatRelative(group.newestAt)}
                  </span>
                  <Badge
                    variant="secondary"
                    className="h-5 gap-1 px-1.5 font-semibold tabular-nums"
                  >
                    <Layers className="size-3" />
                    {group.logs.length}
                  </Badge>
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground ml-auto size-4 shrink-0 transition-transform duration-200',
                      open && 'rotate-180'
                    )}
                  />
                </div>

                <p className="text-sm font-medium leading-snug">{summary}</p>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={getSeverityBadgeVariant(group.severity)}>
                    {group.severity === 'critical' && (
                      <AlertTriangle className="size-3" />
                    )}
                    {group.severity}
                  </Badge>
                  <Badge variant={getStatusBadgeVariant(group.status)}>
                    {group.status}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={getCategoryColor(group.category)}
                  >
                    {group.category}
                  </Badge>
                  <code className="text-muted-foreground text-[11px]">
                    {group.action}
                  </code>
                </div>

                {/* Target preview chips when collapsed */}
                {!open && preview.labels.length > 0 ? (
                  <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
                    <span className="opacity-70">Targets:</span>
                    {preview.labels.map((label) => (
                      <span
                        key={label}
                        className="bg-muted max-w-[140px] truncate rounded-md px-1.5 py-0.5"
                      >
                        {label}
                      </span>
                    ))}
                    {preview.remaining > 0 ? (
                      <span className="opacity-70">
                        +{preview.remaining} more
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {!open ? (
                  <p className="text-muted-foreground flex items-center gap-1 text-[11px]">
                    <Clock className="size-3" />
                    {formatDateTime(group.oldestAt)}
                    {group.oldestAt !== group.newestAt ? (
                      <>
                        <span className="opacity-40">→</span>
                        {formatDateTime(group.newestAt)}
                      </>
                    ) : null}
                  </p>
                ) : null}
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent className="data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 mt-3">
              <div className="border-border/60 space-y-1 border-t pt-3">
                <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                  {group.logs.length} events · {formatActionLabel(group.action)}
                </p>
                <div className="space-y-0.5">
                  {group.logs.map((log, index) => (
                    <GroupMemberRow
                      key={log.id}
                      log={log}
                      onSelect={onSelect}
                      showConnector={index < group.logs.length - 1}
                    />
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </div>
      </div>
    </Collapsible>
  );
}

export function AuditLogCardSkeleton() {
  return (
    <Card size="sm" className="bg-card/60 rounded-none border-0 border-b">
      <CardContent className="flex items-start gap-3 py-3">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
