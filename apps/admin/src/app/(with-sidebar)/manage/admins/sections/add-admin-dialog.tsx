'use client';

import { useCallback, useEffect, useState } from 'react';
import { Crown, Loader2, Plus, Search, Shield, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { UserPreviewCard } from './user-preview-card';
import type { AdminRole, AdminUser } from '../utils';
import { looksLikeEmail, requestJson } from '../utils';

export function AddAdminDialog({
  open,
  onOpenChange,
  canManage,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<AdminRole>('admin');
  const [preview, setPreview] = useState<AdminUser | null>(null);
  const [alreadyAdmin, setAlreadyAdmin] = useState(false);
  const [canPromote, setCanPromote] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [adding, setAdding] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setQuery('');
    setRole('admin');
    setPreview(null);
    setAlreadyAdmin(false);
    setCanPromote(false);
    setLookingUp(false);
    setAdding(false);
    setLookupError(null);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  async function handleLookup(e?: React.FormEvent) {
    e?.preventDefault();
    const value = query.trim();
    if (!value) {
      setLookupError('Enter an email address or user id.');
      return;
    }

    setLookingUp(true);
    setLookupError(null);
    setPreview(null);
    setAlreadyAdmin(false);
    setCanPromote(false);

    try {
      const param = looksLikeEmail(value)
        ? `email=${encodeURIComponent(value.toLowerCase())}`
        : `id=${encodeURIComponent(value)}`;

      const res = await requestJson<{
        success: true;
        data: AdminUser;
        meta: { alreadyAdmin: boolean; canPromote: boolean };
      }>(`/lookup?${param}`);

      setPreview(res.data);
      setAlreadyAdmin(res.meta.alreadyAdmin);
      setCanPromote(res.meta.canPromote);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed.');
    } finally {
      setLookingUp(false);
    }
  }

  async function handleAdd() {
    if (!preview || !canPromote) return;

    setAdding(true);
    try {
      const body = looksLikeEmail(query.trim())
        ? { email: preview.email, role }
        : { id: preview.id, role };

      await requestJson<{ success: true; message?: string }>('/add', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      toast.success(
        `${preview.name} has been added as ${role === 'owner' ? 'an owner' : 'an admin'}.`
      );
      onOpenChange(false);
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add admin.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-4" />
            Add admin
          </DialogTitle>
          <DialogDescription>
            Search for a registered user by email or id, preview their profile,
            then promote them.
          </DialogDescription>
        </DialogHeader>

        {!canManage ? (
          <div className="rounded-lg bg-destructive/10 px-3 py-3 text-sm text-destructive">
            Only owners can add new admins.
          </div>
        ) : (
          <div className="space-y-4">
            <form onSubmit={handleLookup} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLookupError(null);
                  }}
                  placeholder="Email or user id"
                  className="pl-8"
                  disabled={lookingUp || adding}
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                disabled={lookingUp || adding || !query.trim()}
              >
                {lookingUp ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  'Look up'
                )}
              </Button>
            </form>

            {lookupError && (
              <p className="text-destructive text-sm">{lookupError}</p>
            )}

            {preview && (
              <>
                <UserPreviewCard user={preview} alreadyAdmin={alreadyAdmin} />

                {canPromote && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Assign role</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRole('admin')}
                        disabled={adding}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                          role === 'admin'
                            ? 'border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-400'
                            : 'hover:bg-muted border-border text-muted-foreground'
                        }`}
                      >
                        <Shield className="size-3.5" />
                        Admin
                      </button>
                      <button
                        type="button"
                        onClick={() => setRole('owner')}
                        disabled={adding}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                          role === 'owner'
                            ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                            : 'hover:bg-muted border-border text-muted-foreground'
                        }`}
                      >
                        <Crown className="size-3.5" />
                        Owner
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={adding}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!canManage || !preview || !canPromote || adding}
            className="gap-1.5"
          >
            {adding ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Confirm add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}