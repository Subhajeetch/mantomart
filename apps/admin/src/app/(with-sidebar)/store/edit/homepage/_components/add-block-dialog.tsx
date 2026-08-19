"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

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

import type { HomepageBlockType } from "./types";
import { BLOCK_TYPE_LABELS, HOMEPAGE_BLOCK_TYPES } from "./types";

type AddBlockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canUpdate: boolean;
  busy: boolean;
  feedExists: boolean;
  atMax: boolean;
  onSubmit: (blockType: HomepageBlockType) => Promise<void>;
};

const DESCRIPTIONS: Record<HomepageBlockType, string> = {
  promo_slider: "Hero carousel of promo slides (optional first-order slide).",
  product_grid: "A finite grid of featured or category products.",
  category_cta: "Call-to-action buttons that link to categories.",
  product_feed: "Infinite-scroll product stream. Must be last; only one allowed.",
};

export function AddBlockDialog({
  open,
  onOpenChange,
  canUpdate,
  busy,
  feedExists,
  atMax,
  onSubmit,
}: AddBlockDialogProps) {
  const [blockType, setBlockType] = useState<HomepageBlockType>("promo_slider");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!canUpdate) {
      setError("You do not have permission to edit the homepage.");
      return;
    }
    if (atMax) {
      setError("Maximum number of blocks reached.");
      return;
    }
    if (blockType === "product_feed" && feedExists) {
      setError("Only one product feed is allowed.");
      return;
    }
    try {
      await onSubmit(blockType);
      onOpenChange(false);
      setBlockType("promo_slider");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add block.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add homepage block</DialogTitle>
          <DialogDescription>
            Choose a section type. You can edit its content after adding it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="block-type">Block type</Label>
            <Select
              value={blockType}
              onValueChange={(value) => {
                if (
                  value === "promo_slider" ||
                  value === "product_grid" ||
                  value === "category_cta" ||
                  value === "product_feed"
                ) {
                  setBlockType(value);
                  setError(null);
                }
              }}
              disabled={busy}
            >
              <SelectTrigger id="block-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOMEPAGE_BLOCK_TYPES.map((type) => (
                  <SelectItem
                    key={type}
                    value={type}
                    disabled={type === "product_feed" && feedExists}
                  >
                    {BLOCK_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {DESCRIPTIONS[blockType]}
            </p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={busy || !canUpdate || atMax} onClick={() => void handleSubmit()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Add block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
