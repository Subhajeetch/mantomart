"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

import { PromoLinkField } from "./promo-link-field";
import { PromoProductSlot } from "./promo-product-slot";
import type {
  FlatCategory,
  HomepageBlockConfig,
  PromoSlideConfigItem,
  PromoSlideLayout,
  PromoSlideOffer,
  PromoSlideProductSlot,
  PromoSliderConfig,
} from "./types";
import {
  PROMO_SLIDE_LAYOUT_META,
  PROMO_SLIDE_LAYOUTS,
  PROMO_SLIDE_THEME_META,
  PROMO_SLIDE_THEMES,
} from "./types";
import {
  datetimeLocalToIso,
  emptyPromoSlide,
  isoToDatetimeLocal,
  localId,
} from "./utils";

type PromoEditorProps = {
  config: PromoSliderConfig;
  disabled: boolean;
  maxSlides: number;
  categories: FlatCategory[];
  onChange: (next: HomepageBlockConfig) => void;
};

export function PromoEditor({
  config,
  disabled,
  maxSlides,
  categories,
  onChange,
}: PromoEditorProps) {
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
    onChange({ ...config, slides: [...slides, emptyPromoSlide(localId())] });
  }

  function removeSlide(id: string) {
    onChange({ ...config, slides: slides.filter((slide) => slide.id !== id) });
  }

  return (
    <div className="grid gap-3">
      {slides.map((slide, index) => (
        <SlideEditor
          key={slide.id}
          index={index}
          slide={slide}
          disabled={disabled}
          categories={categories}
          onChange={(patch) => updateSlide(slide.id, patch)}
          onRemove={() => removeSlide(slide.id)}
        />
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

function SlideEditor({
  index,
  slide,
  disabled,
  categories,
  onChange,
  onRemove,
}: {
  index: number;
  slide: PromoSlideConfigItem;
  disabled: boolean;
  categories: FlatCategory[];
  onChange: (patch: Partial<PromoSlideConfigItem>) => void;
  onRemove: () => void;
}) {
  if (slide.layout === "legacy") {
    return (
      <div className="grid gap-3 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Slide {index + 1} · Classic image</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove slide ${index + 1}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          This slide still uses a uploaded banner image. Convert it to a product
          layout — new slides never upload images to storage.
        </p>
        {slide.imageUrl ? (
          <div className="overflow-hidden rounded-md border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slide.imageUrl}
              alt=""
              className="max-h-28 w-full object-cover"
            />
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...emptyPromoSlide(slide.id),
              title: slide.title,
              subtitle: slide.subtitle,
              ctaLabel: slide.ctaLabel,
              audience: slide.audience,
            })
          }
        >
          Convert to product layout
        </Button>
      </div>
    );
  }

  const meta = PROMO_SLIDE_LAYOUT_META[slide.layout];
  const products = slide.products ?? [];
  const offers = slide.offers ?? [];

  function setProductAt(
    slotIndex: number,
    next: PromoSlideProductSlot | undefined
  ) {
    const nextProducts = products.filter(Boolean);
    if (next) {
      if (slotIndex < nextProducts.length) nextProducts[slotIndex] = next;
      else nextProducts.push(next);
    } else if (slotIndex < nextProducts.length) {
      nextProducts.splice(slotIndex, 1);
    }
    onChange({ products: nextProducts });
  }

  function setOfferAt(slotIndex: number, patch: Partial<PromoSlideOffer>) {
    const nextOffers: PromoSlideOffer[] = offers
      .filter(Boolean)
      .map((offer) => ({ ...offer }));
    while (nextOffers.length <= slotIndex) {
      nextOffers.push({ id: localId(), title: "" });
    }
    const current = nextOffers[slotIndex]!;
    const merged: PromoSlideOffer = {
      id: current.id,
      title: patch.title ?? current.title,
      subtitle:
        patch.subtitle !== undefined ? patch.subtitle : current.subtitle,
      code: patch.code !== undefined ? patch.code : current.code,
      link: patch.link !== undefined ? patch.link : current.link,
    };
    nextOffers[slotIndex] = merged;
    onChange({
      offers: nextOffers.filter(
        (offer) => offer.title.trim() || offer.subtitle || offer.code
      ),
    });
  }

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Slide {index + 1} · {meta.label}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onClick={onRemove}
          aria-label={`Remove slide ${index + 1}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label>Layout</Label>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {PROMO_SLIDE_LAYOUTS.map((layout) => {
            const item = PROMO_SLIDE_LAYOUT_META[layout];
            const selected = slide.layout === layout;
            return (
              <button
                key={layout}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (layout === slide.layout) return;
                  const nextMeta = PROMO_SLIDE_LAYOUT_META[layout];
                  onChange({
                    layout,
                    products: products.slice(0, nextMeta.productSlots),
                    offers: nextMeta.offerSlots
                      ? offers.slice(0, nextMeta.offerSlots)
                      : [],
                    graphicTitle: nextMeta.hasGraphic
                      ? slide.graphicTitle
                      : undefined,
                    graphicSubtitle: nextMeta.hasGraphic
                      ? slide.graphicSubtitle
                      : undefined,
                  });
                }}
                className={cn(
                  "rounded-md border px-2 py-2 text-left transition-colors",
                  selected
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/60",
                  disabled && "opacity-50"
                )}
              >
                <p className="text-xs font-medium">{item.label}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                  {item.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-1.5">
          {PROMO_SLIDE_THEMES.map((theme) => {
            const item = PROMO_SLIDE_THEME_META[theme];
            const selected = (slide.theme ?? "primary") === theme;
            return (
              <button
                key={theme}
                type="button"
                disabled={disabled}
                title={item.label}
                aria-label={item.label}
                aria-pressed={selected}
                onClick={() => onChange({ theme })}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]",
                  selected ? "border-foreground" : "border-transparent"
                )}
              >
                <span
                  className="size-3.5 rounded-full ring-1 ring-foreground/15"
                  style={{ background: item.swatch }}
                />
                {item.label}
              </button>
            );
          })}
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
                onChange({ audience: value });
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
          <Label>Countdown end</Label>
          <Input
            type="datetime-local"
            disabled={disabled}
            value={isoToDatetimeLocal(slide.endsAt)}
            onChange={(e) =>
              onChange({ endsAt: datetimeLocalToIso(e.target.value) })
            }
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label>Kicker</Label>
        <Input
          value={slide.kicker ?? ""}
          disabled={disabled}
          maxLength={80}
          placeholder="Sale ends tonight"
          onChange={(e) => onChange({ kicker: e.target.value || undefined })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Title</Label>
        <Input
          value={slide.title ?? ""}
          disabled={disabled}
          maxLength={120}
          onChange={(e) => onChange({ title: e.target.value || undefined })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Subtitle</Label>
        <Textarea
          value={slide.subtitle ?? ""}
          disabled={disabled}
          maxLength={240}
          onChange={(e) => onChange({ subtitle: e.target.value || undefined })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label>CTA label</Label>
        <Input
          value={slide.ctaLabel ?? ""}
          disabled={disabled}
          maxLength={40}
          placeholder="Shop now"
          onChange={(e) => onChange({ ctaLabel: e.target.value || undefined })}
        />
      </div>

      {meta.hasGraphic ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1.5">
            <Label>Graphic title</Label>
            <Input
              value={slide.graphicTitle ?? ""}
              disabled={disabled}
              maxLength={80}
              placeholder="Back to school"
              onChange={(e) =>
                onChange({ graphicTitle: e.target.value || undefined })
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Graphic subtitle</Label>
            <Input
              value={slide.graphicSubtitle ?? ""}
              disabled={disabled}
              maxLength={80}
              onChange={(e) =>
                onChange({ graphicSubtitle: e.target.value || undefined })
              }
            />
          </div>
        </div>
      ) : null}

      <PromoLinkField
        label="Whole-slide link"
        hint="Used when someone clicks the background, not a product or offer."
        value={slide.slideLink}
        disabled={disabled}
        categories={categories}
        onChange={(slideLink) => onChange({ slideLink })}
      />
      <PromoLinkField
        label="Title & CTA link"
        hint="Defaults to the whole-slide link."
        value={slide.titleLink}
        disabled={disabled}
        categories={categories}
        onChange={(titleLink) => onChange({ titleLink })}
      />

      <div className="grid gap-2">
        <p className="text-sm font-medium">
          Products ({meta.productSlots} slot{meta.productSlots === 1 ? "" : "s"})
        </p>
        {Array.from({ length: meta.productSlots }, (_, slotIndex) => (
          <PromoProductSlot
            key={`${slide.id}-p-${slotIndex}`}
            index={slotIndex}
            slot={products[slotIndex]}
            disabled={disabled}
            categories={categories}
            onChange={(next) => setProductAt(slotIndex, next)}
          />
        ))}
      </div>

      {meta.offerSlots > 0 ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Offer tiles</p>
          {Array.from({ length: meta.offerSlots }, (_, slotIndex) => {
            const offer = offers[slotIndex];
            return (
              <div key={`${slide.id}-o-${slotIndex}`} className="grid gap-2 rounded-md border p-3">
                <p className="text-sm font-medium">Offer {slotIndex + 1}</p>
                <Input
                  value={offer?.title ?? ""}
                  disabled={disabled}
                  maxLength={120}
                  placeholder="$85 OFF"
                  onChange={(e) =>
                    setOfferAt(slotIndex, { title: e.target.value })
                  }
                />
                <Input
                  value={offer?.subtitle ?? ""}
                  disabled={disabled}
                  maxLength={240}
                  placeholder="orders $599+"
                  onChange={(e) =>
                    setOfferAt(slotIndex, {
                      title: offer?.title ?? "",
                      subtitle: e.target.value || undefined,
                    })
                  }
                />
                <Input
                  value={offer?.code ?? ""}
                  disabled={disabled}
                  maxLength={32}
                  placeholder="Code"
                  onChange={(e) =>
                    setOfferAt(slotIndex, {
                      title: offer?.title ?? "",
                      code: e.target.value || undefined,
                    })
                  }
                />
                <PromoLinkField
                  label="Offer link"
                  value={offer?.link}
                  disabled={disabled}
                  categories={categories}
                  onChange={(link) =>
                    setOfferAt(slotIndex, {
                      title: offer?.title ?? "",
                      link,
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
