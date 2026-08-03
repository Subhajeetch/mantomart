'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  Calendar,
  Clock,
  Crown,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  RefreshCw,
  Shield,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import {
  formatDate,
  formatDateTime,
  formatRelative,
  getInitials,
  getProfileEditUrl,
  maskIp,
  providerLabel,
  requestAccountJson,
  type AdminAccount,
} from './utils';

function RoleBadge({ role }: { role: string }) {
  if (role === 'owner') {
    return (
      <Badge className="gap-1 bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-400">
        <Crown className="size-3" />
        Owner
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-sky-500/15 text-sky-700 ring-1 ring-sky-500/25 dark:text-sky-400">
      <Shield className="size-3" />
      Admin
    </Badge>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  hint,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="bg-muted/60 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg border">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </p>
        <p
          className={cn(
            'text-sm font-medium break-words',
            mono && 'font-mono text-xs tabular-nums'
          )}
          title={hint}
        >
          {value}
        </p>
        {hint ? (
          <p className="text-muted-foreground text-xs">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="w-full space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="border-b pb-6">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-1 divide-y pt-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <Skeleton className="size-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}

export default function AccountPage() {
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccount = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await requestAccountJson<{
        success: true;
        data: AdminAccount;
      }>();
      setAccount(res.data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load account.';
      setError(message);
      if (!silent) toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  function handleEdit() {
    const url = getProfileEditUrl();
    // External store origin — hard navigation is intentional.
    window.location.assign(url);
  }

  const displayName =
    account?.name?.trim() ||
    [account?.firstName, account?.lastName].filter(Boolean).join(' ') ||
    'Account';

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]:sidebar-wrapper:h-12">
        <div className="flex w-full items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-7"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Account</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="ml-auto flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={loading || refreshing}
                  onClick={() => void loadAccount(true)}
                  aria-label="Refresh account"
                >
                  <RefreshCw
                    className={cn('size-4', refreshing && 'animate-spin')}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>

            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={handleEdit}
            >
              <Pencil className="size-3.5" />
              Edit
              <ExternalLink className="size-3 opacity-60" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 px-4 pb-10 pt-0 md:px-6">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Account
          </h1>
          <p className="text-muted-foreground text-sm">
            Your profile and recent activity. Edit opens the store profile page.
          </p>
        </div>

        {loading ? <AccountSkeleton /> : null}

        {!loading && error ? (
          <div className="mx-auto w-full max-w-2xl">
            <Alert variant="destructive">
              <ShieldAlert className="size-4" />
              <AlertTitle>Could not load account</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{error}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit gap-1.5 border-destructive/30 bg-background"
                  onClick={() => void loadAccount()}
                >
                  <RefreshCw className="size-3.5" />
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        {!loading && !error && account ? (
          <div className="w-full space-y-6">
            {/* Profile hero */}
            <Card className={`overflow-hidden ${account.role === 'owner' ? (
                "border-t border-orange-500"
              ) : (
                "border-t border-sky-500"
              )}`}>
              

              <CardHeader className="border-b pb-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <Avatar className="size-16 ring-2 ring-background shadow-sm">
                    <AvatarImage
                      src={account.image ?? undefined}
                      alt={displayName}
                    />
                    <AvatarFallback className="bg-muted text-lg font-semibold">
                      {getInitials(displayName)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="truncate text-xl">
                        {displayName}
                      </CardTitle>
                      {account.emailVerified ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <BadgeCheck className="size-4 shrink-0 text-sky-500" />
                          </TooltipTrigger>
                          <TooltipContent>Email verified</TooltipContent>
                        </Tooltip>
                      ) : null}
                      <RoleBadge role={account.role} />
                    </div>
                    <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="size-3.5" />
                        {account.email}
                      </span>
                      {account.phone ? (
                        <span className="text-muted-foreground inline-flex items-center gap-1.5">
                          <Phone className="size-3.5" />
                          {account.phone}
                          {account.phoneVerified ? (
                            <Badge
                              variant="secondary"
                              className="text-[10px] font-medium"
                            >
                              Verified
                            </Badge>
                          ) : null}
                        </span>
                      ) : null}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="divide-y pt-1 pb-2">
                <InfoRow
                  icon={Clock}
                  label="Last login"
                  value={formatRelative(account.lastLoginAt)}
                  hint={
                    account.lastLoginAt
                      ? formatDateTime(account.lastLoginAt)
                      : undefined
                  }
                />
                <InfoRow
                  icon={Activity}
                  label="Last active"
                  value={formatRelative(account.lastActiveAt)}
                  hint={
                    account.lastActiveAt
                      ? formatDateTime(account.lastActiveAt)
                      : undefined
                  }
                />
                <InfoRow
                  icon={MapPin}
                  label="Last login IP"
                  value={maskIp(account.lastLoginIp)}
                  mono
                  hint={
                    account.lastLoginIp
                      ? 'Partially masked for privacy'
                      : undefined
                  }
                />
                <InfoRow
                  icon={Calendar}
                  label="Member since"
                  value={formatDate(account.createdAt)}
                />
                <InfoRow
                  icon={Smartphone}
                  label="Active sessions"
                  value={
                    account.activeSessionCount === 1
                      ? '1 session'
                      : `${account.activeSessionCount} sessions`
                  }
                />
              </CardContent>
            </Card>

            {/* Preferences + sign-in methods */}
            <div className="grid gap-6 sm:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Preferences</CardTitle>
                  <CardDescription>
                    Locale defaults for your account
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                      <Globe className="size-3.5" />
                      Locale
                    </span>
                    <span className="font-medium tabular-nums">
                      {account.locale || '—'}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Timezone</span>
                    <span className="max-w-[55%] truncate text-right font-medium">
                      {account.timezone || '—'}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Currency</span>
                    <span className="font-medium tabular-nums">
                      {account.currency || '—'}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Sign-in methods</CardTitle>
                  <CardDescription>
                    Ways you can access this account
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {account.linkedProviders.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No linked providers found.
                    </p>
                  ) : (
                    account.linkedProviders.map((p) => (
                      <div
                        key={p.providerId}
                        className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                      >
                        <div className="bg-muted/60 flex size-8 shrink-0 items-center justify-center rounded-md border">
                          <KeyRound className="text-muted-foreground size-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {providerLabel(p.providerId)}
                          </p>
                          {p.createdAt ? (
                            <p className="text-muted-foreground text-xs">
                              Linked {formatDate(p.createdAt)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}

        {!loading && !error && !account ? (
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center gap-3 py-16 text-center">
            <Loader2 className="text-muted-foreground size-8 animate-spin" />
            <p className="text-muted-foreground text-sm">Loading account…</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
