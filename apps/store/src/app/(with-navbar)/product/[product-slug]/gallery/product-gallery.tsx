'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

/** Max dots on the mobile pager. Overflow is hinted with chevrons. */
const DOT_WINDOW_SIZE = 7;

type DotWindow = {
  start: number;
  end: number;
  showPrev: boolean;
  showNext: boolean;
};

function isDesktopViewport(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(min-width: 768px)').matches;
  } catch {
    return false;
  }
}

function clampIndex(value: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.trunc(value)), total - 1);
}

function sanitizeGalleryItems(items: PublicGalleryItem[]): PublicGalleryItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is PublicGalleryItem =>
      Boolean(item) &&
      (item.type === 'image' || item.type === 'video') &&
      typeof item.url === 'string' &&
      item.url.trim().length > 0
  );
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

/**
 * Sliding window of at most 7 dots.
 * First 7: no "<". Last 7: no ">". Middle: both.
 */
function getDotWindow(activeIndex: number, total: number): DotWindow {
  if (!Number.isFinite(total) || total <= 0) {
    return { start: 0, end: 0, showPrev: false, showNext: false };
  }

  const index = clampIndex(activeIndex, total);

  if (total <= DOT_WINDOW_SIZE) {
    return { start: 0, end: total, showPrev: false, showNext: false };
  }

  if (index < DOT_WINDOW_SIZE) {
    return {
      start: 0,
      end: DOT_WINDOW_SIZE,
      showPrev: false,
      showNext: true,
    };
  }

  if (index >= total - DOT_WINDOW_SIZE) {
    return {
      start: total - DOT_WINDOW_SIZE,
      end: total,
      showPrev: true,
      showNext: false,
    };
  }

  const half = Math.floor(DOT_WINDOW_SIZE / 2);
  const start = index - half;
  return {
    start,
    end: start + DOT_WINDOW_SIZE,
    showPrev: true,
    showNext: true,
  };
}

function GalleryDots({
  items,
  index,
}: {
  items: PublicGalleryItem[];
  index: number;
}) {
  const total = items.length;
  if (total <= 1) return null;

  const dots = getDotWindow(index, total);
  const hasOverflow = total > DOT_WINDOW_SIZE;
  const visible = items.slice(dots.start, dots.end);
  const safeIndex = clampIndex(index, total);

  return (
    <div
      className="absolute inset-x-0 bottom-3 flex justify-center md:hidden"
      role="status"
      aria-live="polite"
      aria-label={`Image ${safeIndex + 1} of ${total}`}
    >
      <div className="flex items-center gap-1 rounded-full bg-black/45 px-2 py-1.5 shadow-sm backdrop-blur-[2px]">
        {hasOverflow ? (
          <ChevronLeft
            className={cn(
              'size-3.5 shrink-0',
              dots.showPrev ? 'text-white' : 'invisible'
            )}
            strokeWidth={2.5}
            aria-hidden
          />
        ) : null}
        {visible.map((item, offset) => {
          const itemIndex = dots.start + offset;
          const active = itemIndex === safeIndex;
          return (
            <span
              key={`dot-${item.url}-${itemIndex}`}
              className={cn(
                'size-1.5 rounded-full transition-colors duration-200',
                active ? 'bg-white' : 'bg-white/40'
              )}
            />
          );
        })}
        {hasOverflow ? (
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0',
              dots.showNext ? 'text-white' : 'invisible'
            )}
            strokeWidth={2.5}
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}

export function ProductGallery({
  items,
  productName,
  activeVariant,
}: ProductGalleryProps) {
  const safeItems = useMemo(() => sanitizeGalleryItems(items), [items]);
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const label = productName?.trim() || 'Product';

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: 'start',
    duration: 18,
    skipSnaps: false,
    dragFree: false,
  });

  const goTo = useCallback(
    (next: number) => {
      if (!emblaApi || safeItems.length === 0) return;
      emblaApi.scrollTo(clampIndex(next, safeItems.length));
    },
    [emblaApi, safeItems.length]
  );

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      setIndex(clampIndex(emblaApi.selectedScrollSnap(), safeItems.length));
    };
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, safeItems.length]);

  useEffect(() => {
    if (safeItems.length === 0) {
      setIndex(0);
      return;
    }
    setIndex((current) => clampIndex(current, safeItems.length));
  }, [safeItems.length]);

  useEffect(() => {
    const next = indexForVariant(safeItems, activeVariant);
    if (next < 0) return;
    goTo(next);
  }, [activeVariant, goTo, safeItems]);

  const active = safeItems[index] ?? safeItems[0];

  const onMainClick = () => {
    if (isDesktopViewport()) return;
    if (!active || active.type === 'video') return;
    setLightboxOpen(true);
  };

  if (safeItems.length === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center bg-neutral-100 text-sm text-muted-foreground">
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
          productName={label}
          onSelect={goTo}
        />
      ) : null}

      <div className="relative min-w-0 flex-1">
        <div
          ref={emblaRef}
          className="overflow-hidden bg-neutral-100"
          aria-roledescription="carousel"
          aria-label={`${label} gallery`}
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
                    className="relative aspect-square w-full cursor-zoom-in overflow-hidden md:cursor-default"
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
                        ? `Open ${item.alt || label}`
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
            <GalleryDots items={safeItems} index={index} />
          </>
        ) : null}
      </div>

      <MobileLightbox
        open={lightboxOpen}
        items={safeItems}
        startIndex={index}
        productName={label}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}
