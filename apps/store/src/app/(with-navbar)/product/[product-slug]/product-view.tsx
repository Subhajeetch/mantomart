'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { addToCart, handleBuyNow, undoAddToCart } from '@/utils/cart';
import { toast } from '@/components/ui/toast';
import { useNeedLogin } from '@/components/need-login-context';

import { ProductGallery } from './gallery/product-gallery';
import { ProductDetailsTabs } from './info/product-details-tabs';
import { ProductInfo } from './info/product-info';
import { FloatingCta } from './floating-cta';
import { MoreForYou } from './more-for-you';
import { ProductBreadcrumbs } from './product-breadcrumbs';
import type { MoreForYouPage, PublicProduct } from './types';
import { useProductSelection } from './use-product-selection';
import { useSession } from '@/lib/auth-client';

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
  const { data: session } = useSession();
  const { openNeedLogin } = useNeedLogin();
  const ctaRef = useRef<HTMLDivElement>(null);
  const moreForYouRef = useRef<HTMLElement>(null);
  const [ctaInView, setCtaInView] = useState(true);
  const [moreForYouInView, setMoreForYouInView] = useState(false);
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
    const el = moreForYouRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setMoreForYouInView(Boolean(entry?.isIntersecting)),
      { rootMargin: '-40% 0px -40% 0px', threshold: 0 }
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

  const onAddToCart = useCallback(async () => {
    if (!selection.sku || selection.sku.stock <= 0) return;
    // Add-to-cart works for guests too — the API builds a guest cart keyed by
    // the stored X-Guest-Id and merges it into the account on sign-in.
    try {
      const result = await addToCart(cartInput);
      window.dispatchEvent(new CustomEvent('cart-updated', { detail: result.summary }));
      toast.add({
        title: 'Added to cart',
        description: `${product.name} was added to your cart.`,
        type: 'success',
        actionProps: {
          children: 'Undo',
          onClick: () => {
            void undoAddToCart(result.itemId, result.previousQuantity)
              .then((summary) => {
                window.dispatchEvent(
                  new CustomEvent('cart-updated', { detail: summary })
                );
              })
              .catch(() => {
                toast.add({
                  title: 'Unable to undo',
                  description: 'The cart could not be restored.',
                  type: 'error',
                });
              });
          },
        },
      });
    } catch (error) {
      toast.add({
        title: 'Unable to add this item',
        description:
          error instanceof Error ? error.message : 'Unable to add this item to your cart.',
        type: 'error',
      });
    }
  }, [cartInput, product.slug, selection.sku, session?.user?.id]);

  const onBuyNow = useCallback(async () => {
    if (!selection.sku || selection.sku.stock <= 0) return;
    if (!session?.user?.id) {
      openNeedLogin({
        title: 'Log in to buy this product',
        description: 'Log in so we can secure this item and take you straight to checkout.',
        returnTo:
          typeof window !== 'undefined'
            ? window.location.href
            : undefined,
      });
      return;
    }
    try {
      await handleBuyNow(cartInput);
    } catch (error) {
      toast.add({
        title: 'Unable to start checkout',
        description:
          error instanceof Error ? error.message : 'Please try again in a moment.',
        type: 'error',
      });
    }
  }, [cartInput, openNeedLogin, selection.sku, session?.user?.id]);

  const outOfStock = !selection.sku || selection.sku.stock <= 0;
  const activeVariant = colorVariant(product, selection.selected);
  const showFloating = !ctaInView && !lightboxOpen && !moreForYouInView;

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

      <MoreForYou
        slug={product.slug}
        initial={more}
        sectionRef={moreForYouRef}
      />

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
