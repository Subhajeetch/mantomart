"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Loader2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, } from "@/components/ui/breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import Image from "next/image";

const API_BASE = "/api/ae";

const ALIEXPRESS_AUTH_URL =
  "https://api-sg.aliexpress.com/oauth/authorize?response_type=code&client_id=519374&redirect_uri=https://clean-bubble.vercel.app/callback";

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
};

type ConnectResponse = {
  success: true;
  message?: string;
  tokens?: TokenData;
  expires_at?: number | null;
  expiresAt?: number | null;
};

type RefreshResponse = {
  success: true;
  message?: string;
  accessToken?: string;
  tokens?: TokenData;
  expires_at?: number | null;
  expiresAt?: number | null;
  status?: StatusResponse;
};

type ConnectionState = {
  connected: boolean;
  expiresAt: number | null;
};

async function requestJson<T>(url: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    throw new Error("Unable to reach the server. Please try again.");
  }

  let data: unknown = null;

  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }

    throw new Error("Server returned an invalid response.");
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
    throw new Error(possibleError.error || possibleError.message || "Request failed.");
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

  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");

  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function formatDate(timestamp: number | null) {
  if (!timestamp) return "Unavailable";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatRemaining(timestamp: number | null) {
  if (!timestamp) return "Expiry time unavailable";

  const diffMs = timestamp - Date.now();

  if (diffMs <= 0) return "Expired";

  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} remaining`;

  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} remaining`;

  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}

const AliexpressConnect = () => {
  const handledCodeRef = useRef(false);

  const [connection, setConnection] = useState<ConnectionState>({
    connected: false,
    expiresAt: null,
  });

  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"connect" | "disconnect" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const isBusy = loading || action !== null;

  const isExpired = useMemo(() => {
    return connection.expiresAt !== null && connection.expiresAt <= now;
  }, [connection.expiresAt, now]);

  const loadStatus = useCallback(async () => {
    setError(null);

    try {
      const data = await requestJson<StatusResponse>(`${API_BASE}/status`);
      const expiresAt = getExpiresAt(data);

      setConnection((current) => ({
        connected: data.connected,
        expiresAt: data.connected ? expiresAt ?? current.expiresAt : null,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to check AliExpress status.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const connectWithCode = useCallback(
    async (code: string) => {
      setAction("connect");
      setError(null);

      try {
        const data = await requestJson<ConnectResponse>(
          `${API_BASE}/connect?code=${encodeURIComponent(code)}`
        );

        setConnection({
          connected: true,
          expiresAt: getExpiresAt(data),
        });

        cleanOAuthParams();
        toast.success(data.message || "AliExpress connected successfully.");
        await loadStatus();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to connect AliExpress.";
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
    setAction("refresh");
    setError(null);

    try {
      const data = await requestJson<RefreshResponse>(`${API_BASE}/refresh`);
      const expiresAt = getExpiresAt(data);

      setConnection((current) => ({
        connected: true,
        expiresAt: expiresAt ?? current.expiresAt,
      }));

      toast.success(data.message || "AliExpress token refreshed.");
      await loadStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh AliExpress token.";
      setError(message);
      toast.error(message);
    } finally {
      setAction(null);
    }
  };

  const disconnect = async () => {
    setAction("disconnect");
    setError(null);

    try {
      await requestJson(`${API_BASE}/disconnect`);

      setConnection({
        connected: false,
        expiresAt: null,
      });

      toast.success("AliExpress disconnected.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to disconnect AliExpress.";
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
    if (handledCodeRef.current) return;
    handledCodeRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    const oauthErrorDescription = params.get("error_description");
    const code = params.get("code");

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
                <BreadcrumbPage>Aliexpress Connection</BreadcrumbPage>
            </BreadcrumbItem>
            </BreadcrumbList>
        </Breadcrumb>
        </div>
    </header>
    
    <main className="p-4">
        <Card className="w-full max-w-xl">
            <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <CardTitle className="sr-only">AliExpress Connection</CardTitle>
                <Image src={"/icons/aliexpress_logo_long.png"} width={120} height={50} alt="Aliexpress Logo" />

                {connection.connected ? (
                <Badge variant={isExpired ? "destructive" : "default"} className="gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {isExpired ? "Expired" : "Connected"}
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
                    {action === "refresh" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Refresh
                    </Button>

                    <Button variant="destructive" onClick={disconnect} disabled={isBusy}>
                    {action === "disconnect" ? (
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
    </main>
       </>
  );
};

export default AliexpressConnect;