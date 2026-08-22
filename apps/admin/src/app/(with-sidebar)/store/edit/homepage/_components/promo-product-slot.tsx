"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ProductSearchInput } from "./product-search-input";
import { PromoLinkField } from "./promo-link-field";
import type { FlatCategory, PromoSlideProductSlot } from "./types";
import { centsToInput, formatCents, inputToCents, localId } from "./utils";

type PromoProductSlotProps = {
  index: number;
  slot?: PromoSlideProductSlot;
  disabled?: boolean;
  categories: FlatCategory[];
  onChange: (next: PromoSlideProductSlot | undefined) => void;
};

export function PromoProductSlot({
  index,
  slot,
  disabled,
  categories,
  onChange,
}: PromoProductSlotProps) {
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Product {index + 1}</p>
        {slot ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={`Remove product ${index + 1}`}
            onClick={() => onChange(undefined)}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>

      {slot ? (
        <div className="flex items-center gap-2">
          <div className="size-12 shrink-0 overflow-hidden bg-muted">
            {slot.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slot.imageUrl}
                alt=""
                className="size-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm">{slot.name || slot.productId}</p>
            <p className="text-[11px] text-muted-foreground">
              {formatCents(slot.price) || "No price"}
              {slot.slug ? ` · /${slot.slug}` : ""}
            </p>
          </div>
        </div>
      ) : (
        <ProductSearchInput
          disabled={disabled}
          onSelect={(hit) =>
            onChange({
              id: localId(),
              productId: hit.id,
              name: hit.name,
              slug: hit.slug,
              imageUrl: hit.imageUrl ?? undefined,
              imageAlt: hit.imageAlt ?? undefined,
              price: hit.price ?? undefined,
              compareAtPrice: hit.compareAtPrice ?? undefined,
            })
          }
        />
      )}

      {slot ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label>Discount label</Label>
              <Input
                value={slot.discountLabel ?? ""}
                disabled={disabled}
                maxLength={40}
                placeholder="20% off now!"
                onChange={(e) =>
                  onChange({
                    ...slot,
                    discountLabel: e.target.value || undefined,
                  })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Sale price (USD)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                disabled={disabled}
                placeholder={centsToInput(slot.price) || "18.85"}
                value={centsToInput(slot.salePriceCents)}
                onChange={(e) =>
                  onChange({
                    ...slot,
                    salePriceCents: inputToCents(e.target.value),
                  })
                }
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Compare-at price (USD)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              disabled={disabled}
              placeholder={centsToInput(slot.compareAtPrice) || "optional"}
              value={centsToInput(slot.compareAtOverrideCents)}
              onChange={(e) =>
                onChange({
                  ...slot,
                  compareAtOverrideCents: inputToCents(e.target.value),
                })
              }
            />
          </div>
          <PromoLinkField
            label="Product card link"
            hint="Defaults to this product’s page."
            value={slot.link}
            disabled={disabled}
            categories={categories}
            onChange={(link) => onChange({ ...slot, link })}
          />
        </>
      ) : null}
    </div>
  );
}
