'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { AdminUser } from '../utils';

export function RemoveAdminDialog({
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