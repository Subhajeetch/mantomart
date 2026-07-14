'use client';

import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import type { CategoryNode } from '../utils';

export type DeleteDialogState =
  | { status: 'idle' }
  | { status: 'checking' }
  | {
      status: 'confirm';
      linkedProductCount: number;
    }
  | {
      status: 'blocked';
      reason: 'HAS_CHILDREN' | 'HAS_SOLE_PRODUCTS' | 'OTHER';
      message: string;
      soleProductCount?: number;
      linkedProductCount?: number;
    }
  | { status: 'deleting' };

export function DeleteCategoryDialog({
  category,
  open,
  onOpenChange,
  state,
  onConfirm,
}: {
  category: CategoryNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: DeleteDialogState;
  onConfirm: () => void;
}) {
  if (!category) return null;

  const isBusy = state.status === 'checking' || state.status === 'deleting';
  const canConfirm = state.status === 'confirm';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-4" />
            Delete category?
          </DialogTitle>
          <DialogDescription>
            You are about to delete{' '}
            <span className="text-foreground font-medium">{category.name}</span>
            {category.children.length > 0
              ? ` and it currently has ${category.children.length} subcategor${category.children.length === 1 ? 'y' : 'ies'}.`
              : '.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {state.status === 'checking' && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Checking product associations…
            </div>
          )}

          {state.status === 'blocked' && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Cannot delete</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}

          {state.status === 'confirm' && (
            <>
              {state.linkedProductCount > 0 ? (
                <Alert>
                  <AlertTriangle />
                  <AlertTitle>Products are linked</AlertTitle>
                  <AlertDescription>
                    There {state.linkedProductCount === 1 ? 'is' : 'are'}{' '}
                    <strong>{state.linkedProductCount}</strong> product
                    {state.linkedProductCount === 1 ? '' : 's'} that include this
                    category. Those products have other categories too, so
                    deleting will only remove this association — not the
                    products themselves.
                  </AlertDescription>
                </Alert>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No products are linked to this category. This action cannot be
                  undone.
                </p>
              )}
            </>
          )}

          {state.status === 'deleting' && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Deleting category…
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
          >
            {state.status === 'blocked' ? 'Close' : 'Cancel'}
          </Button>
          {(canConfirm || state.status === 'deleting') && (
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={isBusy}
              className="gap-1.5"
            >
              {state.status === 'deleting' && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              {state.status === 'confirm' && state.linkedProductCount > 0
                ? 'Yes, delete category'
                : 'Delete category'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
