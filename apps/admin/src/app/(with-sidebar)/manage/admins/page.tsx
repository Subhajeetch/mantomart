'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Plus, RefreshCw, ShieldAlert, Users } from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSession } from '@/lib/auth-client';
import type { Session } from '@repo/types/session-client';

import { AddAdminDialog } from './components/add-admin-dialog';
import { AdminCard, AdminCardSkeleton } from './components/admin-card';
import { AdminStatsDialog } from './components/admin-stats-dialog';
import { RemoveAdminDialog } from './components/remove-admin-dialog';
import { UpdatePermissionsDialog } from './components/update-permissions-dialog';
import type { AdminRole, AdminUser, ListMeta } from './utils';
import { requestJson } from './utils';

export default function ManageAdminsPage() {
  const { data: sessionData } = useSession();
  const session = sessionData as Session | null;

  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
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

            <Button
              variant="outline"
              size="sm"
              onClick={() => setStatsDialogOpen(true)}
              className="gap-1.5"
            >
              <BarChart3 className="size-3.5" />
              Stats
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

        {/* Stats dialog — computed from loaded admin list */}
        <AdminStatsDialog
          open={statsDialogOpen}
          onOpenChange={setStatsDialogOpen}
          total={meta?.total ?? admins.length}
          ownerCount={ownerCount}
          adminCount={adminCount}
          loading={loading}
        />

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