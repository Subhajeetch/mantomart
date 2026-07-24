'use client';

import Link from 'next/link';
import {
  Ban,
  Crown,
  Edit,
  MoreHorizontal,
  RotateCcw,
  Shield,
  ShieldAlert,
  Trash2,
  Unlock,
  UserCheck,
  UserX,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import type { AdminUser } from '../utils';
import {
  formatDateTime,
  formatRelative,
  getInitials,
  getRoleBadgeVariant,
  getStatusBadgeVariant,
} from '../utils';

export type UserCardCapabilities = {
  canBan: boolean;
  canDelete: boolean;
  canManage: boolean;
};

interface UserCardProps {
  user: AdminUser;
  capabilities: UserCardCapabilities;
  isSelf: boolean;
  onRequestBan: (user: AdminUser) => void;
  onRequestDelete: (user: AdminUser) => void;
  onRequestUndelete: (user: AdminUser) => void;
  busyId: string | null;
}

function RoleBadge({ role }: { role: AdminUser['role'] }) {
  const label = role.charAt(0).toUpperCase() + role.slice(1);
  return (
    <Badge variant={getRoleBadgeVariant(role)} className="gap-1">
      {role === 'owner' && <Crown className="size-3" />}
      {role === 'admin' && <Shield className="size-3" />}
      {role === 'customer' && <UserCheck className="size-3" />}
      {label}
    </Badge>
  );
}

function StatusBadge({
  isBanned,
  isDeleted,
}: {
  isBanned: boolean;
  isDeleted: boolean;
}) {
  if (isDeleted) {
    return (
      <Badge variant={getStatusBadgeVariant('deleted')} className="gap-1">
        <UserX className="size-3" />
        Deleted
      </Badge>
    );
  }
  if (isBanned) {
    return (
      <Badge variant={getStatusBadgeVariant('banned')} className="gap-1">
        <Ban className="size-3" />
        Banned
      </Badge>
    );
  }
  return (
    <Badge variant={getStatusBadgeVariant('active')} className="gap-1">
      <UserCheck className="size-3" />
      Active
    </Badge>
  );
}

export function UserCardSkeleton() {
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
    </Card>
  );
}

export function UserCard({
  user,
  capabilities,
  isSelf,
  onRequestBan,
  onRequestDelete,
  onRequestUndelete,
  busyId,
}: UserCardProps) {
  const busy = busyId === user.id;
  const { canBan, canManage, canDelete } = capabilities;

  // Only act on customer accounts from this page.
  // Admin/owner promotion is handled on Manage Admins.
  const isCustomerTarget =
    !isSelf && !user.isDeleted && user.role === 'customer';
  const canShowUndelete = !isSelf && user.isDeleted && (canManage || canDelete);

  const canShowBan = isCustomerTarget && (canManage || canBan);
  const canShowDelete = isCustomerTarget && (canManage || canDelete);
  // Edit is shown for any admin with mutation perms; API enforces target policy.
  const showEdit = !user.isDeleted && (canManage || canBan || canDelete);

  const hasMenuActions =
    showEdit || canShowBan || canShowDelete || canShowUndelete;

  return (
    <Card
      className={`group relative overflow-hidden transition-shadow hover:border-primary/40 hover:shadow-md ${
        busy ? 'opacity-60' : ''
      }`}
    >
      {user.role === 'owner' && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500" />
      )}

      {showEdit && (
        <Button
          asChild
          variant="secondary"
          size="icon"
          className="absolute top-3 right-3 z-20 size-8 shadow-sm"
        >
          <Link
            href={`/manage/users/edit/${user.id}`}
            aria-label={`Edit ${user.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <Edit className="size-3.5" />
          </Link>
        </Button>
      )}

      <Link
        href={`/manage/users/view/${user.id}`}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`View ${user.name}`}
      >
        <CardHeader className="border-b pb-4">
          <div className="flex items-start gap-3 pr-10">
            <Avatar className="size-12 shadow-sm ring-2 ring-background">
              <AvatarImage src={user.image ?? undefined} alt={user.name} />
              <AvatarFallback className="bg-muted text-sm font-semibold">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="min-w-0">
                <p className="truncate font-medium leading-tight group-hover:text-primary">
                  {user.name}
                </p>
                <p className="text-muted-foreground truncate text-sm">
                  {user.email}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <RoleBadge role={user.role} />
                <StatusBadge
                  isBanned={user.isBanned}
                  isDeleted={user.isDeleted}
                />
                {isSelf && (
                  <Badge variant="outline" className="gap-1 text-xs">
                    <ShieldAlert className="size-3" />
                    You
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-2 pt-4 text-sm">
          <div className="text-muted-foreground flex justify-between gap-2">
            <span>Joined</span>
            <span className="text-foreground tabular-nums">
              {formatDateTime(user.createdAt)}
            </span>
          </div>
          <div className="text-muted-foreground flex justify-between gap-2">
            <span>Last active</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-foreground cursor-default tabular-nums">
                  {formatRelative(user.lastActiveAt)}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {formatDateTime(user.lastActiveAt)}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="text-muted-foreground flex justify-between gap-2">
            <span>Last login</span>
            <span className="text-foreground tabular-nums">
              {formatRelative(user.lastLoginAt)}
            </span>
          </div>
          {user.isBanned && user.bannedReason && (
            <div className="bg-destructive/5 text-destructive mt-2 rounded-md px-2 py-1.5 text-xs">
              Ban reason: {user.bannedReason}
            </div>
          )}
        </CardContent>
      </Link>

      {hasMenuActions && (canShowBan || canShowDelete || canShowUndelete) && (
        <div className={`absolute top-3 z-20 ${showEdit ? 'right-12' : 'right-3'}`}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 bg-background/80 shadow-sm backdrop-blur-sm"
                disabled={busy}
                onClick={(e) => e.preventDefault()}
              >
                <MoreHorizontal className="size-4" />
                <span className="sr-only">User actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />

              {canShowBan && (
                <DropdownMenuItem
                  onClick={() => onRequestBan(user)}
                  className={
                    user.isBanned ? 'text-green-600' : 'text-destructive'
                  }
                >
                  {user.isBanned ? (
                    <>
                      <Unlock className="mr-2 size-4" />
                      Unban user
                    </>
                  ) : (
                    <>
                      <Ban className="mr-2 size-4" />
                      Ban user
                    </>
                  )}
                </DropdownMenuItem>
              )}

              {canShowDelete && (
                <>
                  {(canShowBan || canShowUndelete) && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onClick={() => onRequestDelete(user)}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 size-4" />
                    Delete user
                  </DropdownMenuItem>
                </>
              )}

              {canShowUndelete && (
                <>
                  {(canShowBan || canShowDelete) && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onClick={() => onRequestUndelete(user)}
                    className="text-green-600"
                  >
                    <RotateCcw className="mr-2 size-4" />
                    Undelete user
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </Card>
  );
}
