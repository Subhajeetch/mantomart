'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Crown, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

import type { AdminUser, PermissionState } from '../utils';
import {
  getPermissionAction,
  getPermissionGroup,
  requestJson,
} from '../utils';

function PermissionStatus({ permission }: { permission: PermissionState }) {
  if (permission.override === true) {
    return (
      <Badge variant="outline" className="text-[10px]">
        Override: granted
      </Badge>
    );
  }

  if (permission.override === false) {
    return (
      <Badge variant="outline" className="text-[10px]">
        Override: denied
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="text-[10px]">
      Default: {permission.defaultGranted ? 'granted' : 'denied'}
    </Badge>
  );
}

export function UpdatePermissionsDialog({
  admin,
  open,
  onOpenChange,
  canManage,
}: {
  admin: AdminUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}) {
  const [permissions, setPermissions] = useState<PermissionState[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerHasAllPermissions, setOwnerHasAllPermissions] = useState(false);

  const reset = useCallback(() => {
    setPermissions([]);
    setSelected(new Set());
    setLoading(false);
    setSaving(false);
    setError(null);
    setOwnerHasAllPermissions(false);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    if (!admin || !canManage) return;

    const target = admin;
    let cancelled = false;

    async function loadPermissions() {
      setLoading(true);
      setError(null);

      try {
        const res = await requestJson<{
          success: true;
          data: {
            user: AdminUser;
            permissions: PermissionState[];
          };
          meta: {
            canUpdate: boolean;
            ownerHasAllPermissions: boolean;
          };
        }>(`/${target.id}/permissions`);

        if (cancelled) return;

        setPermissions(res.data.permissions);
        setSelected(
          new Set(
            res.data.permissions
              .filter((permission) => permission.granted)
              .map((permission) => permission.permission)
          )
        );
        setOwnerHasAllPermissions(res.meta.ownerHasAllPermissions);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load permissions.';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPermissions();

    return () => {
      cancelled = true;
    };
  }, [admin, canManage, open, reset]);

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, PermissionState[]>();

    for (const permission of permissions) {
      const group = getPermissionGroup(permission.permission);
      groups.set(group, [...(groups.get(group) ?? []), permission]);
    }

    return Array.from(groups, ([group, items]) => ({ group, items }));
  }, [permissions]);

  const isDirty = useMemo(() => {
    if (permissions.length === 0) return false;
    return permissions.some(
      (permission) => permission.granted !== selected.has(permission.permission)
    );
  }, [permissions, selected]);

  function togglePermission(permission: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(permission);
      else next.delete(permission);
      return next;
    });
  }

  async function handleSave() {
    if (!admin) return;

    setSaving(true);
    try {
      const res = await requestJson<{
        success: true;
        message?: string;
        data: {
          user: AdminUser;
          permissions: PermissionState[];
        };
      }>(`/${admin.id}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: Array.from(selected) }),
      });

      setPermissions(res.data.permissions);
      setSelected(
        new Set(
          res.data.permissions
            .filter((permission) => permission.granted)
            .map((permission) => permission.permission)
        )
      );
      toast.success(res.message || 'Permissions updated.');
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update permissions.'
      );
    } finally {
      setSaving(false);
    }
  }

  const controlsDisabled =
    !canManage || loading || saving || ownerHasAllPermissions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            Update Permissions
          </DialogTitle>
          <DialogDescription>
            {admin ? (
              <>
                Manage effective permissions for{' '}
                <span className="font-medium text-foreground">
                  {admin.name}
                </span>
                .
              </>
            ) : (
              'Manage admin permissions.'
            )}
          </DialogDescription>
        </DialogHeader>

        {!canManage ? (
          <div className="rounded-lg bg-destructive/10 px-3 py-3 text-sm text-destructive">
            Only owners can update permissions.
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {ownerHasAllPermissions && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                <Crown className="mt-0.5 size-4 shrink-0" />
                Owners always have every permission.
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={controlsDisabled}
                onClick={() =>
                  setSelected(
                    new Set(
                      permissions.map((permission) => permission.permission)
                    )
                  )
                }
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={controlsDisabled}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>

            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
              {groupedPermissions.map(({ group, items }) => (
                <div key={group} className="space-y-2">
                  <p className="text-sm font-medium">{group}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map((permission) => {
                      const checked = selected.has(permission.permission);

                      return (
                        <label
                          key={permission.permission}
                          className={`flex min-h-16 items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                            checked
                              ? 'border-primary/30 bg-primary/5'
                              : 'bg-background'
                          } ${
                            controlsDisabled
                              ? 'cursor-not-allowed opacity-70'
                              : 'cursor-pointer hover:bg-muted/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 size-4 accent-primary"
                            checked={checked}
                            disabled={controlsDisabled}
                            onChange={(event) =>
                              togglePermission(
                                permission.permission,
                                event.target.checked
                              )
                            }
                          />
                          <span className="min-w-0 flex-1 space-y-1">
                            <span className="block text-sm font-medium leading-tight">
                              {getPermissionAction(permission.permission)}
                            </span>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {permission.permission}
                              </code>
                              <PermissionStatus permission={permission} />
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !canManage ||
              !admin ||
              loading ||
              saving ||
              !!error ||
              ownerHasAllPermissions ||
              !isDirty
            }
            className="gap-1.5"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}