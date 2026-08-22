"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { ProductSearchInput } from "./product-search-input";
import type { FlatCategory, PromoLinkConfig, PromoLinkKind } from "./types";

type PromoLinkFieldProps = {
  label: string;
  hint?: string;
  value?: PromoLinkConfig;
  disabled?: boolean;
  categories: FlatCategory[];
  onChange: (next: PromoLinkConfig | undefined) => void;
};

export function PromoLinkField({
  label,
  hint,
  value,
  disabled,
  categories,
  onChange,
}: PromoLinkFieldProps) {
  const [draftKind, setDraftKind] = useState<PromoLinkKind | "none" | null>(
    null
  );
  const kind = draftKind ?? value?.kind ?? "none";

  useEffect(() => {
    if (value?.kind) setDraftKind(null);
  }, [value]);

  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      <Select
        value={kind}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === "none") {
            setDraftKind(null);
            onChange(undefined);
            return;
          }
          if (next === "product" || next === "category" || next === "custom") {
            setDraftKind(next);
            onChange(undefined);
          }
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="No extra link" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None (use default)</SelectItem>
          <SelectItem value="product">Product page</SelectItem>
          <SelectItem value="category">Category page</SelectItem>
          <SelectItem value="custom">Custom URL</SelectItem>
        </SelectContent>
      </Select>

      {kind === "product" ? (
        <div className="grid gap-1.5">
          {value?.kind === "product" && value.productId ? (
            <p className="rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
              {value.productName || value.productSlug || value.productId}
            </p>
          ) : null}
          <ProductSearchInput
            disabled={disabled}
            placeholder="Search a product to link…"
            onSelect={(hit) => {
              setDraftKind(null);
              onChange({
                kind: "product",
                productId: hit.id,
                productName: hit.name,
                productSlug: hit.slug,
              });
            }}
          />
        </div>
      ) : null}

      {kind === "category" ? (
        <Select
          value={value?.kind === "category" ? value.categoryId : undefined}
          disabled={disabled}
          onValueChange={(id) => {
            const cat = categories.find((item) => item.id === id);
            setDraftKind(null);
            onChange({
              kind: "category",
              categoryId: id,
              categoryName: cat?.name,
              categorySlug: cat?.slug,
            });
          }}
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
      ) : null}

      {kind === "custom" ? (
        <Input
          value={value?.kind === "custom" ? (value.href ?? "") : ""}
          disabled={disabled}
          maxLength={2048}
          placeholder="/sale or https://…"
          onChange={(e) => {
            const href = e.target.value.trim();
            if (!href) {
              onChange(undefined);
              setDraftKind("custom");
              return;
            }
            setDraftKind(null);
            onChange({ kind: "custom", href });
          }}
        />
      ) : null}
    </div>
  );
}
