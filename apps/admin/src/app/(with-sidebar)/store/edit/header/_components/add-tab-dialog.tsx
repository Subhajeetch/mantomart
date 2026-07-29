"use client";

import { useMemo, useState } from "react";
import { FolderTree, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { AvailableCategory } from "./types";

type AddTabDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableCategories: AvailableCategory[];
  canUpdate: boolean;
  maxVisible: number;
  visibleCount: number;
  totalCount: number;
  maxTotal: number;
  busy: boolean;
  onSubmit: (payload: {
    categoryId: string;
    isVisible: boolean;
  }) => Promise<void>;
};

export function AddTabDialog({
  open,
  onOpenChange,
  availableCategories,
  canUpdate,
  maxVisible,
  visibleCount,
  totalCount,
  maxTotal,
  busy,
  onSubmit,
}: AddTabDialogProps) {
  const [categoryId, setCategoryId] = useState("");
  const [isVisible, setIsVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const atMaxTotal = totalCount >= maxTotal;
  const atMaxVisible = visibleCount >= maxVisible;
  const selected = useMemo(
    () => availableCategories.find((c) => c.id === categoryId) ?? null,
    [availableCategories, categoryId]
  );

  async function handleSubmit() {
    setError(null);
    if (!categoryId) {
      setError("Select a root category for this tab.");
      return;
    }
    if (atMaxTotal) {
      setError(`You already have ${maxTotal} header tabs.`);
      return;
    }
    if (isVisible && atMaxVisible) {
      setError(
        `At most ${maxVisible} tabs can be visible. Hide another tab or add this as hidden.`
      );
      return;
    }

    try {
      await onSubmit({ categoryId, isVisible });
      setCategoryId("");
      setIsVisible(true);
      setError(null);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add tab.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) {
          setError(null);
          setCategoryId("");
          setIsVisible(true);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add header tab</DialogTitle>
          <DialogDescription>
            Root categories become top-level navbar tabs (Men, Women, Kids…).
            Only {maxVisible} can be visible at once.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="add-tab-category">Root category</Label>
            <Select
              value={categoryId || undefined}
              onValueChange={setCategoryId}
              disabled={!canUpdate || busy || availableCategories.length === 0}
            >
              <SelectTrigger id="add-tab-category" className="w-full">
                <SelectValue placeholder="Select a root category…" />
              </SelectTrigger>
              <SelectContent>
                {availableCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="flex items-center gap-2">
                      <FolderTree className="size-3.5 text-muted-foreground" />
                      <span>{cat.name}</span>
                      <span className="text-xs text-muted-foreground">
                        /{cat.slug}
                        {cat.childCount > 0 ? ` · ${cat.childCount} children` : ""}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableCategories.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Every root category is already in the header, or none exist yet.
                Create categories in Manage → Categories first.
              </p>
            )}
            {selected && (
              <p className="text-xs text-muted-foreground">
                Slug: <code className="rounded bg-muted px-1">/{selected.slug}</code>
                {" · "}
                Storefront link:{" "}
                <code className="rounded bg-muted px-1">
                  /category/{selected.slug}
                </code>
              </p>
            )}
          </div>

          <label
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
              isVisible ? "border-primary/30 bg-primary/5" : "border-border"
            )}
          >
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={isVisible}
              disabled={!canUpdate || busy || (atMaxVisible && !isVisible)}
              onChange={(e) => setIsVisible(e.target.checked)}
            />
            <span>
              Visible in storefront navbar
              {atMaxVisible && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({visibleCount}/{maxVisible} used)
                </span>
              )}
            </span>
          </label>

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
            disabled={!canUpdate || busy || !categoryId || atMaxTotal}
            onClick={() => void handleSubmit()}
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Add tab
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
