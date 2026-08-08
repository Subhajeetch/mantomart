'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Unplug,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import Image from 'next/image';

// ─── Shared helpers ───────────────────────────────────────────────────────────

type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

class ApiRequestError extends Error {
  code?: string;
  status?: number;

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = options?.code;
    this.status = options?.status;
  }
}

type StatusResponse = {
  success?: boolean;
  connected: boolean;
  expires_at?: number | null;
  expiresAt?: number | null;
  is_expired?: boolean;
  has_refresh_token?: boolean;
  refresh_expires_at?: number | null;
  refreshExpiresAt?: number | null;
  refresh_expires_in_ms?: number | null;
  is_refresh_expired?: boolean;
  can_refresh?: boolean;
  refresh_token_obtained_at?: number | null;
  refresh_inactivity_expires_at?: number | null;
};

type ConnectResponse = {
  success: true;
  message?: string;
  reconnected?: boolean;
  expires_at?: number | null;
  expiresAt?: number | null;
  refresh_expires_at?: number | null;
  refreshExpiresAt?: number | null;
  refresh_token_obtained_at?: number | null;
  refresh_inactivity_expires_at?: number | null;
  can_refresh?: boolean;
  is_refresh_expired?: boolean;
  connected?: boolean;
};

type RefreshResponse = ConnectResponse;

type ConnectionState = {
  connected: boolean;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
  canRefresh: boolean;
  isRefreshExpired: boolean;
  refreshTokenObtainedAt: number | null;
  refreshInactivityExpiresAt: number | null;
};

type ProviderAction = 'connect' | 'disconnect' | 'refresh' | null;

/** Visual urgency for hard token expiry windows (AliExpress refresh token). */
type ExpiryUrgency =
  | 'ok'
  | 'caution'
  | 'warning'
  | 'critical'
  | 'expired'
  | 'unknown';

const EMPTY_CONNECTION: ConnectionState = {
  connected: false,
  expiresAt: null,
  refreshExpiresAt: null,
  canRefresh: false,
  isRefreshExpired: false,
  refreshTokenObtainedAt: null,
  refreshInactivityExpiresAt: null,
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DISCONNECT_COUNTDOWN_SECONDS = 3;

type DisconnectConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
  confirming: boolean;
  onConfirm: () => void;
};

function DisconnectConfirmDialog({
  open,
  onOpenChange,
  providerName,
  confirming,
  onConfirm,
}: DisconnectConfirmDialogProps) {
  const [secondsLeft, setSecondsLeft] = useState(DISCONNECT_COUNTDOWN_SECONDS);

  useEffect(() => {
    if (!open) {
      setSecondsLeft(DISCONNECT_COUNTDOWN_SECONDS);
      return;
    }

    setSecondsLeft(DISCONNECT_COUNTDOWN_SECONDS);
    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [open]);

  const canConfirm = secondsLeft === 0 && !confirming;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block dismiss while the disconnect request is in flight.
        if (confirming) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={!confirming}
        className="sm:max-w-md"
        onPointerDownOutside={(event) => {
          if (confirming) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (confirming) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Disconnect {providerName}?</DialogTitle>
          <DialogDescription>
            This removes stored API tokens. Any {providerName} calls will fail
            until you connect again.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm">
          {secondsLeft > 0 ? (
            <p className="text-muted-foreground">
              Confirm becomes available in{' '}
              <span className="font-semibold tabular-nums text-foreground">
                {secondsLeft}s
              </span>
              …
            </p>
          ) : (
            <p className="font-medium text-destructive">
              Ready — you can disconnect now.
            </p>
          )}
        </div>

        <DialogFooter className="sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={confirming}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {confirming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Disconnecting…
              </>
            ) : secondsLeft > 0 ? (
              `Disconnect (${secondsLeft})`
            ) : (
              <>
                <Unplug className="mr-2 h-4 w-4" />
                Disconnect
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...options.headers,
      },
      cache: 'no-store',
      credentials: 'include',
      ...options,
    });
  } catch {
    throw new ApiRequestError(
      'Unable to reach the server. Please try again.',
      { code: 'NETWORK_ERROR' }
    );
  }

  let data: unknown = null;

  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiRequestError(
        `Request failed with status ${response.status}.`,
        { code: 'HTTP_ERROR', status: response.status }
      );
    }
    throw new ApiRequestError('Server returned an invalid response.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }

  const body = data as ApiErrorBody;

  if (!response.ok) {
    throw new ApiRequestError(
      body.error ||
        body.message ||
        `Request failed with status ${response.status}.`,
      { code: body.code, status: response.status }
    );
  }

  if (body.success === false) {
    throw new ApiRequestError(
      body.error || body.message || 'Request failed.',
      { code: body.code, status: response.status }
    );
  }

  return data as T;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) {
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

function pickTimestamp(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const timestamp = Number(candidate);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return timestamp;
    }
  }
  return null;
}

function getExpiresAt(data: unknown): number | null {
  const value = data as {
    expires_at?: unknown;
    expiresAt?: unknown;
    tokens?: { expires_at?: unknown };
    status?: { expires_at?: unknown; expiresAt?: unknown };
  };

  return pickTimestamp(
    value.expires_at,
    value.expiresAt,
    value.tokens?.expires_at,
    value.status?.expires_at,
    value.status?.expiresAt
  );
}

function getRefreshExpiresAt(data: unknown): number | null {
  const value = data as {
    refresh_expires_at?: unknown;
    refreshExpiresAt?: unknown;
    tokens?: { refresh_expires_at?: unknown };
    status?: { refresh_expires_at?: unknown; refreshExpiresAt?: unknown };
  };

  return pickTimestamp(
    value.refresh_expires_at,
    value.refreshExpiresAt,
    value.tokens?.refresh_expires_at,
    value.status?.refresh_expires_at,
    value.status?.refreshExpiresAt
  );
}

function connectionFromStatus(
  data: StatusResponse,
  previous?: ConnectionState
): ConnectionState {
  if (!data.connected) {
    return { ...EMPTY_CONNECTION };
  }

  const expiresAt = getExpiresAt(data) ?? previous?.expiresAt ?? null;
  const refreshExpiresAt =
    getRefreshExpiresAt(data) ?? previous?.refreshExpiresAt ?? null;
  const isRefreshExpired =
    data.is_refresh_expired ??
    (refreshExpiresAt !== null ? refreshExpiresAt <= Date.now() : false);
  const canRefresh =
    data.can_refresh ??
    (data.has_refresh_token !== false && !isRefreshExpired);

  return {
    connected: true,
    expiresAt,
    refreshExpiresAt,
    canRefresh,
    isRefreshExpired,
    refreshTokenObtainedAt: pickTimestamp(
      data.refresh_token_obtained_at,
      previous?.refreshTokenObtainedAt
    ),
    refreshInactivityExpiresAt: pickTimestamp(
      data.refresh_inactivity_expires_at,
      previous?.refreshInactivityExpiresAt
    ),
  };
}

function connectionFromMutateResponse(
  data: ConnectResponse | RefreshResponse,
  previous?: ConnectionState
): ConnectionState {
  const expiresAt = getExpiresAt(data) ?? previous?.expiresAt ?? null;
  const refreshExpiresAt =
    getRefreshExpiresAt(data) ?? previous?.refreshExpiresAt ?? null;
  const isRefreshExpired =
    data.is_refresh_expired ??
    (refreshExpiresAt !== null ? refreshExpiresAt <= Date.now() : false);
  const canRefresh =
    data.can_refresh ??
    (previous?.canRefresh !== false && !isRefreshExpired);

  return {
    connected: true,
    expiresAt,
    refreshExpiresAt,
    canRefresh,
    isRefreshExpired,
    refreshTokenObtainedAt: pickTimestamp(
      data.refresh_token_obtained_at,
      previous?.refreshTokenObtainedAt
    ),
    refreshInactivityExpiresAt: pickTimestamp(
      data.refresh_inactivity_expires_at,
      previous?.refreshInactivityExpiresAt
    ),
  };
}

function cleanOAuthParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  url.searchParams.delete('scope');
  window.history.replaceState(
    {},
    document.title,
    `${url.pathname}${url.search}${url.hash}`
  );
}

function formatDate(timestamp: number | null) {
  if (!timestamp) return 'Unavailable';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function formatRemaining(timestamp: number | null, now: number) {
  if (!timestamp) return 'Expiry time unavailable';

  const diffMs = timestamp - now;
  if (diffMs <= 0) return 'Expired';

  const totalMinutes = Math.ceil(diffMs / MINUTE_MS);
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'} remaining`;
  }

  const totalHours = Math.ceil(totalMinutes / 60);
  if (totalHours < 48) {
    return `${totalHours} hour${totalHours === 1 ? '' : 's'} remaining`;
  }

  const days = Math.floor(diffMs / DAY_MS);
  const hours = Math.floor((diffMs % DAY_MS) / HOUR_MS);

  if (days >= 14) {
    return `${days} day${days === 1 ? '' : 's'} remaining`;
  }

  if (hours > 0) {
    return `${days} day${days === 1 ? '' : 's'} ${hours} hour${hours === 1 ? '' : 's'} remaining`;
  }

  return `${days} day${days === 1 ? '' : 's'} remaining`;
}

/**
 * Urgency bands for hard-expiry tokens (AliExpress refresh token).
 * - critical: < 7 days  → red, reconnect immediately
 * - warning:  < 20 days → orange
 * - caution:  < 30 days → amber
 * - ok:       otherwise → muted/green
 */
function getExpiryUrgency(
  expiresAt: number | null,
  now: number
): ExpiryUrgency {
  if (expiresAt === null) return 'unknown';
  const diffMs = expiresAt - now;
  if (diffMs <= 0) return 'expired';
  const days = diffMs / DAY_MS;
  if (days < 7) return 'critical';
  if (days < 20) return 'warning';
  if (days < 30) return 'caution';
  return 'ok';
}

function remainingTextClass(urgency: ExpiryUrgency): string {
  switch (urgency) {
    case 'expired':
    case 'critical':
      return 'text-red-600 dark:text-red-400 font-medium';
    case 'warning':
      return 'text-orange-600 dark:text-orange-400 font-medium';
    case 'caution':
      return 'text-amber-600 dark:text-amber-400';
    case 'ok':
      return 'text-emerald-700 dark:text-emerald-400';
    default:
      return 'text-muted-foreground';
  }
}

function expiryPanelClass(urgency: ExpiryUrgency): string {
  switch (urgency) {
    case 'expired':
    case 'critical':
      return 'border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/30';
    case 'warning':
      return 'border-orange-200 bg-orange-50/70 dark:border-orange-900/50 dark:bg-orange-950/25';
    case 'caution':
      return 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20';
    case 'ok':
      return 'border-emerald-200/80 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/15';
    default:
      return 'border-border bg-muted/30';
  }
}

type ConnectionBadgeProps = {
  connected: boolean;
  isAccessExpired: boolean;
  isRefreshExpired: boolean;
  refreshUrgency?: ExpiryUrgency;
};

function ConnectionBadge({
  connected,
  isAccessExpired,
  isRefreshExpired,
  refreshUrgency,
}: ConnectionBadgeProps) {
  if (!connected) {
    return <Badge variant="secondary">Not connected</Badge>;
  }

  if (isRefreshExpired) {
    return (
      <Badge variant="destructive" className="gap-1">
        <ShieldAlert className="h-3.5 w-3.5" />
        Reconnect required
      </Badge>
    );
  }

  if (isAccessExpired) {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3.5 w-3.5" />
        Access expired
      </Badge>
    );
  }

  if (refreshUrgency === 'critical') {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
      >
        <ShieldAlert className="h-3.5 w-3.5" />
        Expiring soon
      </Badge>
    );
  }

  if (refreshUrgency === 'warning') {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300"
      >
        <Clock className="h-3.5 w-3.5" />
        Renew soon
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      Connected
    </Badge>
  );
}

type TokenExpiryBlockProps = {
  title: string;
  expiresAt: number | null;
  now: number;
  emptyLabel?: string;
  /** When true, apply colored remaining-time urgency (AliExpress). */
  colored?: boolean;
  helperText?: string | null;
};

function TokenExpiryBlock({
  title,
  expiresAt,
  now,
  emptyLabel = 'Expiry time unavailable',
  colored = false,
  helperText,
}: TokenExpiryBlockProps) {
  const urgency = colored
    ? getExpiryUrgency(expiresAt, now)
    : expiresAt !== null && expiresAt <= now
      ? 'expired'
      : 'unknown';

  const remaining = expiresAt ? formatRemaining(expiresAt, now) : emptyLabel;

  const criticalHelper =
    colored && urgency === 'critical'
      ? 'Please reconnect immediately.'
      : colored && urgency === 'expired'
        ? 'Please reconnect immediately.'
        : null;

  const combinedHelper = criticalHelper
    ? helperText
      ? `${criticalHelper} ${helperText}`
      : criticalHelper
    : helperText;

  return (
    <div
      className={cn(
        'space-y-1.5 rounded-lg border p-3 transition-colors',
        colored ? expiryPanelClass(urgency) : 'border-border bg-muted/30'
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
        {title}
      </div>
      <div className="space-y-0.5 pl-6 text-sm">
        <p className="text-foreground">{formatDate(expiresAt)}</p>
        <p className={remainingTextClass(urgency)}>{remaining}</p>
        {combinedHelper ? (
          <p
            className={cn(
              'pt-1 text-xs',
              urgency === 'critical' || urgency === 'expired'
                ? 'font-medium text-red-600 dark:text-red-400'
                : urgency === 'warning'
                  ? 'text-orange-700 dark:text-orange-400'
                  : 'text-muted-foreground'
            )}
          >
            {combinedHelper}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type AliExpressRefreshBlockProps = {
  connection: ConnectionState;
  now: number;
};

function AliExpressRefreshBlock({
  connection,
  now,
}: AliExpressRefreshBlockProps) {
  const { refreshExpiresAt, isRefreshExpired, canRefresh } = connection;
  const urgency = getExpiryUrgency(refreshExpiresAt, now);

  let helperText: string | null = null;
  if (isRefreshExpired || urgency === 'expired') {
    helperText =
      'Access tokens can no longer be renewed. Reconnect to continue.';
  } else if (urgency === 'critical') {
    helperText =
      'Refresh token expires in under 7 days. Please reconnect immediately.';
  } else if (urgency === 'warning') {
    helperText =
      'Refresh token expires in under 20 days. Reconnect soon to avoid downtime.';
  } else if (urgency === 'caution') {
    helperText = 'Consider reconnecting within the next few weeks.';
  } else if (refreshExpiresAt === null) {
    helperText =
      'No refresh expiry was returned. Reconnect if token refresh starts failing.';
  }

  return (
    <div className="space-y-2">
      <TokenExpiryBlock
        title="Refresh token expiry"
        expiresAt={refreshExpiresAt}
        now={now}
        colored
        emptyLabel="No expiry reported by AliExpress"
        helperText={helperText}
      />

      {!canRefresh ? (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Reconnect required</AlertTitle>
          <AlertDescription>
            The refresh token has expired. Use Reconnect to obtain new tokens
            without first disconnecting — existing tokens stay active until the
            new ones are saved.
          </AlertDescription>
        </Alert>
      ) : urgency === 'critical' ? (
        <Alert className="border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100 [&>svg]:text-red-600 dark:[&>svg]:text-red-400">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Please reconnect immediately</AlertTitle>
          <AlertDescription>
            Less than 7 days remain on the refresh token. Reconnect now to
            replace tokens in place — no disconnect needed, no downtime window.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

type GoogleRefreshBlockProps = {
  connection: ConnectionState;
  now: number;
};

function GoogleRefreshBlock({ connection, now }: GoogleRefreshBlockProps) {
  const {
    refreshExpiresAt,
    isRefreshExpired,
    canRefresh,
    refreshInactivityExpiresAt,
  } = connection;

  if (refreshExpiresAt !== null) {
    const urgency = getExpiryUrgency(refreshExpiresAt, now);
    return (
      <div className="space-y-2">
        <TokenExpiryBlock
          title="Refresh token expiry"
          expiresAt={refreshExpiresAt}
          now={now}
          helperText={
            isRefreshExpired
              ? 'Access tokens can no longer be renewed. Reconnect to continue.'
              : undefined
          }
        />
        {!canRefresh ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Reconnect required</AlertTitle>
            <AlertDescription>
              The refresh token is no longer valid. Reconnect Google Ads to
              continue.
            </AlertDescription>
          </Alert>
        ) : urgency === 'critical' ? (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Please reconnect immediately</AlertTitle>
            <AlertDescription>
              The refresh token expires soon. Reconnect to avoid disruption.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    );
  }

  const softWarning =
    refreshInactivityExpiresAt !== null &&
    refreshInactivityExpiresAt - now < 30 * DAY_MS;

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        Refresh token
      </div>
      <div className="space-y-1 pl-6 text-sm">
        <p className="text-foreground">No fixed expiry</p>
        {refreshInactivityExpiresAt ? (
          <p
            className={
              softWarning
                ? 'text-amber-600 dark:text-amber-500'
                : 'text-muted-foreground'
            }
          >
            May stop working after {formatDate(refreshInactivityExpiresAt)} if
            unused ({formatRemaining(refreshInactivityExpiresAt, now)})
          </p>
        ) : (
          <p className="text-muted-foreground">
            Long-lived — reconnect if refresh starts failing.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── AliExpress ───────────────────────────────────────────────────────────────

const AE_API_BASE = '/api/ae';

const ALIEXPRESS_AUTH_URL = `https://api-sg.aliexpress.com/oauth/authorize?response_type=code&client_id=519374&redirect_uri=${process.env.NEXT_PUBLIC_APP_URL}/connections`;

function AliExpressCard() {
  const handledCodeRef = useRef(false);

  const [connection, setConnection] =
    useState<ConnectionState>(EMPTY_CONNECTION);

  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<ProviderAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [oauthRedirecting, setOauthRedirecting] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);

  const isBusy = loading || action !== null || oauthRedirecting;

  const isAccessExpired = useMemo(() => {
    return connection.expiresAt !== null && connection.expiresAt <= now;
  }, [connection.expiresAt, now]);

  const refreshUrgency = useMemo(
    () => getExpiryUrgency(connection.refreshExpiresAt, now),
    [connection.refreshExpiresAt, now]
  );

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const data = await requestJson<StatusResponse>(`${AE_API_BASE}/status`);
      setConnection((current) => connectionFromStatus(data, current));
    } catch (err) {
      setError(errorMessage(err, 'Failed to check AliExpress status.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const connectWithCode = useCallback(
    async (code: string) => {
      setAction('connect');
      setError(null);
      try {
        const data = await requestJson<ConnectResponse>(
          `${AE_API_BASE}/connect?code=${encodeURIComponent(code)}`
        );
        setConnection((current) => connectionFromMutateResponse(data, current));
        cleanOAuthParams();
        toast.success(
          data.message ||
            (data.reconnected
              ? 'AliExpress reconnected successfully.'
              : 'AliExpress connected successfully.')
        );
        await loadStatus();
      } catch (err) {
        const message = errorMessage(err, 'Failed to connect AliExpress.');
        setError(message);
        toast.error(message);
        cleanOAuthParams();
        // Keep any previous tokens visible — connect never wipes KV first.
        await loadStatus();
      } finally {
        setAction(null);
        setLoading(false);
      }
    },
    [loadStatus]
  );

  const startOAuth = () => {
    setOauthRedirecting(true);
    setError(null);
    window.location.href = ALIEXPRESS_AUTH_URL;
  };

  const refreshToken = async () => {
    setAction('refresh');
    setError(null);
    try {
      const data = await requestJson<RefreshResponse>(`${AE_API_BASE}/refresh`);
      setConnection((current) => connectionFromMutateResponse(data, current));
      toast.success(data.message || 'AliExpress token refreshed.');
      await loadStatus();
    } catch (err) {
      const message = errorMessage(err, 'Failed to refresh AliExpress token.');
      setError(message);
      toast.error(message);
      await loadStatus();
    } finally {
      setAction(null);
    }
  };

  const disconnect = async () => {
    setAction('disconnect');
    setError(null);
    try {
      await requestJson(`${AE_API_BASE}/disconnect`);
      setConnection({ ...EMPTY_CONNECTION });
      setDisconnectDialogOpen(false);
      toast.success('AliExpress disconnected.');
    } catch (err) {
      const message = errorMessage(err, 'Failed to disconnect AliExpress.');
      setError(message);
      toast.error(message);
      await loadStatus();
    } finally {
      setAction(null);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!connection.connected || !connection.expiresAt) return;
    if (!connection.canRefresh) return;

    const refreshDelay = Math.max(
      0,
      connection.expiresAt - Date.now() - 4 * MINUTE_MS
    );
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, refreshDelay);

    return () => window.clearTimeout(timer);
  }, [
    connection.connected,
    connection.expiresAt,
    connection.canRefresh,
    loadStatus,
  ]);

  useEffect(() => {
    if (handledCodeRef.current) return;
    handledCodeRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    const oauthErrorDescription = params.get('error_description');
    const code = params.get('code');
    const state = params.get('state');

    // Google OAuth uses state=google_ads — skip AE handler.
    if (state === 'google_ads') {
      void loadStatus();
      return;
    }

    if (oauthError) {
      const message =
        oauthErrorDescription || oauthError || 'AliExpress authorization failed.';
      setError(message);
      toast.error(message);
      cleanOAuthParams();
      setLoading(false);
      void loadStatus();
      return;
    }

    if (code?.trim()) {
      void connectWithCode(code.trim());
      return;
    }

    void loadStatus();
  }, [connectWithCode, loadStatus]);

  const showReconnectCta =
    connection.connected &&
    (connection.isRefreshExpired ||
      refreshUrgency === 'critical' ||
      refreshUrgency === 'expired');

  return (
    <Card className="w-full max-w-xl shadow-sm">
      <CardHeader className="space-y-3 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="sr-only">AliExpress Connection</CardTitle>
            <Image
              src="/icons/aliexpress_logo_long.png"
              width={120}
              height={50}
              alt="AliExpress"
              className="h-8 w-auto object-contain"
            />
            <CardDescription className="text-xs">
              Dropshipping product & order API
            </CardDescription>
          </div>

          <ConnectionBadge
            connected={connection.connected}
            isAccessExpired={isAccessExpired}
            isRefreshExpired={connection.isRefreshExpired}
            refreshUrgency={refreshUrgency}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>AliExpress error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/20 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking connection…
          </div>
        ) : connection.connected ? (
          <>
            <div className="space-y-3">
              <TokenExpiryBlock
                title="Access token expiry"
                expiresAt={connection.expiresAt}
                now={now}
                helperText={
                  isAccessExpired && connection.canRefresh
                    ? 'Expired — click Refresh to renew without reconnecting.'
                    : isAccessExpired && !connection.canRefresh
                      ? 'Access expired and refresh is unavailable. Reconnect required.'
                      : undefined
                }
              />

              <AliExpressRefreshBlock connection={connection} now={now} />
            </div>

            <Separator />

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={refreshToken}
                  disabled={isBusy || !connection.canRefresh}
                  title={
                    !connection.canRefresh
                      ? 'Refresh token expired — reconnect required'
                      : 'Renew the access token using the stored refresh token'
                  }
                >
                  {action === 'refresh' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh
                </Button>

                {/*
                  Always available while connected. Completing OAuth overwrites
                  KV tokens in place — no disconnect, no empty-token window.
                */}
                <Button
                  variant={showReconnectCta ? 'default' : 'outline'}
                  onClick={startOAuth}
                  disabled={isBusy}
                  title="Start a new OAuth flow and replace tokens without disconnecting"
                  className={
                    showReconnectCta
                      ? 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600/30'
                      : undefined
                  }
                >
                  {oauthRedirecting || action === 'connect' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="mr-2 h-4 w-4" />
                  )}
                  Reconnect
                </Button>

                <Button
                  variant="destructive"
                  onClick={() => setDisconnectDialogOpen(true)}
                  disabled={isBusy}
                  title="Remove tokens from storage. API calls will fail until reconnected."
                >
                  <Unplug className="mr-2 h-4 w-4" />
                  Disconnect
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Reconnect replaces tokens in place — no need to disconnect first.
                Disconnect only when you intentionally want to remove access.
              </p>
            </div>

            <DisconnectConfirmDialog
              open={disconnectDialogOpen}
              onOpenChange={setDisconnectDialogOpen}
              providerName="AliExpress"
              confirming={action === 'disconnect'}
              onConfirm={() => {
                void disconnect();
              }}
            />
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your AliExpress account to enable product sync and order
              APIs. Tokens are stored securely and renewed automatically.
            </p>
            <Button onClick={startOAuth} disabled={isBusy}>
              {oauthRedirecting || action === 'connect' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-2 h-4 w-4" />
              )}
              Connect AliExpress
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Google Ads ───────────────────────────────────────────────────────────────

const GOOGLE_API_BASE = '/api/google';

function GoogleAdsCard() {
  const handledCodeRef = useRef(false);

  const [connection, setConnection] =
    useState<ConnectionState>(EMPTY_CONNECTION);

  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<ProviderAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [connectingRedirect, setConnectingRedirect] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);

  const isBusy = loading || action !== null || connectingRedirect;

  const isAccessExpired = useMemo(() => {
    return connection.expiresAt !== null && connection.expiresAt <= now;
  }, [connection.expiresAt, now]);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const data = await requestJson<StatusResponse>(
        `${GOOGLE_API_BASE}/status`
      );
      setConnection((current) => connectionFromStatus(data, current));
    } catch (err) {
      setError(errorMessage(err, 'Failed to check Google Ads status.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const connectWithCode = useCallback(
    async (code: string) => {
      setAction('connect');
      setError(null);
      try {
        const data = await requestJson<ConnectResponse>(
          `${GOOGLE_API_BASE}/connect?code=${encodeURIComponent(code)}`
        );
        setConnection((current) => connectionFromMutateResponse(data, current));
        cleanOAuthParams();
        toast.success(data.message || 'Google Ads connected successfully.');
        await loadStatus();
      } catch (err) {
        const message = errorMessage(err, 'Failed to connect Google Ads.');
        setError(message);
        toast.error(message);
        cleanOAuthParams();
        await loadStatus();
      } finally {
        setAction(null);
        setLoading(false);
      }
    },
    [loadStatus]
  );

  const startConnect = async () => {
    setConnectingRedirect(true);
    setError(null);
    try {
      const data = await requestJson<{ success: true; url: string }>(
        `${GOOGLE_API_BASE}/auth-url`
      );
      if (!data.url) {
        throw new ApiRequestError('Server did not return a Google auth URL.', {
          code: 'MISSING_AUTH_URL',
        });
      }
      window.location.href = data.url;
    } catch (err) {
      const message = errorMessage(
        err,
        'Failed to start Google Ads connection.'
      );
      setError(message);
      toast.error(message);
      setConnectingRedirect(false);
    }
  };

  const refreshToken = async () => {
    setAction('refresh');
    setError(null);
    try {
      const data = await requestJson<RefreshResponse>(
        `${GOOGLE_API_BASE}/refresh`
      );
      setConnection((current) => connectionFromMutateResponse(data, current));
      toast.success(data.message || 'Google Ads token refreshed.');
      await loadStatus();
    } catch (err) {
      const message = errorMessage(err, 'Failed to refresh Google Ads token.');
      setError(message);
      toast.error(message);
      await loadStatus();
    } finally {
      setAction(null);
    }
  };

  const disconnect = async () => {
    setAction('disconnect');
    setError(null);
    try {
      await requestJson(`${GOOGLE_API_BASE}/disconnect`);
      setConnection({ ...EMPTY_CONNECTION });
      setDisconnectDialogOpen(false);
      toast.success('Google Ads disconnected.');
    } catch (err) {
      const message = errorMessage(err, 'Failed to disconnect Google Ads.');
      setError(message);
      toast.error(message);
      await loadStatus();
    } finally {
      setAction(null);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!connection.connected || !connection.expiresAt) return;
    if (!connection.canRefresh) return;

    const refreshDelay = Math.max(
      0,
      connection.expiresAt - Date.now() - 4 * MINUTE_MS
    );
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, refreshDelay);

    return () => window.clearTimeout(timer);
  }, [
    connection.connected,
    connection.expiresAt,
    connection.canRefresh,
    loadStatus,
  ]);

  useEffect(() => {
    if (handledCodeRef.current) return;
    handledCodeRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    const oauthErrorDescription = params.get('error_description');
    const code = params.get('code');
    const state = params.get('state');

    // Only this card handles Google OAuth callbacks.
    if (state !== 'google_ads') {
      void loadStatus();
      return;
    }

    if (oauthError) {
      const message =
        oauthErrorDescription || oauthError || 'Google Ads authorization failed.';
      setError(message);
      toast.error(message);
      cleanOAuthParams();
      setLoading(false);
      void loadStatus();
      return;
    }

    if (code?.trim()) {
      void connectWithCode(code.trim());
      return;
    }

    void loadStatus();
  }, [connectWithCode, loadStatus]);

  return (
    <Card className="w-full max-w-xl shadow-sm">
      <CardHeader className="space-y-3 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background shadow-sm">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            </div>
            <div>
              <CardTitle className="text-base">Google Ads</CardTitle>
              <CardDescription className="text-xs">
                Keyword research plugin
              </CardDescription>
            </div>
          </div>

          <ConnectionBadge
            connected={connection.connected}
            isAccessExpired={isAccessExpired}
            isRefreshExpired={connection.isRefreshExpired}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Google Ads error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/20 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking connection…
          </div>
        ) : connection.connected ? (
          <>
            <div className="space-y-3">
              <TokenExpiryBlock
                title="Access token expiry"
                expiresAt={connection.expiresAt}
                now={now}
                helperText={
                  isAccessExpired && connection.canRefresh
                    ? 'Expired — click Refresh to renew without reconnecting.'
                    : isAccessExpired && !connection.canRefresh
                      ? 'Access expired and refresh is unavailable. Reconnect required.'
                      : undefined
                }
              />

              <GoogleRefreshBlock connection={connection} now={now} />
            </div>

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={refreshToken}
                disabled={isBusy || !connection.canRefresh}
                title={
                  !connection.canRefresh
                    ? 'Refresh token unavailable — reconnect required'
                    : undefined
                }
              >
                {action === 'refresh' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>

              <Button
                variant="destructive"
                onClick={() => setDisconnectDialogOpen(true)}
                disabled={isBusy}
              >
                <Unplug className="mr-2 h-4 w-4" />
                Disconnect
              </Button>

              {connection.isRefreshExpired || !connection.canRefresh ? (
                <Button
                  onClick={startConnect}
                  variant="outline"
                  disabled={isBusy}
                >
                  {connectingRedirect ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="mr-2 h-4 w-4" />
                  )}
                  Reconnect
                </Button>
              ) : null}
            </div>

            <DisconnectConfirmDialog
              open={disconnectDialogOpen}
              onOpenChange={setDisconnectDialogOpen}
              providerName="Google Ads"
              confirming={action === 'disconnect'}
              onConfirm={() => {
                void disconnect();
              }}
            />
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect Google Ads to power keyword research tools.
            </p>
            <Button onClick={startConnect} disabled={isBusy}>
              {connectingRedirect || action === 'connect' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-2 h-4 w-4" />
              )}
              Connect Google Ads
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const IntegrationsPage = () => {
  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-7"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Connections</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-col gap-6 p-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">
            Integrations
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage third-party API connections used by the admin tools.
          </p>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-start">
          <AliExpressCard />
          <GoogleAdsCard />
        </div>
      </main>
    </>
  );
};

export default IntegrationsPage;
