'use client';

import { AlertTriangle, Loader2, UserX } from 'lucide-react';

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

interface DeleteUserDialogProps {
  user: AdminUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading?: boolean;
}

export function DeleteUserDialog({
  user,
  open,
  onOpenChange,
  onConfirm,
  loading,
}: DeleteUserDialogProps) {
  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            <UserX className="size-4" />
            Delete User
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                You are about to soft-delete <strong>{user.name}</strong> (
                {user.email}).
              </p>
              <p>
                The account will be banned, demoted to customer, and marked as
                deleted. Order history is preserved for compliance.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          This cannot be undone from this page. The user will lose access
          immediately.
        </div>

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
            Delete User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
