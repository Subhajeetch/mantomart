'use client';

import { Loader2, ShoppingBag } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ProductCtaProps = {
  disabled: boolean;
  outOfStock: boolean;
  isAddingToCart?: boolean;
  onAddToCart: () => void;
  onBuyNow: () => void;
  className?: string;
  compact?: boolean;
};

export function ProductCta({
  disabled,
  outOfStock,
  isAddingToCart = false,
  onAddToCart,
  onBuyNow,
  className,
  compact = false,
}: ProductCtaProps) {
  const label = outOfStock ? 'Out of stock' : isAddingToCart ? 'Adding…' : 'Add to Cart';

  return (
    <div className={cn('grid grid-cols-2 gap-2 sm:gap-3', className)}>
      <Button
        type="button"
        size={compact ? 'lg' : 'lg'}
        disabled={disabled || isAddingToCart}
        onClick={onAddToCart}
        className="h-12 rounded-none bg-foreground text-background hover:bg-foreground/90"
      >
        {isAddingToCart ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : (
          <ShoppingBag data-icon="inline-start" />
        )}
        {label}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={disabled}
        onClick={onBuyNow}
        className="h-12 rounded-none border-foreground/20"
      >
        Buy Now
      </Button>
    </div>
  );
}
