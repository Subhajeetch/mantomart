'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

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
  requestJson,
  type AuditLogDetail,
  type AuditLogSummary,
} from '../utils';

type Props = {
  log: AuditLogSummary | null;
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
  const [detail, setDetail] = useState<AuditLogDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const loadDetail = useCallback(async () => {
    if (!log) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    setDetail(null);

    try {
      const response = await requestJson<{
        success: true;
        data: AuditLogDetail;
      }>(`/${encodeURIComponent(log.id)}`, { signal: controller.signal });
      if (!controller.signal.aborted) setDetail(response.data);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error ? err.message : 'Failed to load audit log details.'
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [log]);

  useEffect(() => {
    if (!open || !log) {
      requestRef.current?.abort();
      requestRef.current = null;
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }

    void loadDetail();
    return () => requestRef.current?.abort();
  }, [open, log, loadDetail]);

  if (!log) return null;
  const displayedLog = detail ?? log;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="pr-6 text-left leading-snug">
            {displayedLog.description}
          </DialogTitle>
          <DialogDescription className="text-left">
            Full details for this audit event.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant={getSeverityBadgeVariant(displayedLog.severity)}>
            {displayedLog.severity}
          </Badge>
          <Badge variant={getStatusBadgeVariant(displayedLog.status)}>
            {displayedLog.status}
          </Badge>
          <Badge
            variant="outline"
            className={getCategoryColor(displayedLog.category)}
          >
            {displayedLog.category}
          </Badge>
          <Badge variant="secondary">
            {formatActionLabel(displayedLog.action)}
          </Badge>
        </div>

        <Separator />

        {loading || (!detail && !error) ? (
          <div
            className="text-muted-foreground flex min-h-48 flex-col items-center justify-center gap-3 text-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="text-primary size-8 animate-spin" />
            Loading full audit log details…
          </div>
        ) : error ? (
          <div
            className="text-muted-foreground flex min-h-48 flex-col items-center justify-center gap-3 text-center text-sm"
            role="alert"
          >
            <AlertCircle className="text-destructive size-8" />
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadDetail()}
            >
              Try again
            </Button>
          </div>
        ) : detail ? (
          <dl className="space-y-2.5">
            <DetailRow label="Action">
              <code className="text-xs">{detail.action}</code>
            </DetailRow>
            <DetailRow label="When">
              {formatDateTime(detail.createdAt)}
            </DetailRow>
            <DetailRow label="Entry ID">
              <code className="text-xs break-all">{detail.id}</code>
            </DetailRow>

            <Separator className="my-1" />

            <DetailRow label="Actor">
              {detail.actorName || detail.actorEmail || '—'}
              {detail.actorRole ? (
                <span className="text-muted-foreground">
                  {' '}
                  ({detail.actorRole})
                </span>
              ) : null}
            </DetailRow>
            {detail.actorEmail ? (
              <DetailRow label="Actor email">{detail.actorEmail}</DetailRow>
            ) : null}
            {detail.actorId ? (
              <DetailRow label="Actor ID">
                <code className="text-xs break-all">{detail.actorId}</code>
              </DetailRow>
            ) : null}

            <Separator className="my-1" />

            <DetailRow label="Target type">
              {detail.targetType || '—'}
            </DetailRow>
            <DetailRow label="Target">{detail.targetLabel || '—'}</DetailRow>
            {detail.targetId ? (
              <DetailRow label="Target ID">
                <code className="text-xs break-all">{detail.targetId}</code>
              </DetailRow>
            ) : null}

            <Separator className="my-1" />

            <DetailRow label="IP address">{detail.ipAddress || '—'}</DetailRow>
            <DetailRow label="User agent">
              <span className="text-xs break-all">
                {detail.userAgent || '—'}
              </span>
            </DetailRow>
            <DetailRow label="Request">
              {detail.requestMethod || detail.requestPath ? (
                <code className="text-xs">
                  {detail.requestMethod} {detail.requestPath}
                </code>
              ) : (
                '—'
              )}
            </DetailRow>
          </dl>
        ) : null}

        {!loading &&
        !error &&
        detail?.changes &&
        Object.keys(detail.changes).length > 0 ? (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Changes</p>
              <pre className="bg-muted max-h-48 overflow-auto rounded-lg p-3 text-xs leading-relaxed">
                {prettyJson(detail.changes)}
              </pre>
            </div>
          </>
        ) : null}

        {!loading &&
        !error &&
        detail?.metadata &&
        Object.keys(detail.metadata).length > 0 ? (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Metadata</p>
              <pre className="bg-muted max-h-40 overflow-auto rounded-lg p-3 text-xs leading-relaxed">
                {prettyJson(detail.metadata)}
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
