'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Clock,
  Crown,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSession } from '@/lib/auth-client';
import type { Session } from '@repo/types/session-client';

// ─── Types ────────────────────────────────────────────────────────────────────

type AdminRole = 'admin' | 'owner';

type AdminUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: 'customer' | AdminRole;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  isBanned: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListMeta = {
  currentUserId: string;
  currentUserRole: string;
  canManage: boolean;
  total: number;
};

type PermissionState = {
  permission: string;
  granted: boolean;
  defaultGranted: boolean;
  override: boolean | null;
};

type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

// ─── API helpers ──────────────────────────────────────────────────────────────

function getAdminsApiBase() {
  const origin = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  // Prefer absolute API origin so session cookies (set by better-auth) are sent.
  // Fall back to same-origin rewrite when the env var is not set.
  return origin ? `${origin}/api/admins` : '/api/admins';
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getAdminsApiBase();
  const url = path.startsWith('http')
    ? path
    : `${base}${path.startsWith('/') ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      cache: 'no-store',
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

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return 'Never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatRelative(value: string | Date | null | undefined) {
  if (!value) return 'Never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), 'day');
  return formatDateTime(date);
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function looksLikeEmail(value: string) {
  return value.includes('@');
}

function formatPermissionText(value: string) {
  return value
    .replace(/[:_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getPermissionGroup(permission: string) {
  return formatPermissionText(permission.split(':')[0] ?? 'Other');
}

function getPermissionAction(permission: string) {
  return formatPermissionText(permission.split(':')[1] ?? permission);
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  if (role === 'owner') {
    return (
      <Badge className="gap-1 bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-400">
        <Crown className="size-3" />
        Owner
      </Badge>
    );
  }
  if (role === 'admin') {
    return (
      <Badge className="gap-1 bg-sky-500/15 text-sky-700 ring-1 ring-sky-500/25 dark:text-sky-400">
        <Shield className="size-3" />
        Admin
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Users className="size-3" />
      {role}
    </Badge>
  );
}

function AdminCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b pb-4">
        <div className="flex items-start gap-3">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-2/3" />
      </CardContent>
      <CardFooter className="gap-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
      </CardFooter>
    </Card>
  );
}

function AdminCard({
  admin,
  canManage,
  isSelf,
  onChangeRole,
  onUpdatePermissions,
  onRemove,
  busyId,
}: {
  admin: AdminUser;
  canManage: boolean;
  isSelf: boolean;
  onChangeRole: (id: string, role: AdminRole) => void;
  onUpdatePermissions: (admin: AdminUser) => void;
  onRemove: (admin: AdminUser) => void;
  busyId: string | null;
}) {
  const busy = busyId === admin.id;
  const disabled = !canManage || busy;

  return (
    <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
      {admin.role === 'owner' && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500" />
      )}

      <CardHeader className="border-b pb-4">
        <div className="flex items-start gap-3">
          <Avatar className="size-12 ring-2 ring-background shadow-sm">
            <AvatarImage src={admin.image ?? undefined} alt={admin.name} />
            <AvatarFallback className="bg-muted text-sm font-semibold">
              {getInitials(admin.name)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="truncate text-base">{admin.name}</CardTitle>
              {isSelf && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  You
                </Badge>
              )}
              {admin.emailVerified && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <BadgeCheck className="size-4 shrink-0 text-sky-500" />
                  </TooltipTrigger>
                  <TooltipContent>Email verified</TooltipContent>
                </Tooltip>
              )}
            </div>
            <CardDescription className="mt-0.5 truncate">
              {admin.email}
            </CardDescription>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <RoleBadge role={admin.role} />
              {admin.isBanned && (
                <Badge variant="destructive" className="gap-1">
                  <ShieldAlert className="size-3" />
                  Banned
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2.5 pt-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Clock className="size-3.5 shrink-0" />
            Last login
          </span>
          <div className="text-right">
            <p className="font-medium leading-tight">
              {formatRelative(admin.lastLoginAt)}
            </p>
            {admin.lastLoginAt && (
              <p className="text-muted-foreground mt-0.5 text-xs">
                {formatDateTime(admin.lastLoginAt)}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Last active</span>
          <p className="text-right font-medium">
            {formatRelative(admin.lastActiveAt)}
          </p>
        </div>

        {admin.lastLoginIp && (
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Last IP</span>
            <p className="font-mono text-xs">{admin.lastLoginIp}</p>
          </div>
        )}

        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Joined</span>
          <p className="text-right text-xs font-medium">
            {formatDateTime(admin.createdAt)}
          </p>
        </div>

        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">User ID</span>
          <p className="max-w-[55%] truncate font-mono text-[11px] text-muted-foreground">
            {admin.id}
          </p>
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    className="gap-1.5"
                  >
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <UserCog className="size-3.5" />
                    )}
                    Change role
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuLabel>Set role</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={admin.role === 'admin' || busy}
                    onClick={() => onChangeRole(admin.id, 'admin')}
                  >
                    <Shield className="size-3.5" />
                    Admin
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={admin.role === 'owner' || busy}
                    onClick={() => onChangeRole(admin.id, 'owner')}
                  >
                    <Crown className="size-3.5" />
                    Owner
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </TooltipTrigger>
          {!canManage && (
            <TooltipContent>Only owners can change admin roles</TooltipContent>
          )}
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                className="gap-1.5"
                onClick={() => onUpdatePermissions(admin)}
              >
                <SlidersHorizontal className="size-3.5" />
                Update Permissions
              </Button>
            </span>
          </TooltipTrigger>
          {!canManage && (
            <TooltipContent>Only owners can update permissions</TooltipContent>
          )}
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                variant="destructive"
                size="sm"
                disabled={disabled || isSelf}
                className="gap-1.5"
                onClick={() => onRemove(admin)}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ShieldOff className="size-3.5" />
                )}
                Remove
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {!canManage
              ? 'Only owners can remove admins'
              : isSelf
                ? 'You cannot remove yourself'
                : 'Remove admin privileges'}
          </TooltipContent>
        </Tooltip>
      </CardFooter>
    </Card>
  );
}

function UserPreviewCard({
  user,
  alreadyAdmin,
}: {
  user: AdminUser;
  alreadyAdmin: boolean;
}) {
  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <Avatar className="size-14 ring-2 ring-background shadow-sm">
          <AvatarImage src={user.image ?? undefined} alt={user.name} />
          <AvatarFallback className="text-sm font-semibold">
            {getInitials(user.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold">{user.name}</p>
            <RoleBadge role={user.role} />
            {user.emailVerified && (
              <BadgeCheck className="size-4 text-sky-500" />
            )}
          </div>
          <p className="text-muted-foreground flex items-center gap-1.5 truncate text-sm">
            <Mail className="size-3.5 shrink-0" />
            {user.email}
          </p>
          {(user.firstName || user.lastName) && (
            <p className="text-muted-foreground text-xs">
              {[user.firstName, user.lastName].filter(Boolean).join(' ')}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-background/80 p-2.5 ring-1 ring-foreground/5">
          <p className="text-muted-foreground mb-0.5">Last login</p>
          <p className="font-medium">{formatRelative(user.lastLoginAt)}</p>
        </div>
        <div className="rounded-lg bg-background/80 p-2.5 ring-1 ring-foreground/5">
          <p className="text-muted-foreground mb-0.5">Joined</p>
          <p className="font-medium">{formatDateTime(user.createdAt)}</p>
        </div>
        <div className="col-span-2 rounded-lg bg-background/80 p-2.5 ring-1 ring-foreground/5">
          <p className="text-muted-foreground mb-0.5">User ID</p>
          <p className="truncate font-mono text-[11px]">{user.id}</p>
        </div>
      </div>

      {alreadyAdmin && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <ShieldAlert className="size-3.5 shrink-0" />
          This user is already an admin.
        </div>
      )}
    </div>
  );
}

// ─── Add Admin Dialog ─────────────────────────────────────────────────────────

function AddAdminDialog({
  open,
  onOpenChange,
  canManage,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<AdminRole>('admin');
  const [preview, setPreview] = useState<AdminUser | null>(null);
  const [alreadyAdmin, setAlreadyAdmin] = useState(false);
  const [canPromote, setCanPromote] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [adding, setAdding] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setQuery('');
    setRole('admin');
    setPreview(null);
    setAlreadyAdmin(false);
    setCanPromote(false);
    setLookingUp(false);
    setAdding(false);
    setLookupError(null);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  async function handleLookup(e?: React.FormEvent) {
    e?.preventDefault();
    const value = query.trim();
    if (!value) {
      setLookupError('Enter an email address or user id.');
      return;
    }

    setLookingUp(true);
    setLookupError(null);
    setPreview(null);
    setAlreadyAdmin(false);
    setCanPromote(false);

    try {
      const param = looksLikeEmail(value)
        ? `email=${encodeURIComponent(value.toLowerCase())}`
        : `id=${encodeURIComponent(value)}`;

      const res = await requestJson<{
        success: true;
        data: AdminUser;
        meta: { alreadyAdmin: boolean; canPromote: boolean };
      }>(`/lookup?${param}`);

      setPreview(res.data);
      setAlreadyAdmin(res.meta.alreadyAdmin);
      setCanPromote(res.meta.canPromote);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed.');
    } finally {
      setLookingUp(false);
    }
  }

  async function handleAdd() {
    if (!preview || !canPromote) return;

    setAdding(true);
    try {
      const body = looksLikeEmail(query.trim())
        ? { email: preview.email, role }
        : { id: preview.id, role };

      await requestJson<{ success: true; message?: string }>('/add', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      toast.success(
        `${preview.name} has been added as ${role === 'owner' ? 'an owner' : 'an admin'}.`
      );
      onOpenChange(false);
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add admin.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-4" />
            Add admin
          </DialogTitle>
          <DialogDescription>
            Search for a registered user by email or id, preview their profile,
            then promote them.
          </DialogDescription>
        </DialogHeader>

        {!canManage ? (
          <div className="rounded-lg bg-destructive/10 px-3 py-3 text-sm text-destructive">
            Only owners can add new admins.
          </div>
        ) : (
          <div className="space-y-4">
            <form onSubmit={handleLookup} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLookupError(null);
                  }}
                  placeholder="Email or user id"
                  className="pl-8"
                  disabled={lookingUp || adding}
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                disabled={lookingUp || adding || !query.trim()}
              >
                {lookingUp ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  'Look up'
                )}
              </Button>
            </form>

            {lookupError && (
              <p className="text-destructive text-sm">{lookupError}</p>
            )}

            {preview && (
              <>
                <UserPreviewCard user={preview} alreadyAdmin={alreadyAdmin} />

                {canPromote && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Assign role</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRole('admin')}
                        disabled={adding}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                          role === 'admin'
                            ? 'border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-400'
                            : 'hover:bg-muted border-border text-muted-foreground'
                        }`}
                      >
                        <Shield className="size-3.5" />
                        Admin
                      </button>
                      <button
                        type="button"
                        onClick={() => setRole('owner')}
                        disabled={adding}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                          role === 'owner'
                            ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                            : 'hover:bg-muted border-border text-muted-foreground'
                        }`}
                      >
                        <Crown className="size-3.5" />
                        Owner
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={adding}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!canManage || !preview || !canPromote || adding}
            className="gap-1.5"
          >
            {adding ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Confirm add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Update Permissions Dialog ────────────────────────────────────────────────

function PermissionStatus({ permission }: { permission: PermissionState }) {
  if (permission.override === true) {
    return (
      <Badge variant="outline" className="text-[10px]">
        Override: granted
      </Badge>
    );
  }

  if (permission.override === false) {
    return (
      <Badge variant="outline" className="text-[10px]">
        Override: denied
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="text-[10px]">
      Default: {permission.defaultGranted ? 'granted' : 'denied'}
    </Badge>
  );
}

function UpdatePermissionsDialog({
  admin,
  open,
  onOpenChange,
  canManage,
}: {
  admin: AdminUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}) {
  const [permissions, setPermissions] = useState<PermissionState[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerHasAllPermissions, setOwnerHasAllPermissions] = useState(false);

  const reset = useCallback(() => {
    setPermissions([]);
    setSelected(new Set());
    setLoading(false);
    setSaving(false);
    setError(null);
    setOwnerHasAllPermissions(false);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    if (!admin || !canManage) return;

    const target = admin;
    let cancelled = false;

    async function loadPermissions() {
      setLoading(true);
      setError(null);

      try {
        const res = await requestJson<{
          success: true;
          data: {
            user: AdminUser;
            permissions: PermissionState[];
          };
          meta: {
            canUpdate: boolean;
            ownerHasAllPermissions: boolean;
          };
        }>(`/${target.id}/permissions`);

        if (cancelled) return;

        setPermissions(res.data.permissions);
        setSelected(
          new Set(
            res.data.permissions
              .filter((permission) => permission.granted)
              .map((permission) => permission.permission)
          )
        );
        setOwnerHasAllPermissions(res.meta.ownerHasAllPermissions);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load permissions.';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPermissions();

    return () => {
      cancelled = true;
    };
  }, [admin, canManage, open, reset]);

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, PermissionState[]>();

    for (const permission of permissions) {
      const group = getPermissionGroup(permission.permission);
      groups.set(group, [...(groups.get(group) ?? []), permission]);
    }

    return Array.from(groups, ([group, items]) => ({ group, items }));
  }, [permissions]);

  const isDirty = useMemo(() => {
    if (permissions.length === 0) return false;
    return permissions.some(
      (permission) => permission.granted !== selected.has(permission.permission)
    );
  }, [permissions, selected]);

  function togglePermission(permission: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(permission);
      else next.delete(permission);
      return next;
    });
  }

  async function handleSave() {
    if (!admin) return;

    setSaving(true);
    try {
      const res = await requestJson<{
        success: true;
        message?: string;
        data: {
          user: AdminUser;
          permissions: PermissionState[];
        };
      }>(`/${admin.id}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: Array.from(selected) }),
      });

      setPermissions(res.data.permissions);
      setSelected(
        new Set(
          res.data.permissions
            .filter((permission) => permission.granted)
            .map((permission) => permission.permission)
        )
      );
      toast.success(res.message || 'Permissions updated.');
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update permissions.'
      );
    } finally {
      setSaving(false);
    }
  }

  const controlsDisabled =
    !canManage || loading || saving || ownerHasAllPermissions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            Update Permissions
          </DialogTitle>
          <DialogDescription>
            {admin ? (
              <>
                Manage effective permissions for{' '}
                <span className="font-medium text-foreground">
                  {admin.name}
                </span>
                .
              </>
            ) : (
              'Manage admin permissions.'
            )}
          </DialogDescription>
        </DialogHeader>

        {!canManage ? (
          <div className="rounded-lg bg-destructive/10 px-3 py-3 text-sm text-destructive">
            Only owners can update permissions.
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {ownerHasAllPermissions && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                <Crown className="mt-0.5 size-4 shrink-0" />
                Owners always have every permission.
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={controlsDisabled}
                onClick={() =>
                  setSelected(
                    new Set(
                      permissions.map((permission) => permission.permission)
                    )
                  )
                }
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={controlsDisabled}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>

            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
              {groupedPermissions.map(({ group, items }) => (
                <div key={group} className="space-y-2">
                  <p className="text-sm font-medium">{group}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map((permission) => {
                      const checked = selected.has(permission.permission);

                      return (
                        <label
                          key={permission.permission}
                          className={`flex min-h-16 items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                            checked
                              ? 'border-primary/30 bg-primary/5'
                              : 'bg-background'
                          } ${
                            controlsDisabled
                              ? 'cursor-not-allowed opacity-70'
                              : 'cursor-pointer hover:bg-muted/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 size-4 accent-primary"
                            checked={checked}
                            disabled={controlsDisabled}
                            onChange={(event) =>
                              togglePermission(
                                permission.permission,
                                event.target.checked
                              )
                            }
                          />
                          <span className="min-w-0 flex-1 space-y-1">
                            <span className="block text-sm font-medium leading-tight">
                              {getPermissionAction(permission.permission)}
                            </span>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {permission.permission}
                              </code>
                              <PermissionStatus permission={permission} />
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !canManage ||
              !admin ||
              loading ||
              saving ||
              !!error ||
              ownerHasAllPermissions ||
              !isDirty
            }
            className="gap-1.5"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Remove confirmation dialog ───────────────────────────────────────────────

function RemoveAdminDialog({
  admin,
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  admin: AdminUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  if (!admin) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton>
        <DialogHeader>
          <DialogTitle>Remove admin access?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{admin.name}</span> (
            {admin.email}) will be demoted to a regular customer. They will lose
            all admin privileges immediately.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={loading}
            className="gap-1.5"
          >
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            Remove admin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ManageAdminsPage() {
  const { data: sessionData } = useSession();
  const session = sessionData as Session | null;

  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [permissionsTarget, setPermissionsTarget] = useState<AdminUser | null>(
    null
  );
  const [removeTarget, setRemoveTarget] = useState<AdminUser | null>(null);

  const canManage = meta?.canManage ?? session?.user.role === 'owner';
  const currentUserId = meta?.currentUserId ?? session?.user.id ?? '';

  const loadAdmins = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const res = await requestJson<{
        success: true;
        data: AdminUser[];
        meta: ListMeta;
      }>('/all');
      setAdmins(res.data);
      setMeta(res.meta);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load admins.';
      setError(message);
      if (!silent) toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAdmins();
  }, [loadAdmins]);

  async function handleChangeRole(id: string, role: AdminRole) {
    setBusyId(id);
    try {
      const res = await requestJson<{
        success: true;
        message?: string;
        data: AdminUser;
      }>(`/${id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      toast.success(res.message || 'Role updated.');
      setAdmins((prev) =>
        prev
          .map((a) => (a.id === id ? { ...a, ...res.data } : a))
          .sort((a, b) => {
            if (a.role === b.role) return a.name.localeCompare(b.name);
            if (a.role === 'owner') return -1;
            if (b.role === 'owner') return 1;
            return 0;
          })
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update role.'
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemoveConfirm() {
    if (!removeTarget) return;
    const id = removeTarget.id;
    setBusyId(id);
    try {
      const res = await requestJson<{ success: true; message?: string }>(
        `/${id}`,
        { method: 'DELETE' }
      );
      toast.success(res.message || 'Admin removed.');
      setAdmins((prev) => prev.filter((a) => a.id !== id));
      setMeta((m) => (m ? { ...m, total: Math.max(0, m.total - 1) } : m));
      setRemoveTarget(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to remove admin.'
      );
    } finally {
      setBusyId(null);
    }
  }

  const ownerCount = useMemo(
    () => admins.filter((a) => a.role === 'owner').length,
    [admins]
  );
  const adminCount = useMemo(
    () => admins.filter((a) => a.role === 'admin').length,
    [admins]
  );

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
                <BreadcrumbPage>Manage Admins</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pt-0">
        {/* Page header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sr-only">
              Manage Admins
            </h1>
            <p className="text-muted-foreground max-w-xl text-sm">
              View team members with admin access, monitor activity, and manage
              roles. Only owners can add, update, or remove admins.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadAdmins(true)}
              disabled={loading || refreshing}
              className="gap-1.5"
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    size="sm"
                    disabled={!canManage}
                    onClick={() => setAddOpen(true)}
                    className="gap-1.5"
                  >
                    <Plus className="size-3.5" />
                    Add admin
                  </Button>
                </span>
              </TooltipTrigger>
              {!canManage && (
                <TooltipContent>Only owners can add new admins</TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Users className="size-4" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total</p>
                <p className="text-lg font-semibold tabular-nums">
                  {loading ? '—' : (meta?.total ?? admins.length)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Crown className="size-4" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Owners</p>
                <p className="text-lg font-semibold tabular-nums">
                  {loading ? '—' : ownerCount}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <Shield className="size-4" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Admins</p>
                <p className="text-lg font-semibold tabular-nums">
                  {loading ? '—' : adminCount}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {!canManage && !loading && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              You are signed in as an <strong>admin</strong>. You can view the
              team, but only owners can add, update roles, update permissions,
              or remove admins.
            </p>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <AdminCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <ShieldAlert className="text-destructive size-8" />
              <div>
                <p className="font-medium">Could not load admins</p>
                <p className="text-muted-foreground mt-1 text-sm">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadAdmins()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : admins.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="bg-muted flex size-12 items-center justify-center rounded-full">
                <Users className="text-muted-foreground size-6" />
              </div>
              <div>
                <p className="font-medium">No admins found</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Promote a user to get started.
                </p>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  Add admin
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {admins.map((admin) => (
              <AdminCard
                key={admin.id}
                admin={admin}
                canManage={canManage}
                isSelf={admin.id === currentUserId}
                onChangeRole={handleChangeRole}
                onUpdatePermissions={setPermissionsTarget}
                onRemove={setRemoveTarget}
                busyId={busyId}
              />
            ))}
          </div>
        )}
      </main>

      <AddAdminDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        canManage={canManage}
        onAdded={() => void loadAdmins(true)}
      />

      <UpdatePermissionsDialog
        admin={permissionsTarget}
        open={!!permissionsTarget}
        onOpenChange={(open) => {
          if (!open) setPermissionsTarget(null);
        }}
        canManage={canManage}
      />

      <RemoveAdminDialog
        admin={removeTarget}
        open={!!removeTarget}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        onConfirm={() => void handleRemoveConfirm()}
        loading={busyId === removeTarget?.id}
      />
    </>
  );
}
