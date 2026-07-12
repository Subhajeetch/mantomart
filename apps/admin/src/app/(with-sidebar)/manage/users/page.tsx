'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Crown,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  UserCheck,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useSession } from '@/lib/auth-client';
import type { Session } from '@repo/types/session-client';

import { BanUserDialog } from './components/ban-user-dialog';
import { DeleteUserDialog } from './components/delete-user-dialog';
import { UserCard, UserCardSkeleton } from './components/user-card';
import {
  requestJson,
  type AdminUser,
  type ListMeta,
  type UserRole,
  type UserStats,
  type UserStatus,
} from './utils';

const PAGE_SIZE = 20;

export default function ManageUsersPage() {
  const { data: sessionData } = useSession();
  const session = sessionData as Session | null;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all');
  const [page, setPage] = useState(1);

  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const currentUserId = meta?.currentUserId ?? session?.user.id ?? '';
  const canBan = meta?.canBan ?? false;
  const canManage = meta?.canManage ?? false;

  const capabilities = useMemo(
    () => ({ canBan, canManage }),
    [canBan, canManage]
  );

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Reset to first page when filters change
  useEffect(() => {
    setPage(1);
  }, [roleFilter, statusFilter]);

  const loadUsers = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (page > 1) params.set('page', String(page));
        params.set('pageSize', String(PAGE_SIZE));
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (roleFilter !== 'all') params.set('role', roleFilter);
        if (statusFilter !== 'all') params.set('status', statusFilter);

        const qs = params.toString();
        // Use /all like the admins API — avoids mount-root trailing-slash quirks.
        const res = await requestJson<{
          success: true;
          data: AdminUser[];
          meta: ListMeta;
        }>(`/all${qs ? `?${qs}` : ''}`);

        setUsers(res.data);
        setMeta(res.meta);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load users.';
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [page, debouncedSearch, roleFilter, statusFilter]
  );

  const loadStats = useCallback(async () => {
    try {
      const res = await requestJson<{ success: true; data: UserStats }>(
        '/stats'
      );
      setStats(res.data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  async function handleBanConfirm(banned: boolean, reason?: string) {
    if (!banTarget) return;
    const user = banTarget;
    setBusyId(user.id);

    try {
      const res = await requestJson<{
        success: true;
        message?: string;
        data: AdminUser;
      }>(`/${user.id}/ban`, {
        method: 'PATCH',
        body: JSON.stringify({
          banned,
          reason: banned ? reason : undefined,
        }),
      });

      toast.success(
        res.message || (banned ? 'User banned.' : 'User unbanned.')
      );
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, ...res.data } : u))
      );
      setBanTarget(null);
      void loadStats();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update ban status.'
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    const user = deleteTarget;
    setBusyId(user.id);

    try {
      const res = await requestJson<{ success: true; message?: string }>(
        `/${user.id}`,
        { method: 'DELETE' }
      );

      toast.success(res.message || 'User deleted.');
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setMeta((m) =>
        m ? { ...m, total: Math.max(0, m.total - 1) } : m
      );
      setDeleteTarget(null);
      void loadStats();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete user.'
      );
    } finally {
      setBusyId(null);
    }
  }

  const showLimitedAccessBanner =
    !loading && meta && (!canManage || !canBan);

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
                <BreadcrumbPage>Manage Users</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Manage Users
            </h1>
            <p className="text-muted-foreground max-w-xl text-sm">
              View accounts, ban or unban users, and soft-delete accounts. To
              promote someone to admin or owner, use{' '}
              <strong>Manage Admins</strong>.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void loadUsers(true);
              void loadStats();
            }}
            disabled={loading || refreshing}
            className="gap-1.5"
          >
            <RefreshCw
              className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-3">
              <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                <Users className="size-4" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Total Users</p>
                <p className="text-lg font-semibold tabular-nums">
                  {statsLoading ? '—' : (stats?.total ?? '—')}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-green-500/10 text-green-600 dark:text-green-400">
                <UserCheck className="size-4" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Active</p>
                <p className="text-lg font-semibold tabular-nums">
                  {statsLoading ? '—' : (stats?.active ?? '—')}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-3">
              <div className="bg-destructive/10 text-destructive flex size-9 items-center justify-center rounded-lg">
                <Ban className="size-4" />
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Banned</p>
                <p className="text-lg font-semibold tabular-nums">
                  {statsLoading ? '—' : (stats?.banned ?? '—')}
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
                <p className="text-muted-foreground text-xs">Admins & Owners</p>
                <p className="text-lg font-semibold tabular-nums">
                  {statsLoading
                    ? '—'
                    : (stats?.byRole?.admin ?? 0) + (stats?.byRole?.owner ?? 0)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-2 px-3 py-2">
              <UserCheck className="text-muted-foreground size-4" />
              <div>
                <p className="text-muted-foreground text-xs">Customers</p>
                <p className="text-primary text-lg font-semibold tabular-nums">
                  {stats?.byRole?.customer ?? '—'}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-2 px-3 py-2">
              <Shield className="size-4 text-sky-500" />
              <div>
                <p className="text-muted-foreground text-xs">Admins</p>
                <p className="text-lg font-semibold tabular-nums text-sky-600">
                  {stats?.byRole?.admin ?? '—'}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm" className="bg-card/60">
            <CardContent className="flex items-center gap-2 px-3 py-2">
              <Crown className="size-4 text-amber-500" />
              <div>
                <p className="text-muted-foreground text-xs">Owners</p>
                <p className="text-lg font-semibold tabular-nums text-amber-600">
                  {stats?.byRole?.owner ?? '—'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {showLimitedAccessBanner && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              Your permissions are limited.
              {!canBan && ' You cannot ban users.'}
              {!canManage && ' You cannot delete users.'}
            </p>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              type="search"
              placeholder="Search by name, email, or id..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={roleFilter}
              onValueChange={(v) => setRoleFilter(v as UserRole | 'all')}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as UserStatus | 'all')}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All (not deleted)</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="banned">Banned</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <UserCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <ShieldAlert className="text-destructive size-8" />
              <div>
                <p className="font-medium">Could not load users</p>
                <p className="text-muted-foreground mt-1 text-sm">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadUsers()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : users.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="bg-muted flex size-12 items-center justify-center rounded-full">
                <Users className="text-muted-foreground size-6" />
              </div>
              <div>
                <p className="font-medium">No users found</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {debouncedSearch ||
                  roleFilter !== 'all' ||
                  statusFilter !== 'all'
                    ? 'Try adjusting your filters.'
                    : 'No users registered yet.'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {users.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  capabilities={capabilities}
                  isSelf={user.id === currentUserId}
                  onRequestBan={setBanTarget}
                  onRequestDelete={setDeleteTarget}
                  busyId={busyId}
                />
              ))}
            </div>

            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={meta.page <= 1 || loading}
                >
                  Previous
                </Button>
                <span className="text-muted-foreground text-sm tabular-nums">
                  Page {meta.page} of {meta.totalPages}
                  <span className="ml-2 opacity-70">
                    ({meta.total} total)
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPage((p) => Math.min(meta.totalPages, p + 1))
                  }
                  disabled={meta.page >= meta.totalPages || loading}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      <BanUserDialog
        user={banTarget}
        open={!!banTarget}
        onOpenChange={(open) => {
          if (!open) setBanTarget(null);
        }}
        onConfirm={(banned, reason) => void handleBanConfirm(banned, reason)}
        loading={busyId === banTarget?.id}
      />

      <DeleteUserDialog
        user={deleteTarget}
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => void handleDeleteConfirm()}
        loading={busyId === deleteTarget?.id}
      />
    </>
  );
}
