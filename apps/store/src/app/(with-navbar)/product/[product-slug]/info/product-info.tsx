'use client';

import { useState, type RefObject } from 'react';
import Link from 'next/link';
import { Heart, Share2 } from 'lucide-react';

import {
  formatPriceCents,
  percentOff,
} from '@/components/homepage/format';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { PublicProduct } from '../types';
import type { ProductSelection } from '../use-product-selection';
import { ProductCta } from './product-cta';
import { ProductOptions } from './product-options';
import { QuantityStepper } from './quantity-stepper';
import { StarRating } from './star-rating';

type ProductInfoProps = {
  product: PublicProduct;
  selection: ProductSelection;
  ctaRef: RefObject<HTMLDivElement | null>;
  onAddToCart: () => void;
  onBuyNow: () => void;
};

async function shareProduct(name: string, url: string) {
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title: name, url });
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    }
  } catch {
    // User cancelled share, or clipboard is unavailable.
  }
}

export function ProductInfo({
  product,
  selection,
  ctaRef,
  onAddToCart,
  onBuyNow,
}: ProductInfoProps) {
  const [wishlisted, setWishlisted] = useState(false);
  const sku = selection.sku;
  const price = sku?.price ?? null;
  const compareAt = sku?.compareAtPrice ?? null;
  const off = percentOff(price, compareAt);
  const outOfStock = !sku || sku.stock <= 0;
  const disabled = outOfStock || !sku;

  const priceLabel = formatPriceCents(price);
  const wasLabel = off > 0 ? formatPriceCents(compareAt) : '';

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {product.category ? (
            <Link
              href={product.category.href}
              className="text-xs font-medium tracking-wide text-foreground/55 uppercase hover:text-foreground"
            >
              {product.category.name}
            </Link>
          ) : null}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {product.name}
          </h1>
          <StarRating
            rating={product.aeRating}
            reviewCount={product.aeReviewCount}
            salesCount={product.aeSalesCount}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-pressed={wishlisted}
            aria-label={
              wishlisted
                ? `Remove ${product.name} from wishlist`
                : `Save ${product.name} to wishlist`
            }
            onClick={() => setWishlisted((value) => !value)}
          >
            <Heart
              className={cn(
                'size-5',
                wishlisted ? 'fill-[#ff3f6c] text-[#ff3f6c]' : undefined
              )}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Share ${product.name}`}
            onClick={() => {
              const url =
                typeof window !== 'undefined' ? window.location.href : '';
              void shareProduct(product.name, url);
            }}
          >
            <Share2 className="size-5" />
          </Button>
        </div>
      </div>

      <p className="mt-4 flex flex-wrap items-baseline gap-2" aria-live="polite">
        {priceLabel ? (
          <span className="text-2xl font-bold tabular-nums">{priceLabel}</span>
        ) : (
          <span className="text-sm text-muted-foreground">See price</span>
        )}
        {wasLabel ? (
          <span className="text-base text-foreground/50 line-through tabular-nums">
            {wasLabel}
          </span>
        ) : null}
        {off > 0 ? (
          <span className="bg-destructive/10 px-1.5 py-0.5 text-sm font-semibold text-destructive">
            -{off}%
          </span>
        ) : null}
      </p>

      <div className="mt-6">
        <ProductOptions
          groups={product.optionGroups}
          selection={selection}
          hasSizeChart={product.hasSizeChart}
          sizeChartImage={product.sizeChartImage}
          sizeChartDescription={product.sizeChartDescription}
          productName={product.name}
        />
      </div>

      <div className="mt-6">
        <QuantityStepper
          value={selection.quantity}
          max={selection.maxQuantity}
          disabled={outOfStock}
          onChange={selection.setQuantity}
        />
      </div>

      <div ref={ctaRef} className="mt-6">
        <ProductCta
          disabled={disabled}
          outOfStock={outOfStock}
          onAddToCart={onAddToCart}
          onBuyNow={onBuyNow}
        />
      </div>
    </div>
  );
}
