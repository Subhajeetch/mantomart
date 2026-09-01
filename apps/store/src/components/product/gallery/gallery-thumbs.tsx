'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import type { PublicGalleryItem } from '../types';

type GalleryThumbsProps = {
  items: PublicGalleryItem[];
  index: number;
  productName: string;
  onSelect: (index: number) => void;
};

function updateEdgeState(el: HTMLDivElement) {
  const top = el.scrollTop > 2;
  const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
  return { top, bottom };
}

export function GalleryThumbs({
  items,
  index,
  productName,
  onSelect,
}: GalleryThumbsProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);

  const syncFades = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const next = updateEdgeState(el);
    setFadeTop(next.top);
    setFadeBottom(next.bottom);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    syncFades();
    const onScroll = () => syncFades();
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(syncFades);
    observer.observe(el);
    const images = el.querySelectorAll('img');
    const onLoad = () => syncFades();
    images.forEach((img) => {
      if (!img.complete) img.addEventListener('load', onLoad);
    });
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
      images.forEach((img) => img.removeEventListener('load', onLoad));
    };
  }, [items.length, syncFades]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const thumb = scroller.querySelector<HTMLElement>(
      `[data-thumb-index="${index}"]`
    );
    if (!thumb) return;

    const thumbTop = thumb.offsetTop;
    const thumbBottom = thumbTop + thumb.offsetHeight;
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight;
    const pad = 8;

    if (thumbTop < viewTop + pad) {
      scroller.scrollTo({ top: Math.max(0, thumbTop - pad), behavior: 'smooth' });
    } else if (thumbBottom > viewBottom - pad) {
      scroller.scrollTo({
        top: thumbBottom - scroller.clientHeight + pad,
        behavior: 'smooth',
      });
    }
  }, [index]);

  return (
    <div className="relative hidden w-16 shrink-0 md:block lg:w-20">
      <div
        ref={scrollerRef}
        className="absolute inset-0 flex flex-col gap-2 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={`${productName} thumbnails`}
      >
        {items.map((item, itemIndex) => {
          const selected = itemIndex === index;
          const thumb =
            item.type === 'image' ? item.url : item.poster || item.url;
          return (
            <button
              key={`thumb-${item.url}-${itemIndex}`}
              type="button"
              data-thumb-index={itemIndex}
              onClick={() => onSelect(itemIndex)}
              aria-label={
                item.type === 'video'
                  ? `Play ${productName} video`
                  : `View image ${itemIndex + 1}`
              }
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'relative aspect-square w-full shrink-0 overflow-hidden bg-neutral-100 ring-1 ring-transparent',
                selected
                  ? 'ring-2 ring-foreground'
                  : 'hover:ring-foreground/30'
              )}
            >
              {item.type === 'video' && !item.poster ? (
                <span className="flex size-full items-center justify-center text-[10px] font-medium uppercase text-muted-foreground">
                  Video
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- R2 / arbitrary product URLs
                <img
                  src={thumb}
                  alt=""
                  className="size-full object-cover"
                  draggable={false}
                />
              )}
            </button>
          );
        })}
      </div>
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background to-transparent transition-opacity duration-200',
          fadeTop ? 'opacity-100' : 'opacity-0'
        )}
        aria-hidden
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-background to-transparent transition-opacity duration-200',
          fadeBottom ? 'opacity-100' : 'opacity-0'
        )}
        aria-hidden
      />
    </div>
  );
}
