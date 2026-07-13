import { Crown, Shield, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

export function RoleBadge({ role }: { role: string }) {
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