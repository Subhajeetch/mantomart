'use client';

import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';

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

interface UndeleteUserDialogProps {
  user: AdminUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading?: boolean;
}

export function UndeleteUserDialog({
  user,
  open,
  onOpenChange,
  onConfirm,
  loading,
}: UndeleteUserDialogProps) {
  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-green-600">
            <RotateCcw className="size-4" />
            Undelete User
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                You are about to restore <strong>{user.name}</strong> ({user.email}).
              </p>
              <p>
                If the account is restored, the user may be able to sign in again.
                This action will remove the deleted and banned state.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          This restores the account to an active state for sign-in and access.
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
            variant="default"
            onClick={onConfirm}
            disabled={loading}
            className="gap-1.5"
          >
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            Undelete User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
