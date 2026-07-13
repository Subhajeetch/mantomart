import { BadgeCheck, Mail, ShieldAlert } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import { RoleBadge } from './role-badge';
import type { AdminUser } from '../utils';
import { formatDateTime, formatRelative, getInitials } from '../utils';

export function UserPreviewCard({
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