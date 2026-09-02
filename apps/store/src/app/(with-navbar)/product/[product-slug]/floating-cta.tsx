'use client';

import { ProductCta } from './info/product-cta';

type FloatingCtaProps = {
  visible: boolean;
  disabled: boolean;
  outOfStock: boolean;
  onAddToCart: () => void;
  onBuyNow: () => void;
};

export function FloatingCta({
  visible,
  disabled,
  outOfStock,
  onAddToCart,
  onBuyNow,
}: FloatingCtaProps) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-20 bottom-20 sm:bottom-0"
      aria-hidden={!visible}
    >
      <div
        className={`border-t bg-background/95 px-3 py-2 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur transition-opacity duration-150 sm:px-6 ${
          visible
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="mx-auto max-w-7xl">
          <ProductCta
            disabled={disabled}
            outOfStock={outOfStock}
            onAddToCart={onAddToCart}
            onBuyNow={onBuyNow}
            compact
          />
        </div>
      </div>
    </div>
  );
}
