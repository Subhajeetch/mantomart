"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { CategoryNode, HeaderAdminCollection, HeaderAdminItem } from "./types";
import { flattenCategories, slugify, usedCategoryIdsInCollection } from "./utils";

export type AddItemTarget =
  | {
      kind: "column";
      /** Parent is the root tab → creates depth-1 subcategory column. */
      collection: HeaderAdminCollection;
    }
  | {
      kind: "leaf";
      /** Parent is a depth-1 column → creates depth-2 leaf link. */
      collection: HeaderAdminCollection;
      parent: HeaderAdminItem;
    };

type AddItemDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: AddItemTarget | null;
  categoryTree: CategoryNode[];
  canUpdate: boolean;
  busy: boolean;
  maxItems: number;
  currentItemCount: number;
  onSubmit: (payload: {
    collectionId: string;
    parentId: string;
    mode: "category" | "custom";
    categoryId?: string;
    name?: string;
    href?: string | null;
    isVisible: boolean;
    featured: boolean;
  }) => Promise<void>;
};

export function AddItemDialog({
  open,
  onOpenChange,
  target,
  categoryTree,
  canUpdate,
  busy,
  maxItems,
  currentItemCount,
  onSubmit,
}: AddItemDialogProps) {
  const [mode, setMode] = useState<"category" | "custom">("category");
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [href, setHref] = useState("");
  const [isVisible, setIsVisible] = useState(true);
  const [featured, setFeatured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode("category");
    setCategoryId("");
    setName("");
    setHref("");
    setIsVisible(true);
    setFeatured(false);
    setError(null);
  }, [open, target?.kind, target && "parent" in target ? target.parent.id : null, target?.collection.id]);

  const isColumn = target?.kind === "column";
  const title = isColumn ? "Add subcategory column" : "Add menu link";
  const description = isColumn
    ? "Subcategories become pink column headers in the mega menu (e.g. Western Wear)."
    : "Links appear under a column header (e.g. Dresses, Tops under Western Wear).";

  const categoryOptions = useMemo(() => {
    if (!target) return [];
    const used = usedCategoryIdsInCollection(target.collection);
    // Prefer children of the linked root category when adding columns.
    const rootId =
      target.kind === "column"
        ? target.collection.categoryId
        : target.parent.categoryId ?? target.collection.categoryId;

    const scoped = flattenCategories(categoryTree, {
      rootId: rootId ?? undefined,
      maxDepth: target.kind === "column" ? 0 : 1,
      excludeIds: used,
    });

    // If the scoped list is empty, fall back to full tree (minus used).
    if (scoped.length === 0) {
      return flattenCategories(categoryTree, {
        maxDepth: 3,
        excludeIds: used,
      });
    }
    return scoped;
  }, [target, categoryTree]);

  const selectedCategory = useMemo(
    () => categoryOptions.find((c) => c.id === categoryId) ?? null,
    [categoryOptions, categoryId]
  );

  const autoSlug = mode === "custom" ? slugify(name) : selectedCategory?.slug ?? "";

  async function handleSubmit() {
    if (!target) return;
    setError(null);

    if (currentItemCount >= maxItems) {
      setError(`This tab already has ${maxItems} items.`);
      return;
    }

    const parentId =
      target.kind === "column" ? target.collection.id : target.parent.id;

    if (mode === "category") {
      if (!categoryId) {
        setError("Select a category.");
        return;
      }
    } else {
      if (!name.trim()) {
        setError("Enter a display name.");
        return;
      }
      if (href.trim() && !href.startsWith("/") && !/^https?:\/\//i.test(href)) {
        setError("URL must start with / or http(s)://");
        return;
      }
    }

    try {
      await onSubmit({
        collectionId: target.collection.id,
        parentId,
        mode,
        categoryId: mode === "category" ? categoryId : undefined,
        name: mode === "custom" ? name.trim() : undefined,
        href:
          mode === "custom"
            ? href.trim() ||
              (autoSlug ? `/category/${autoSlug}` : null)
            : undefined,
        isVisible,
        featured,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
            <button
              type="button"
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === "category"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              disabled={busy}
              onClick={() => setMode("category")}
            >
              Link category
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === "custom"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              disabled={busy}
              onClick={() => setMode("custom")}
            >
              Custom link
            </button>
          </div>

          {mode === "category" ? (
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select
                value={categoryId || undefined}
                onValueChange={setCategoryId}
                disabled={!canUpdate || busy || categoryOptions.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a category…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {categoryOptions.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <span className="flex flex-col items-start gap-0.5">
                        <span>{cat.label}</span>
                        <span className="text-[11px] text-muted-foreground">
                          /{cat.slug}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categoryOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No unused categories available under this branch. Create more
                  in Manage → Categories, or use a custom link.
                </p>
              )}
              {selectedCategory && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="size-3" />
                  Will use slug{" "}
                  <code className="rounded bg-muted px-1">
                    {selectedCategory.slug}
                  </code>
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="add-item-name">Display name</Label>
                <Input
                  id="add-item-name"
                  value={name}
                  disabled={!canUpdate || busy}
                  placeholder="e.g. Plus Size"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="add-item-href">
                  URL{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional — defaults to /category/&#123;slug&#125;)
                  </span>
                </Label>
                <Input
                  id="add-item-href"
                  value={href}
                  disabled={!canUpdate || busy}
                  placeholder={
                    autoSlug ? `/category/${autoSlug}` : "/category/…"
                  }
                  onChange={(e) => setHref(e.target.value)}
                />
                {autoSlug && (
                  <p className="text-xs text-muted-foreground">
                    Derived slug:{" "}
                    <code className="rounded bg-muted px-1">{autoSlug}</code>
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={isVisible}
                disabled={!canUpdate || busy}
                onChange={(e) => setIsVisible(e.target.checked)}
              />
              Visible
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={featured}
                disabled={!canUpdate || busy}
                onChange={(e) => setFeatured(e.target.checked)}
              />
              Featured{" "}
              <span className="text-xs text-muted-foreground">
                (highlighted like “NEW”)
              </span>
            </label>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={!canUpdate || busy}
            onClick={() => void handleSubmit()}
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {isColumn ? "Add column" : "Add link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
