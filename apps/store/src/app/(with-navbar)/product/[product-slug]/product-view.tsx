'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { addToCart, handleBuyNow } from '@/utils/cart';

import { ProductGallery } from './gallery/product-gallery';
import { ProductDetailsTabs } from './info/product-details-tabs';
import { ProductInfo } from './info/product-info';
import { FloatingCta } from './floating-cta';
import { MoreForYou } from './more-for-you';
import { ProductBreadcrumbs } from './product-breadcrumbs';
import type { MoreForYouPage, PublicProduct } from './types';
import { useProductSelection } from './use-product-selection';

type ProductViewProps = {
  product: PublicProduct;
  more: MoreForYouPage;
};

function colorVariant(
  product: PublicProduct,
  selected: Record<string, string>
): string | null {
  const colorGroup =
    product.optionGroups.find((group) => group.hasImages) ??
    product.optionGroups.find((group) => /colou?r/i.test(group.name));
  if (!colorGroup) return null;
  return selected[colorGroup.name] ?? null;
}

export function ProductView({ product, more }: ProductViewProps) {
  const selection = useProductSelection(product);
  const ctaRef = useRef<HTMLDivElement>(null);
  const [ctaInView, setCtaInView] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    const el = ctaRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setCtaInView(Boolean(entry?.isIntersecting));
      },
      { threshold: 0.2 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onLightbox = (event: Event) => {
      const custom = event as CustomEvent<boolean>;
      setLightboxOpen(Boolean(custom.detail));
    };
    window.addEventListener('product-lightbox', onLightbox);
    return () => window.removeEventListener('product-lightbox', onLightbox);
  }, []);

  const cartInput = useMemo(
    () => ({
      productId: product.id,
      slug: product.slug,
      skuId: selection.sku?.id ?? null,
      quantity: selection.quantity,
    }),
    [product.id, product.slug, selection.quantity, selection.sku?.id]
  );

  const onAddToCart = useCallback(() => {
    if (!selection.sku || selection.sku.stock <= 0) return;
    addToCart(cartInput);
  }, [cartInput, selection.sku]);

  const onBuyNow = useCallback(() => {
    if (!selection.sku || selection.sku.stock <= 0) return;
    handleBuyNow(cartInput);
  }, [cartInput, selection.sku]);

  const outOfStock = !selection.sku || selection.sku.stock <= 0;
  const activeVariant = colorVariant(product, selection.selected);
  const showFloating = !ctaInView && !lightboxOpen;

  return (
    <div className="px-4 pt-4 pb-8 mx-auto max-w-7xl">
      <ProductBreadcrumbs product={product} />
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <ProductGallery
          items={product.gallery}
          productName={product.name}
          activeVariant={activeVariant}
        />
        <ProductInfo
          product={product}
          selection={selection}
          ctaRef={ctaRef}
          onAddToCart={onAddToCart}
          onBuyNow={onBuyNow}
        />
      </div>

      <ProductDetailsTabs product={product} />

      <MoreForYou slug={product.slug} initial={more} />

      <FloatingCta
        visible={showFloating}
        disabled={outOfStock}
        outOfStock={outOfStock}
        onAddToCart={onAddToCart}
        onBuyNow={onBuyNow}
      />
    </div>
  );
}
