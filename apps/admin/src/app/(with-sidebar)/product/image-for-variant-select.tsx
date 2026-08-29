'use client';

import { Package } from 'lucide-react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ProxiedImg } from '@/util/proxied-image';

import type { ColorVariantOption } from './add/import-wizard-utils';
import { composeProductImageAlt } from './manage/utils';

/** Radix Select forbids empty-string values. */
export const IMAGE_FOR_VARIANT_NONE = '__none__';

type ImageForVariantSelectProps = {
  value: string | null | undefined;
  options: ColorVariantOption[];
  productName: string;
  onChange: (forVariant: string | undefined) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  /** Compact label shown above the control. */
  label?: string;
};

function VariantSwatch({
  image,
  className,
}: {
  image: string | null;
  className?: string;
}) {
  if (image) {
    return (
      <ProxiedImg
        src={image}
        alt=""
        className={cn(
          'h-10 w-10 shrink-0 rounded-md border object-cover',
          className
        )}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted',
        className
      )}
    >
      <Package className="h-4 w-4 text-muted-foreground" />
    </span>
  );
}

export function ImageForVariantSelect({
  value,
  options,
  productName,
  onChange,
  id,
  disabled,
  className,
  label = 'Colour for alt text',
}: ImageForVariantSelectProps) {
  const trimmed = value?.trim() || undefined;
  const selectValue = trimmed ?? IMAGE_FOR_VARIANT_NONE;
  const composedAlt = composeProductImageAlt(productName, {
    forVariant: trimmed,
  });

  if (options.length === 0) {
    return (
      <div className={cn('space-y-1', className)}>
        {label ? (
          <Label htmlFor={id} className="text-[9px] leading-none text-muted-foreground sm:text-xs">
            {label}
          </Label>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          No colour variants. Alt will be the product name
          {productName.trim() ? ` (“${productName.trim()}”)` : ''}.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      {label ? (
        <Label
          htmlFor={id}
          className="text-[9px] leading-none text-muted-foreground sm:text-xs"
        >
          {label}
        </Label>
      ) : null}
      <Select
        value={selectValue}
        onValueChange={(next) => {
          if (next === IMAGE_FOR_VARIANT_NONE) onChange(undefined);
          else onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="h-12 min-h-12 w-full gap-2 py-1.5 [&>span]:flex [&>span]:min-w-0 [&>span]:items-center [&>span]:line-clamp-none"
        >
          <SelectValue placeholder="Select colour" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={IMAGE_FOR_VARIANT_NONE} className="py-1.5">
            <span className="flex min-w-0 items-center gap-2">
              <VariantSwatch image={null} />
              <span className="truncate">No colour</span>
            </span>
          </SelectItem>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                <VariantSwatch image={option.image} />
                <span className="truncate">{option.value}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p
        className="truncate text-[11px] text-muted-foreground"
        title={composedAlt || undefined}
      >
        Alt: {composedAlt || 'Product name'}
      </p>
    </div>
  );
}
