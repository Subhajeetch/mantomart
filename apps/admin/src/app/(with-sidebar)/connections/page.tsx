'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import Image from 'next/image';

// ─── Shared helpers ───────────────────────────────────────────────────────────

type TokenData = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
};

type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

type StatusResponse = {
  success?: boolean;
  connected: boolean;
  expires_at?: number | null;
  expiresAt?: number | null;
  is_expired?: boolean;
  has_refresh_token?: boolean;
};

type ConnectResponse = {
  success: true;
  message?: string;
  tokens?: TokenData;
  expires_at?: number | null;
  expiresAt?: number | null;
  connected?: boolean;
};

type RefreshResponse = {
  success: true;
  message?: string;
  tokens?: TokenData;
  expires_at?: number | null;
  expiresAt?: number | null;
};

type ConnectionState = {
  connected: boolean;
  expiresAt: number | null;
};

type ProviderAction = 'connect' | 'disconnect' | 'refresh' | null;

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
    throw new Error('Unable to reach the server. Please try again.');
  }

  let data: unknown = null;

  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }
    throw new Error('Server returned an invalid response.');
  }

  if (!response.ok) {
    const errorBody = data as ApiErrorBody;
    throw new Error(
      errorBody.error ||
        errorBody.message ||
        `Request failed with status ${response.status}.`
    );
  }

  const possibleError = data as ApiErrorBody;
  if (possibleError.success === false) {
    throw new Error(
      possibleError.error || possibleError.message || 'Request failed.'
    );
  }

  return data as T;
}

function getExpiresAt(data: unknown): number | null {
  const value = data as {
    expires_at?: unknown;
    expiresAt?: unknown;
    tokens?: { expires_at?: unknown };
    status?: { expires_at?: unknown; expiresAt?: unknown };
  };

  const candidates = [
    value.expires_at,
    value.expiresAt,
    value.tokens?.expires_at,
    value.status?.expires_at,
    value.status?.expiresAt,
  ];

  for (const candidate of candidates) {
    const timestamp = Number(candidate);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return timestamp;
    }
  }

  return null;
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

function formatRemaining(timestamp: number | null) {
  if (!timestamp) return 'Expiry time unavailable';

  const diffMs = timestamp - Date.now();
  if (diffMs <= 0) return 'Expired';

  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
  }

  const hours = Math.ceil(minutes / 60);
  if (hours < 48) {
    return `${hours} hour${hours === 1 ? '' : 's'} remaining`;
  }

  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} remaining`;
}

// ─── AliExpress ───────────────────────────────────────────────────────────────

const AE_API_BASE = '/api/ae';

const ALIEXPRESS_AUTH_URL =
  `https://api-sg.aliexpress.com/oauth/authorize?response_type=code&client_id=519374&redirect_uri=${process.env.NEXT_PUBLIC_APP_URL}/connections`;

function AliExpressCard() {
  const handledCodeRef = useRef(false);

  const [connection, setConnection] = useState<ConnectionState>({
    connected: false,
    expiresAt: null,
  });

  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<ProviderAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const isBusy = loading || action !== null;

  const isExpired = useMemo(() => {
    return connection.expiresAt !== null && connection.expiresAt <= now;
  }, [connection.expiresAt, now]);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const data = await requestJson<StatusResponse>(`${AE_API_BASE}/status`);
      const expiresAt = getExpiresAt(data);
      setConnection((current) => ({
        connected: data.connected,
        expiresAt: data.connected ? (expiresAt ?? current.expiresAt) : null,
      }));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to check AliExpress status.';
      setError(message);
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
        setConnection({
          connected: true,
          expiresAt: getExpiresAt(data),
        });
        cleanOAuthParams();
        toast.success(data.message || 'AliExpress connected successfully.');
        await loadStatus();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to connect AliExpress.';
        setError(message);
        toast.error(message);
      } finally {
        setAction(null);
        setLoading(false);
      }
    },
    [loadStatus]
  );

  const refreshToken = async () => {
    setAction('refresh');
    setError(null);
    try {
      const data = await requestJson<RefreshResponse>(`${AE_API_BASE}/refresh`);
      const expiresAt = getExpiresAt(data);
      setConnection((current) => ({
        connected: true,
        expiresAt: expiresAt ?? current.expiresAt,
      }));
      toast.success(data.message || 'AliExpress token refreshed.');
      await loadStatus();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to refresh AliExpress token.';
      setError(message);
      toast.error(message);
    } finally {
      setAction(null);
    }
  };

  const disconnect = async () => {
    setAction('disconnect');
    setError(null);
    try {
      await requestJson(`${AE_API_BASE}/disconnect`);
      setConnection({ connected: false, expiresAt: null });
      toast.success('AliExpress disconnected.');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to disconnect AliExpress.';
      setError(message);
      toast.error(message);
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
    const refreshDelay = Math.max(
      0,
      connection.expiresAt - Date.now() - 4 * 60_000
    );
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, refreshDelay);

    return () => window.clearTimeout(timer);
  }, [connection.connected, connection.expiresAt, loadStatus]);

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

    if (oauthError && state !== 'google_ads') {
      // Only treat as AE error when not a Google callback
      if (!state || state !== 'google_ads') {
        // If there's an error without google state, could be AE or unknown
      }
    }

    // AE callbacks typically have code without google_ads state
    if (oauthError && (!state || state !== 'google_ads')) {
      // Might be Google error without state — handled by Google card too.
      // Only surface AE errors when clearly not Google.
      if (state && state !== 'google_ads') {
        const message = oauthErrorDescription || oauthError;
        setError(message);
        toast.error(message);
        cleanOAuthParams();
      }
      setLoading(false);
      void loadStatus();
      return;
    }

    if (code?.trim() && state !== 'google_ads') {
      void connectWithCode(code.trim());
      return;
    }

    void loadStatus();
  }, [connectWithCode, loadStatus]);

  return (
    <Card className="w-full max-w-xl">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="sr-only">AliExpress Connection</CardTitle>
          <Image
            src={'/icons/aliexpress_logo_long.png'}
            width={120}
            height={50}
            alt="Aliexpress Logo"
          />

          {connection.connected ? (
            <Badge
              variant={isExpired ? 'destructive' : 'default'}
              className="gap-1"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {isExpired ? 'Expired' : 'Connected'}
            </Badge>
          ) : (
            <Badge variant="secondary">Not connected</Badge>
          )}
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking connection...
          </div>
        ) : connection.connected ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4" />
                Token expiry
              </div>
              <div className="text-sm text-muted-foreground">
                <p>{formatDate(connection.expiresAt)}</p>
                <p>{formatRemaining(connection.expiresAt)}</p>
              </div>
            </div>

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button onClick={refreshToken} disabled={isBusy}>
                {action === 'refresh' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>

              <Button
                variant="destructive"
                onClick={disconnect}
                disabled={isBusy}
              >
                {action === 'disconnect' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Unplug className="mr-2 h-4 w-4" />
                )}
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <Button asChild disabled={isBusy}>
            <a href={ALIEXPRESS_AUTH_URL}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Connect AliExpress
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Google Ads ───────────────────────────────────────────────────────────────

const GOOGLE_API_BASE = '/api/google';

function GoogleAdsCard() {
  const handledCodeRef = useRef(false);

  const [connection, setConnection] = useState<ConnectionState>({
    connected: false,
    expiresAt: null,
  });

  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<ProviderAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [connectingRedirect, setConnectingRedirect] = useState(false);

  const isBusy = loading || action !== null || connectingRedirect;

  const isExpired = useMemo(() => {
    return connection.expiresAt !== null && connection.expiresAt <= now;
  }, [connection.expiresAt, now]);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const data = await requestJson<StatusResponse>(
        `${GOOGLE_API_BASE}/status`
      );
      const expiresAt = getExpiresAt(data);
      setConnection((current) => ({
        connected: data.connected,
        expiresAt: data.connected ? (expiresAt ?? current.expiresAt) : null,
      }));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to check Google Ads status.';
      setError(message);
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
        setConnection({
          connected: true,
          expiresAt: getExpiresAt(data),
        });
        cleanOAuthParams();
        toast.success(data.message || 'Google Ads connected successfully.');
        await loadStatus();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to connect Google Ads.';
        setError(message);
        toast.error(message);
        cleanOAuthParams();
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
        throw new Error('Server did not return a Google auth URL.');
      }
      window.location.href = data.url;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to start Google Ads connection.';
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
      const expiresAt = getExpiresAt(data);
      setConnection((current) => ({
        connected: true,
        expiresAt: expiresAt ?? current.expiresAt,
      }));
      toast.success(data.message || 'Google Ads token refreshed.');
      await loadStatus();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to refresh Google Ads token.';
      setError(message);
      toast.error(message);
    } finally {
      setAction(null);
    }
  };

  const disconnect = async () => {
    setAction('disconnect');
    setError(null);
    try {
      await requestJson(`${GOOGLE_API_BASE}/disconnect`);
      setConnection({ connected: false, expiresAt: null });
      toast.success('Google Ads disconnected.');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to disconnect Google Ads.';
      setError(message);
      toast.error(message);
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
    const refreshDelay = Math.max(
      0,
      connection.expiresAt - Date.now() - 4 * 60_000
    );
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, refreshDelay);

    return () => window.clearTimeout(timer);
  }, [connection.connected, connection.expiresAt, loadStatus]);

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
      const message = oauthErrorDescription || oauthError;
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
    <Card className="w-full max-w-xl">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background">
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
              <p className="text-xs text-muted-foreground">
                Keyword research plugin
              </p>
            </div>
          </div>

          {connection.connected ? (
            <Badge
              variant={isExpired ? 'destructive' : 'default'}
              className="gap-1"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {isExpired ? 'Expired' : 'Connected'}
            </Badge>
          ) : (
            <Badge variant="secondary">Not connected</Badge>
          )}
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking connection...
          </div>
        ) : connection.connected ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4" />
                Access token expiry
              </div>
              <div className="text-sm text-muted-foreground">
                <p>{formatDate(connection.expiresAt)}</p>
                <p>{formatRemaining(connection.expiresAt)}</p>
              </div>
            </div>

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button onClick={refreshToken} disabled={isBusy}>
                {action === 'refresh' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>

              <Button
                variant="destructive"
                onClick={disconnect}
                disabled={isBusy}
              >
                {action === 'disconnect' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Unplug className="mr-2 h-4 w-4" />
                )}
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <Button onClick={startConnect} disabled={isBusy}>
            {connectingRedirect || action === 'connect' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="mr-2 h-4 w-4" />
            )}
            Connect Google Ads
          </Button>
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
        <div className="flex items-center gap-2 px-4 ">
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

      <main className="flex flex-col gap-4 p-4 lg:flex-row lg:flex-wrap lg:items-start">
        <AliExpressCard />
        <GoogleAdsCard />
      </main>
    </>
  );
};

export default IntegrationsPage;
