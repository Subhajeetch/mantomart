'use client';

import { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { PublicGalleryItem } from '../types';
import { DesktopZoomImage } from './desktop-zoom-image';
import { GalleryThumbs } from './gallery-thumbs';
import { MobileLightbox } from './mobile-lightbox';
import { ProductMedia } from './product-media';

type ProductGalleryProps = {
  items: PublicGalleryItem[];
  productName: string;
  activeVariant?: string | null;
};

function isDesktopViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(min-width: 768px)').matches;
}

function indexForVariant(
  items: PublicGalleryItem[],
  variant: string | null | undefined
): number {
  const needle = variant?.trim().toLowerCase();
  if (!needle) return -1;
  return items.findIndex((item) => {
    if (item.type !== 'image') return false;
    if (item.forVariant?.trim().toLowerCase() === needle) return true;
    return item.variantKeys.some(
      (key) => key.trim().toLowerCase() === needle
    );
  });
}

export function ProductGallery({
  items,
  productName,
  activeVariant,
}: ProductGalleryProps) {
  const safeItems = Array.isArray(items) ? items : [];
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: 'start',
    duration: 18,
    skipSnaps: false,
    dragFree: false,
  });

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setIndex(emblaApi.selectedScrollSnap());
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi]);

  useEffect(() => {
    const next = indexForVariant(safeItems, activeVariant);
    if (next < 0) return;
    emblaApi?.scrollTo(next);
  }, [activeVariant, emblaApi, safeItems]);

  const goTo = useCallback(
    (next: number) => {
      emblaApi?.scrollTo(next);
    },
    [emblaApi]
  );

  const active = safeItems[index] ?? safeItems[0];

  const onMainClick = () => {
    if (isDesktopViewport()) return;
    if (!active || active.type === 'video') return;
    setLightboxOpen(true);
  };

  if (safeItems.length === 0) {
    return (
      <div className="flex aspect-[3/4] w-full items-center justify-center bg-neutral-100 text-sm text-muted-foreground">
        No images
      </div>
    );
  }

  return (
    <div className="flex items-stretch gap-3 md:gap-4">
      {safeItems.length > 1 ? (
        <GalleryThumbs
          items={safeItems}
          index={index}
          productName={productName}
          onSelect={goTo}
        />
      ) : null}

      <div className="relative min-w-0 flex-1">
        <div
          ref={emblaRef}
          className="overflow-hidden bg-neutral-100"
          aria-roledescription="carousel"
          aria-label={`${productName} gallery`}
        >
          <div className="flex">
            {safeItems.map((item, itemIndex) => {
              const isActive = itemIndex === index;
              return (
                <div
                  key={`${item.type}-${item.url}-${itemIndex}`}
                  className="min-w-0 shrink-0 grow-0 basis-full"
                >
                  <div
                    className="relative aspect-[3/4] w-full cursor-zoom-in md:cursor-default"
                    onClick={item.type === 'image' ? onMainClick : undefined}
                    role={item.type === 'image' ? 'button' : undefined}
                    tabIndex={item.type === 'image' ? 0 : undefined}
                    onKeyDown={
                      item.type === 'image'
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onMainClick();
                            }
                          }
                        : undefined
                    }
                    aria-label={
                      item.type === 'image'
                        ? `Open ${item.alt || productName}`
                        : undefined
                    }
                  >
                    {item.type === 'image' && isActive ? (
                      <>
                        <div className="absolute inset-0 hidden md:block">
                          <DesktopZoomImage
                            src={item.url}
                            alt={isActive ? item.alt : ''}
                            priority={itemIndex === 0}
                          />
                        </div>
                        <div className="absolute inset-0 md:hidden">
                          <ProductMedia
                            item={item}
                            priority={itemIndex === 0}
                          />
                        </div>
                      </>
                    ) : (
                      <ProductMedia
                        item={item}
                        priority={itemIndex === 0}
                        className={cn(!isActive && 'pointer-events-none')}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {safeItems.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => emblaApi?.scrollPrev()}
              disabled={index === 0}
              className="absolute top-1/2 left-2 hidden size-9 -translate-y-1/2 items-center justify-center bg-white/90 text-foreground shadow-sm disabled:opacity-30 md:flex"
              aria-label="Previous image"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => emblaApi?.scrollNext()}
              disabled={index === safeItems.length - 1}
              className="absolute top-1/2 right-2 hidden size-9 -translate-y-1/2 items-center justify-center bg-white/90 text-foreground shadow-sm disabled:opacity-30 md:flex"
              aria-label="Next image"
            >
              <ChevronRight className="size-5" />
            </button>
            <div
              className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5 md:hidden"
              aria-hidden
            >
              {safeItems.map((item, itemIndex) => (
                <span
                  key={`dot-${item.url}-${itemIndex}`}
                  className={cn(
                    'size-1.5',
                    itemIndex === index ? 'bg-foreground' : 'bg-white/80'
                  )}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      <MobileLightbox
        open={lightboxOpen}
        items={safeItems}
        startIndex={index}
        productName={productName}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}
