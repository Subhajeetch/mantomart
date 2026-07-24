'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Bell,
  Calendar,
  CheckCircle2,
  Coins,
  Crown,
  Edit,
  Globe,
  Loader2,
  Mail,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShoppingBag,
  Trash2,
  Unlock,
  User,
  UserCheck,
  UserX,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

import { BanUserDialog } from '../../components/ban-user-dialog';
import { DeleteUserDialog } from '../../components/delete-user-dialog';
import { UndeleteUserDialog } from '../../components/undelete-user-dialog';
import {
  formatBool,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelative,
  genderLabel,
  getInitials,
  getRoleBadgeVariant,
  getStatusBadgeVariant,
  getUserStatus,
  requestJson,
  type UserDetail,
  type UserDetailMeta,
} from '../../utils';

function InfoTile({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border p-3', className)}>
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1 truncate font-medium tabular-nums" title={String(value)}>
        {value}
      </p>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <p className="text-muted-foreground shrink-0 text-xs sm:pt-0.5">{label}</p>
      <p
        className={cn(
          'text-sm font-medium break-all sm:text-right',
          mono && 'font-mono text-xs tabular-nums'
        )}
      >
        {value}
      </p>
    </div>
  );
}

export default function UserViewPage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const userId = params.userId;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [meta, setMeta] = useState<UserDetailMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [banOpen, setBanOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [undeleteOpen, setUndeleteOpen] = useState(false);

  const loadUser = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await requestJson<{
          success: true;
          data: UserDetail;
          meta: UserDetailMeta;
        }>(`/${userId}`);
        setUser(res.data);
        setMeta(res.meta);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load user.';
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  async function handleBanConfirm(banned: boolean, reason?: string) {
    if (!user) return;
    setBusy(true);
    try {
      const res = await requestJson<{
        success: true;
        message?: string;
        data: UserDetail;
      }>(`/${user.id}/ban`, {
        method: 'PATCH',
        body: JSON.stringify({
          banned,
          reason: banned ? reason : undefined,
        }),
      });
      toast.success(res.message || (banned ? 'User banned.' : 'User unbanned.'));
      setUser((prev) => (prev ? { ...prev, ...res.data } : res.data));
      setBanOpen(false);
      void loadUser(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update ban status.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!user) return;
    setBusy(true);
    try {
      const res = await requestJson<{ success: true; message?: string }>(
        `/${user.id}`,
        { method: 'DELETE' }
      );
      toast.success(res.message || 'User deleted.');
      setDeleteOpen(false);
      router.push('/manage/users');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete user.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUndeleteConfirm() {
    if (!user) return;
    setBusy(true);
    try {
      const res = await requestJson<{
        success: true;
        message?: string;
        data?: UserDetail;
      }>(`/${user.id}/undelete`, { method: 'PATCH' });
      toast.success(res.message || 'User restored.');
      setUndeleteOpen(false);
      if (res.data) setUser((prev) => (prev ? { ...prev, ...res.data } : res.data!));
      void loadUser(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to restore user.'
      );
    } finally {
      setBusy(false);
    }
  }

  const status = user ? getUserStatus(user) : 'active';
  const isCustomerTarget =
    user &&
    meta &&
    !meta.isSelf &&
    !user.isDeleted &&
    user.role === 'customer';
  const canShowBan =
    !!isCustomerTarget && !!(meta?.canBan || meta?.canManage);
  const canShowDelete =
    !!isCustomerTarget && !!(meta?.canDelete || meta?.canManage);
  const canShowUndelete =
    !!user &&
    !!meta &&
    !meta.isSelf &&
    user.isDeleted &&
    !!(meta.canDelete || meta.canManage);

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
                <BreadcrumbPage>User Details</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button asChild variant="outline" size="sm" className="w-fit gap-1.5">
            <Link href="/manage/users">
              <ArrowLeft className="size-3.5" />
              Users
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || refreshing}
              onClick={() => void loadUser(true)}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn('size-3.5', refreshing && 'animate-spin')}
              />
              Refresh
            </Button>
            {user && meta?.canEdit && (
              <Button asChild size="sm" className="gap-1.5">
                <Link href={`/manage/users/edit/${user.id}`}>
                  <Edit className="size-3.5" />
                  Edit
                </Link>
              </Button>
            )}
            {canShowBan && (
              <Button
                variant={user?.isBanned ? 'outline' : 'destructive'}
                size="sm"
                onClick={() => setBanOpen(true)}
                className="gap-1.5"
              >
                {user?.isBanned ? (
                  <Unlock className="size-3.5" />
                ) : (
                  <Ban className="size-3.5" />
                )}
                {user?.isBanned ? 'Unban' : 'Ban'}
              </Button>
            )}
            {canShowDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteOpen(true)}
                className="gap-1.5"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            )}
            {canShowUndelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUndeleteOpen(true)}
                className="gap-1.5 text-green-600"
              >
                <RotateCcw className="size-3.5" />
                Restore
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <Card>
            <CardContent className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading user...
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <ShieldAlert className="text-destructive size-8" />
              <div>
                <p className="font-medium">Could not load user</p>
                <p className="text-muted-foreground mt-1 text-sm">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadUser()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : user ? (
          <>
            {/* Hero */}
            <section className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <Card className="overflow-hidden">
                <CardContent className="flex flex-col items-center gap-4 p-2 px-6 text-center sm:flex-row sm:text-left">
                  <Avatar className="size-24 shadow-md ring-4 ring-background">
                    <AvatarImage src={user.image ?? undefined} alt={user.name} />
                    <AvatarFallback className="bg-muted text-2xl font-semibold">
                      {getInitials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                      <Badge
                        variant={getRoleBadgeVariant(user.role)}
                        className="gap-1"
                      >
                        {user.role === 'owner' && <Crown className="size-3" />}
                        {user.role === 'admin' && <Shield className="size-3" />}
                        {user.role === 'customer' && (
                          <UserCheck className="size-3" />
                        )}
                        {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                      </Badge>
                      <Badge
                        variant={getStatusBadgeVariant(status)}
                        className="gap-1"
                      >
                        {status === 'deleted' && <UserX className="size-3" />}
                        {status === 'banned' && <Ban className="size-3" />}
                        {status === 'active' && (
                          <UserCheck className="size-3" />
                        )}
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </Badge>
                      {meta?.isSelf && (
                        <Badge variant="outline" className="gap-1">
                          <ShieldAlert className="size-3" />
                          You
                        </Badge>
                      )}
                      {user.isVipUser && (
                        <Badge variant="outline">VIP</Badge>
                      )}
                    </div>
                    <div>
                      <h1 className="text-2xl font-semibold tracking-tight">
                        {user.name}
                      </h1>
                      <p className="text-muted-foreground mt-0.5 text-sm">
                        {user.email}
                      </p>
                    </div>
                    {(user.firstName || user.lastName) && (
                      <p className="text-muted-foreground text-sm">
                        {[user.firstName, user.lastName]
                          .filter(Boolean)
                          .join(' ')}
                      </p>
                    )}
                    <p className="text-muted-foreground font-mono text-xs">
                      {user.id}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
                <InfoTile
                  label="Total spent"
                  value={formatMoney(user.totalSpent, user.currency)}
                  icon={Wallet}
                />
                <InfoTile
                  label="Orders"
                  value={user.totalOrders}
                  icon={ShoppingBag}
                />
                <InfoTile
                  label="Avg. order"
                  value={formatMoney(user.averageOrderValue, user.currency)}
                  icon={ShoppingBag}
                />
                <InfoTile
                  label="Loyalty points"
                  value={user.loyaltyPoints}
                  icon={Coins}
                />
                <InfoTile
                  label="Ragi coins"
                  value={user.ragiCoins}
                  icon={Coins}
                />
                <InfoTile
                  label="Last active"
                  value={formatRelative(user.lastActiveAt)}
                  icon={Calendar}
                />
              </div>
            </section>

            {user.isBanned && user.bannedReason && (
              <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-xl border px-4 py-3 text-sm">
                <Ban className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">Account is banned</p>
                  <p className="mt-0.5 opacity-90">{user.bannedReason}</p>
                  {user.bannedAt && (
                    <p className="mt-1 text-xs opacity-70">
                      Since {formatDateTime(user.bannedAt)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {user.isDeleted && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                <UserX className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">Account is soft-deleted</p>
                  <p className="mt-0.5 opacity-90">
                    Order history is retained. Restore the account to allow
                    edits and access again.
                  </p>
                  {user.deletedAt && (
                    <p className="mt-1 text-xs opacity-70">
                      Deleted {formatDateTime(user.deletedAt)}
                    </p>
                  )}
                </div>
              </div>
            )}

            <section className="grid gap-4 lg:grid-cols-2">
              {/* Profile */}
              <Card>
                <CardContent className="space-y-4 p-0 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 font-medium">
                      <User className="size-4" />
                      Profile
                    </h2>
                    {meta?.canEdit && (
                      <Button asChild variant="ghost" size="sm" className="gap-1">
                        <Link href={`/manage/users/edit/${user.id}`}>
                          <Edit className="size-3.5" />
                          Edit
                        </Link>
                      </Button>
                    )}
                  </div>
                  <div className="space-y-3">
                    <DetailRow label="Display name" value={user.name} />
                    <DetailRow
                      label="First name"
                      value={user.firstName || 'Not set'}
                    />
                    <DetailRow
                      label="Last name"
                      value={user.lastName || 'Not set'}
                    />
                    <DetailRow
                      label="Date of birth"
                      value={formatDate(user.dateOfBirth)}
                    />
                    <DetailRow
                      label="Gender"
                      value={genderLabel(user.gender)}
                    />
                    <DetailRow
                      label="Avatar"
                      value={user.image ? 'Set' : 'Not set'}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Contact */}
              <Card>
                <CardContent className="space-y-4 p-0 px-4">
                  <h2 className="flex items-center gap-2 font-medium">
                    <Mail className="size-4" />
                    Contact
                  </h2>
                  <div className="space-y-3">
                    <DetailRow label="Email" value={user.email} />
                    <DetailRow
                      label="Email verified"
                      value={
                        <span className="inline-flex items-center gap-1">
                          {user.emailVerified ? (
                            <CheckCircle2 className="size-3.5 text-green-600" />
                          ) : null}
                          {formatBool(user.emailVerified)}
                        </span>
                      }
                    />
                    <DetailRow
                      label="Phone"
                      value={user.phone || 'Not set'}
                    />
                    <DetailRow
                      label="Phone verified"
                      value={formatBool(user.phoneVerified)}
                    />
                    <DetailRow
                      label="Default address"
                      value={user.defaultAddressId || 'Not set'}
                      mono
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Preferences */}
              <Card>
                <CardContent className="space-y-4 p-0 px-4">
                  <h2 className="flex items-center gap-2 font-medium">
                    <Bell className="size-4" />
                    Preferences
                  </h2>
                  <div className="space-y-3">
                    <DetailRow
                      label="Email notifications"
                      value={formatBool(user.emailNotifications)}
                    />
                    <DetailRow
                      label="SMS notifications"
                      value={formatBool(user.smsNotifications)}
                    />
                    <DetailRow label="Currency" value={user.currency} />
                    <DetailRow label="Locale" value={user.locale} />
                    <DetailRow
                      label="Timezone"
                      value={user.timezone}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Account metadata (read-only) */}
              <Card>
                <CardContent className="space-y-4 p-0 px-4">
                  <h2 className="flex items-center gap-2 font-medium">
                    <Shield className="size-4" />
                    Account metadata
                  </h2>
                  <p className="text-muted-foreground text-xs">
                    These fields are system-managed and cannot be edited here.
                    Role changes use Manage Admins; ban/delete use dedicated
                    actions.
                  </p>
                  <div className="space-y-3">
                    <DetailRow
                      label="Role"
                      value={
                        user.role.charAt(0).toUpperCase() + user.role.slice(1)
                      }
                    />
                    <DetailRow
                      label="Created"
                      value={formatDateTime(user.createdAt)}
                    />
                    <DetailRow
                      label="Updated"
                      value={formatDateTime(user.updatedAt)}
                    />
                    <DetailRow
                      label="Last login"
                      value={formatDateTime(user.lastLoginAt)}
                    />
                    <DetailRow
                      label="Last login IP"
                      value={user.lastLoginIp || 'Unknown'}
                      mono
                    />
                    <DetailRow
                      label="Last active"
                      value={formatDateTime(user.lastActiveAt)}
                    />
                    <DetailRow
                      label="Referral code"
                      value={user.referralCode || 'Not set'}
                      mono
                    />
                    <DetailRow
                      label="Referred by"
                      value={user.referredBy || 'Not set'}
                      mono
                    />
                    <DetailRow
                      label="Verified seller"
                      value={formatBool(user.isVerifiedSeller)}
                    />
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Admin notes */}
            <Card>
              <CardContent className="space-y-3 p-0 px-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 font-medium">
                    <Shield className="size-4" />
                    Admin notes
                  </h2>
                  {meta?.canEdit && (
                    <Button asChild variant="ghost" size="sm" className="gap-1">
                      <Link href={`/manage/users/edit/${user.id}`}>
                        <Edit className="size-3.5" />
                        Edit
                      </Link>
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  Internal only — never shown to the user.
                </p>
                {user.adminNotes ? (
                  <div className="bg-muted/40 rounded-lg border p-3 text-sm whitespace-pre-wrap">
                    {user.adminNotes}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No notes yet.</p>
                )}
              </CardContent>
            </Card>

            {/* Commerce stats detail */}
            <Card>
              <CardContent className="space-y-4 py-0">
                <h2 className="flex items-center gap-2 font-medium">
                  <Globe className="size-4" />
                  Commerce (read-only)
                </h2>
                <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                  <InfoTile
                    label="Total spent"
                    value={formatMoney(user.totalSpent, user.currency)}
                    icon={Wallet}
                  />
                  <InfoTile
                    label="Total orders"
                    value={user.totalOrders}
                    icon={ShoppingBag}
                  />
                  <InfoTile
                    label="Average order value"
                    value={formatMoney(user.averageOrderValue, user.currency)}
                    icon={ShoppingBag}
                  />
                  <InfoTile
                    label="VIP"
                    value={formatBool(user.isVipUser)}
                    icon={Crown}
                  />
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </main>

      <BanUserDialog
        user={user}
        open={banOpen}
        onOpenChange={setBanOpen}
        onConfirm={(banned, reason) => void handleBanConfirm(banned, reason)}
        loading={busy}
      />
      <DeleteUserDialog
        user={user}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void handleDeleteConfirm()}
        loading={busy}
      />
      <UndeleteUserDialog
        user={user}
        open={undeleteOpen}
        onOpenChange={setUndeleteOpen}
        onConfirm={() => void handleUndeleteConfirm()}
        loading={busy}
      />
    </>
  );
}
