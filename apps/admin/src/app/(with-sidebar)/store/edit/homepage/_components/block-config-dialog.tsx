"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { ImageUploadField } from "@/components/image-upload";
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
import { Textarea } from "@/components/ui/textarea";

import type {
  CategoryCtaButtonConfig,
  CategoryNode,
  HomepageAdminBlock,
  HomepageBlockConfig,
  HomepageMeta,
  PromoSlideConfigItem,
} from "./types";
import { BLOCK_TYPE_LABELS } from "./types";
import {
  asCtaConfig,
  asFeedConfig,
  asGridConfig,
  asPromoConfig,
  flattenCategories,
  localId,
} from "./utils";

type BlockConfigDialogProps = {
  block: HomepageAdminBlock | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canUpdate: boolean;
  busy: boolean;
  meta: HomepageMeta | null;
  categoryTree: CategoryNode[];
  onSave: (id: string, config: HomepageBlockConfig) => Promise<void>;
};

export function BlockConfigDialog({
  block,
  open,
  onOpenChange,
  canUpdate,
  busy,
  meta,
  categoryTree,
  onSave,
}: BlockConfigDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<HomepageBlockConfig | null>(null);

  const categories = useMemo(
    () => flattenCategories(categoryTree),
    [categoryTree]
  );

  useEffect(() => {
    if (!block) {
      setConfig(null);
      setError(null);
      return;
    }
    setError(null);
    switch (block.blockType) {
      case "promo_slider":
        setConfig(asPromoConfig(block.config));
        break;
      case "product_grid":
        setConfig(asGridConfig(block.config));
        break;
      case "category_cta":
        setConfig(asCtaConfig(block.config));
        break;
      case "product_feed":
        setConfig(asFeedConfig(block.config));
        break;
    }
  }, [block]);

  async function handleSave() {
    if (!block || !config) return;
    setError(null);
    if (!canUpdate) {
      setError("You do not have permission to edit the homepage.");
      return;
    }
    try {
      await onSave(block.id, config);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save block.");
    }
  }

  const title = block
    ? `Edit ${BLOCK_TYPE_LABELS[block.blockType]}`
    : "Edit block";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Changes apply after you save. Invalid values are rejected by the
            server.
          </DialogDescription>
        </DialogHeader>

        {block && config ? (
          <div className="grid gap-4">
            {config.type === "promo_slider" ? (
              <PromoEditor
                config={config}
                disabled={busy || !canUpdate}
                maxSlides={meta?.maxSlidesPerSlider ?? 12}
                onChange={setConfig}
              />
            ) : null}
            {config.type === "product_grid" ? (
              <GridEditor
                config={config}
                disabled={busy || !canUpdate}
                maxLimit={meta?.maxGridLimit ?? 24}
                categories={categories}
                onChange={setConfig}
              />
            ) : null}
            {config.type === "category_cta" ? (
              <CtaEditor
                config={config}
                disabled={busy || !canUpdate}
                maxButtons={meta?.maxButtonsPerCta ?? 6}
                categories={categories}
                onChange={setConfig}
              />
            ) : null}
            {config.type === "product_feed" ? (
              <FeedEditor
                config={config}
                disabled={busy || !canUpdate}
                maxPageSize={meta?.maxFeedPageSize ?? 24}
                onChange={setConfig}
              />
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={busy || !canUpdate || !block}
            onClick={() => void handleSave()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PromoEditor({
  config,
  disabled,
  maxSlides,
  onChange,
}: {
  config: Extract<HomepageBlockConfig, { type: "promo_slider" }>;
  disabled: boolean;
  maxSlides: number;
  onChange: (next: HomepageBlockConfig) => void;
}) {
  const slides = config.slides;

  function updateSlide(id: string, patch: Partial<PromoSlideConfigItem>) {
    onChange({
      ...config,
      slides: slides.map((slide) =>
        slide.id === id ? { ...slide, ...patch } : slide
      ),
    });
  }

  function addSlide() {
    if (slides.length >= maxSlides) return;
    const next: PromoSlideConfigItem = {
      id: localId(),
      imageUrl: "",
      audience: "all",
    };
    onChange({ ...config, slides: [...slides, next] });
  }

  function removeSlide(id: string) {
    onChange({ ...config, slides: slides.filter((slide) => slide.id !== id) });
  }

  return (
    <div className="grid gap-3">
      {slides.map((slide, index) => (
        <div key={slide.id} className="grid gap-3 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Slide {index + 1}</p>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={() => removeSlide(slide.id)}
              aria-label={`Remove slide ${index + 1}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <ImageUploadField
            value={slide.imageUrl}
            onChange={(url) => updateSlide(slide.id, { imageUrl: url })}
            disabled={disabled}
            folder="banner"
            name={`homepage-slide-${slide.id}`}
            purpose="banner"
            label="Desktop image"
            outputWidth={1600}
            outputHeight={720}
          />
          <ImageUploadField
            value={slide.mobileImageUrl ?? ""}
            onChange={(url) =>
              updateSlide(slide.id, { mobileImageUrl: url || undefined })
            }
            disabled={disabled}
            folder="banner"
            name={`homepage-slide-m-${slide.id}`}
            purpose="banner"
            label="Mobile image (optional)"
            outputWidth={800}
            outputHeight={1000}
          />
          <div className="grid gap-1.5">
            <Label>Title</Label>
            <Input
              value={slide.title ?? ""}
              disabled={disabled}
              maxLength={120}
              onChange={(e) =>
                updateSlide(slide.id, { title: e.target.value || undefined })
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Subtitle</Label>
            <Textarea
              value={slide.subtitle ?? ""}
              disabled={disabled}
              maxLength={240}
              onChange={(e) =>
                updateSlide(slide.id, {
                  subtitle: e.target.value || undefined,
                })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label>CTA label</Label>
              <Input
                value={slide.ctaLabel ?? ""}
                disabled={disabled}
                maxLength={40}
                onChange={(e) =>
                  updateSlide(slide.id, {
                    ctaLabel: e.target.value || undefined,
                  })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label>CTA link</Label>
              <Input
                value={slide.ctaHref ?? ""}
                disabled={disabled}
                maxLength={2048}
                placeholder="/category/…"
                onChange={(e) =>
                  updateSlide(slide.id, {
                    ctaHref: e.target.value || undefined,
                  })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label>Audience</Label>
              <Select
                value={slide.audience}
                disabled={disabled}
                onValueChange={(value) => {
                  if (value === "all" || value === "new_user") {
                    updateSlide(slide.id, { audience: value });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="new_user">New users only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Discount label</Label>
              <Input
                value={slide.discountLabel ?? ""}
                disabled={disabled}
                maxLength={40}
                placeholder="20% off first order"
                onChange={(e) =>
                  updateSlide(slide.id, {
                    discountLabel: e.target.value || undefined,
                  })
                }
              />
            </div>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || slides.length >= maxSlides}
        onClick={addSlide}
        className="gap-1.5"
      >
        <Plus className="size-3.5" />
        Add slide
      </Button>
    </div>
  );
}

function GridEditor({
  config,
  disabled,
  maxLimit,
  categories,
  onChange,
}: {
  config: Extract<HomepageBlockConfig, { type: "product_grid" }>;
  disabled: boolean;
  maxLimit: number;
  categories: Array<{ id: string; label: string }>;
  onChange: (next: HomepageBlockConfig) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label>Source</Label>
        <Select
          value={config.source}
          disabled={disabled}
          onValueChange={(value) => {
            if (value === "featured" || value === "category") {
              onChange({
                ...config,
                source: value,
                categoryId:
                  value === "featured" ? undefined : config.categoryId,
              });
            }
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="featured">Featured products</SelectItem>
            <SelectItem value="category">Category</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {config.source === "category" ? (
        <div className="grid gap-1.5">
          <Label>Category</Label>
          <Select
            value={config.categoryId ?? ""}
            disabled={disabled}
            onValueChange={(value) =>
              onChange({ ...config, categoryId: value })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <Label>Limit (1–{maxLimit})</Label>
        <Input
          type="number"
          min={1}
          max={maxLimit}
          disabled={disabled}
          value={config.limit}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            onChange({
              ...config,
              limit: Number.isFinite(n) ? n : config.limit,
            });
          }}
        />
      </div>
    </div>
  );
}

function CtaEditor({
  config,
  disabled,
  maxButtons,
  categories,
  onChange,
}: {
  config: Extract<HomepageBlockConfig, { type: "category_cta" }>;
  disabled: boolean;
  maxButtons: number;
  categories: Array<{ id: string; label: string }>;
  onChange: (next: HomepageBlockConfig) => void;
}) {
  function updateButton(id: string, patch: Partial<CategoryCtaButtonConfig>) {
    onChange({
      ...config,
      buttons: config.buttons.map((btn) =>
        btn.id === id ? { ...btn, ...patch } : btn
      ),
    });
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label>Title</Label>
        <Input
          value={config.title ?? ""}
          disabled={disabled}
          maxLength={120}
          onChange={(e) =>
            onChange({ ...config, title: e.target.value || undefined })
          }
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Subtitle</Label>
        <Input
          value={config.subtitle ?? ""}
          disabled={disabled}
          maxLength={240}
          onChange={(e) =>
            onChange({ ...config, subtitle: e.target.value || undefined })
          }
        />
      </div>
      {config.buttons.map((btn, index) => (
        <div key={btn.id} className="grid gap-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Button {index + 1}</p>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...config,
                  buttons: config.buttons.filter((b) => b.id !== btn.id),
                })
              }
              aria-label={`Remove button ${index + 1}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <Input
            value={btn.label}
            disabled={disabled}
            maxLength={40}
            placeholder="Label"
            onChange={(e) => updateButton(btn.id, { label: e.target.value })}
          />
          <Select
            value={btn.categoryId}
            disabled={disabled}
            onValueChange={(value) => updateButton(btn.id, { categoryId: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={btn.href ?? ""}
            disabled={disabled}
            maxLength={2048}
            placeholder="Optional custom href"
            onChange={(e) =>
              updateButton(btn.id, { href: e.target.value || undefined })
            }
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || config.buttons.length >= maxButtons}
        className="gap-1.5"
        onClick={() => {
          const first = categories[0];
          onChange({
            ...config,
            buttons: [
              ...config.buttons,
              {
                id: localId(),
                label: "Shop",
                categoryId: first?.id ?? "",
              },
            ],
          });
        }}
      >
        <Plus className="size-3.5" />
        Add button
      </Button>
    </div>
  );
}

function FeedEditor({
  config,
  disabled,
  maxPageSize,
  onChange,
}: {
  config: Extract<HomepageBlockConfig, { type: "product_feed" }>;
  disabled: boolean;
  maxPageSize: number;
  onChange: (next: HomepageBlockConfig) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>Page size (4–{maxPageSize})</Label>
      <Input
        type="number"
        min={4}
        max={maxPageSize}
        disabled={disabled}
        value={config.pageSize}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onChange({
            ...config,
            pageSize: Number.isFinite(n) ? n : config.pageSize,
          });
        }}
      />
      <p className="text-xs text-muted-foreground">
        The product feed must stay last. Infinite scroll loads this many
        products per page.
      </p>
    </div>
  );
}
