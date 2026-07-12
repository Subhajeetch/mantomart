'use client';

import { useEffect, useState } from 'react';
import { Ban, Loader2, Unlock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type { AdminUser } from '../utils';

interface BanUserDialogProps {
  user: AdminUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (banned: boolean, reason?: string) => void;
  loading?: boolean;
}

export function BanUserDialog({
  user,
  open,
  onOpenChange,
  onConfirm,
  loading,
}: BanUserDialogProps) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const isBanAction = user ? !user.isBanned : true;

  useEffect(() => {
    if (!open) {
      setReason('');
      setReasonError(null);
    }
  }, [open]);

  if (!user) return null;

  function handleConfirm() {
    if (!user) return;

    if (isBanAction && !reason.trim()) {
      setReasonError('A reason is required when banning a user.');
      return;
    }

    onConfirm(isBanAction, isBanAction ? reason.trim() : undefined);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isBanAction ? (
              <Ban className="text-destructive size-4" />
            ) : (
              <Unlock className="size-4 text-green-600" />
            )}
            {isBanAction ? 'Ban User' : 'Unban User'}
          </DialogTitle>
          <DialogDescription asChild>
            <div>
              {isBanAction ? (
                <p>
                  You are about to ban <strong>{user.name}</strong> (
                  {user.email}). They will lose access to their account.
                </p>
              ) : (
                <p>
                  You are about to unban <strong>{user.name}</strong>. They will
                  regain access to their account.
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        {isBanAction && (
          <div className="space-y-2">
            <Label htmlFor="ban-reason">
              Reason for ban <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="ban-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(null);
              }}
              placeholder="Explain why this user is being banned..."
              rows={3}
              className={reasonError ? 'border-destructive' : ''}
              disabled={loading}
              maxLength={500}
            />
            {reasonError && (
              <p className="text-destructive text-sm" role="alert">
                {reasonError}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant={isBanAction ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={loading || (isBanAction && !reason.trim())}
            className="gap-1.5"
          >
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            {isBanAction ? 'Ban User' : 'Unban User'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
