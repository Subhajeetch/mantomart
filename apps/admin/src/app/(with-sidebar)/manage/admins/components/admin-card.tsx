import {
  BadgeCheck,
  Clock,
  Loader2,
  Shield,
  ShieldAlert,
  ShieldOff,
  SlidersHorizontal,
  UserCog,
  Crown,
} from 'lucide-react';

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

import { RoleBadge } from './role-badge';
import type { AdminRole, AdminUser } from '../utils';
import { formatDateTime, formatRelative, getInitials } from '../utils';

export function AdminCardSkeleton() {
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

export function AdminCard({
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