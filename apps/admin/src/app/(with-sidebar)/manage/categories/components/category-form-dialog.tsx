'use client';

import { useEffect, useMemo, useState } from 'react';
import { FolderPlus, Loader2, Pencil } from 'lucide-react';

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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type { CategoryNode } from '../utils';
import { toCategorySlug } from '../utils';

export type CategoryFormValues = {
  name: string;
  slug: string;
  description: string;
  image: string;
  position: number;
};

export function CategoryFormDialog({
  open,
  onOpenChange,
  mode,
  parent,
  category,
  maxDepth,
  loading,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create-root' | 'create-child' | 'edit';
  parent: CategoryNode | null;
  category: CategoryNode | null;
  maxDepth: number;
  loading: boolean;
  onSubmit: (values: CategoryFormValues) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [position, setPosition] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const isEdit = mode === 'edit';
  const title = isEdit
    ? 'Edit category'
    : mode === 'create-child'
      ? 'New subcategory'
      : 'New root category';

  const descriptionText = useMemo(() => {
    if (isEdit && category) {
      return `Update “${category.name}”. Nesting depth: ${category.depth}/${maxDepth}.`;
    }
    if (mode === 'create-child' && parent) {
      return `Create a subcategory under “${parent.name}” (depth ${parent.depth + 1}/${maxDepth}).`;
    }
    return `Create a top-level category (depth 1/${maxDepth}).`;
  }, [isEdit, category, mode, parent, maxDepth]);

  useEffect(() => {
    if (!open) return;

    if (isEdit && category) {
      setName(category.name);
      setDescription(category.description ?? '');
      setImage(category.image ?? '');
      setPosition(String(category.position ?? 0));
    } else {
      setName('');
      setDescription('');
      setImage('');
      setPosition('0');
    }
    setError(null);
  }, [open, isEdit, category]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required.');
      return;
    }
    if (trimmedName.length > 120) {
      setError('Name must be at most 120 characters.');
      return;
    }

    const slug = toCategorySlug(trimmedName);
    if (!slug) {
      setError('Name must include at least one letter or number for the URL slug.');
      return;
    }

    const pos = parseInt(position, 10);
    if (!Number.isFinite(pos) || pos < 0) {
      setError('Position must be a non-negative integer.');
      return;
    }

    if (image.trim().length > 2048) {
      setError('Image URL is too long.');
      return;
    }

    if (description.trim().length > 2000) {
      setError('Description is too long.');
      return;
    }

    setError(null);
    onSubmit({
      name: trimmedName,
      slug,
      description: description.trim(),
      image: image.trim(),
      position: pos,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? (
              <Pencil className="size-4" />
            ) : (
              <FolderPlus className="size-4" />
            )}
            {title}
          </DialogTitle>
          <DialogDescription>{descriptionText}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Shoes"
              disabled={loading}
              autoFocus
              maxLength={120}
            />
            {name.trim() && (
              <p className="text-muted-foreground font-mono text-xs">
                URL slug: {toCategorySlug(name) || '—'}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-image">Image URL (optional)</Label>
            <Input
              id="cat-image"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="https://…"
              disabled={loading}
              maxLength={2048}
            />
            <p className="text-muted-foreground text-xs">
              Shown as the folder icon in the tree when set.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-desc">Description (optional)</Label>
            <Textarea
              id="cat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description for this category"
              disabled={loading}
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-pos">Sort position</Label>
            <Input
              id="cat-pos"
              type="number"
              min={0}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              disabled={loading}
            />
            <p className="text-muted-foreground text-xs">
              Lower numbers appear first among siblings.
            </p>
          </div>

          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="gap-1.5">
              {loading && <Loader2 className="size-3.5 animate-spin" />}
              {isEdit ? 'Save changes' : 'Create category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
