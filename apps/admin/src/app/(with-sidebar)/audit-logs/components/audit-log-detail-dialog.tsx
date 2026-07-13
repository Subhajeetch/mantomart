'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

import {
  formatActionLabel,
  formatDateTime,
  getCategoryColor,
  getSeverityBadgeVariant,
  getStatusBadgeVariant,
  prettyJson,
  type AuditLog,
} from '../utils';

type Props = {
  log: AuditLog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm sm:grid-cols-[140px_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function AuditLogDetailDialog({ log, open, onOpenChange }: Props) {
  if (!log) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="pr-6 text-left leading-snug">
            {log.description}
          </DialogTitle>
          <DialogDescription className="text-left">
            Full details for this audit event.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant={getSeverityBadgeVariant(log.severity)}>
            {log.severity}
          </Badge>
          <Badge variant={getStatusBadgeVariant(log.status)}>
            {log.status}
          </Badge>
          <Badge variant="outline" className={getCategoryColor(log.category)}>
            {log.category}
          </Badge>
          <Badge variant="secondary">{formatActionLabel(log.action)}</Badge>
        </div>

        <Separator />

        <dl className="space-y-2.5">
          <DetailRow label="Action">
            <code className="text-xs">{log.action}</code>
          </DetailRow>
          <DetailRow label="When">{formatDateTime(log.createdAt)}</DetailRow>
          <DetailRow label="Entry ID">
            <code className="text-xs break-all">{log.id}</code>
          </DetailRow>

          <Separator className="my-1" />

          <DetailRow label="Actor">
            {log.actorName || log.actorEmail || '—'}
            {log.actorRole ? (
              <span className="text-muted-foreground"> ({log.actorRole})</span>
            ) : null}
          </DetailRow>
          {log.actorEmail ? (
            <DetailRow label="Actor email">{log.actorEmail}</DetailRow>
          ) : null}
          {log.actorId ? (
            <DetailRow label="Actor ID">
              <code className="text-xs break-all">{log.actorId}</code>
            </DetailRow>
          ) : null}

          <Separator className="my-1" />

          <DetailRow label="Target type">{log.targetType || '—'}</DetailRow>
          <DetailRow label="Target">{log.targetLabel || '—'}</DetailRow>
          {log.targetId ? (
            <DetailRow label="Target ID">
              <code className="text-xs break-all">{log.targetId}</code>
            </DetailRow>
          ) : null}

          <Separator className="my-1" />

          <DetailRow label="IP address">{log.ipAddress || '—'}</DetailRow>
          <DetailRow label="User agent">
            <span className="text-xs break-all">{log.userAgent || '—'}</span>
          </DetailRow>
          <DetailRow label="Request">
            {log.requestMethod || log.requestPath ? (
              <code className="text-xs">
                {log.requestMethod} {log.requestPath}
              </code>
            ) : (
              '—'
            )}
          </DetailRow>
        </dl>

        {log.changes && Object.keys(log.changes).length > 0 ? (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Changes</p>
              <pre className="bg-muted max-h-48 overflow-auto rounded-lg p-3 text-xs leading-relaxed">
                {prettyJson(log.changes)}
              </pre>
            </div>
          </>
        ) : null}

        {log.metadata && Object.keys(log.metadata).length > 0 ? (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Metadata</p>
              <pre className="bg-muted max-h-40 overflow-auto rounded-lg p-3 text-xs leading-relaxed">
                {prettyJson(log.metadata)}
              </pre>
            </div>
          </>
        ) : null}

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
