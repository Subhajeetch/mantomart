'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import useEmblaCarousel from 'embla-carousel-react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { PublicGalleryItem } from '../types';
import { ProductMedia } from './product-media';

type MobileLightboxProps = {
  open: boolean;
  items: PublicGalleryItem[];
  startIndex: number;
  productName: string;
  onClose: () => void;
};

type Pointer = { id: number; x: number; y: number };

function distance(a: Pointer, b: Pointer): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function clampIndex(value: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.trunc(value)), total - 1);
}

function sanitizeItems(items: PublicGalleryItem[]): PublicGalleryItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is PublicGalleryItem =>
      Boolean(item) &&
      (item.type === 'image' || item.type === 'video') &&
      typeof item.url === 'string' &&
      item.url.trim().length > 0
  );
}

export function MobileLightbox({
  open,
  items,
  startIndex,
  productName,
  onClose,
}: MobileLightboxProps) {
  const safeItems = useMemo(() => sanitizeItems(items), [items]);
  const clampedStart = clampIndex(startIndex, safeItems.length);
  const label = productName?.trim() || 'Product';

  const [index, setIndex] = useState(clampedStart);
  const [mounted, setMounted] = useState(false);
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const pointers = useRef<Pointer[]>([]);
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: 'center',
    duration: 18,
    watchDrag: () => scaleRef.current <= 1.05,
    startIndex: clampedStart,
  });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('product-lightbox', { detail: open })
    );
    return () => {
      window.dispatchEvent(new CustomEvent('product-lightbox', { detail: false }));
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    scaleRef.current = 1;
    setScale(1);
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
    setIndex(clampedStart);
    emblaApi?.scrollTo(clampedStart, true);
  }, [open, clampedStart, emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      setIndex(clampIndex(emblaApi.selectedScrollSnap(), safeItems.length));
      scaleRef.current = 1;
      setScale(1);
      panRef.current = { x: 0, y: 0 };
      setPan({ x: 0, y: 0 });
    };
    emblaApi.on('select', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
    };
  }, [emblaApi, safeItems.length]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') emblaApi?.scrollNext();
      if (event.key === 'ArrowLeft') emblaApi?.scrollPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, emblaApi]);

  const resetZoom = () => {
    scaleRef.current = 1;
    setScale(1);
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
  };

  const applyScale = (next: number) => {
    const clamped = Math.min(4, Math.max(1, next));
    scaleRef.current = clamped;
    setScale(clamped);
    if (clamped <= 1.02) {
      panRef.current = { x: 0, y: 0 };
      setPan({ x: 0, y: 0 });
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.push({
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.length === 2) {
      pinchStart.current = {
        dist: distance(pointers.current[0]!, pointers.current[1]!),
        scale: scaleRef.current,
      };
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const list = pointers.current;
    const found = list.find((p) => p.id === event.pointerId);
    if (!found) return;
    const prev = { ...found };
    found.x = event.clientX;
    found.y = event.clientY;

    if (list.length === 2 && pinchStart.current) {
      const dist = distance(list[0]!, list[1]!);
      if (pinchStart.current.dist > 0) {
        applyScale(
          pinchStart.current.scale * (dist / pinchStart.current.dist)
        );
      }
      return;
    }

    if (list.length === 1 && scaleRef.current > 1.05) {
      const dx = found.x - prev.x;
      const dy = found.y - prev.y;
      panRef.current = {
        x: panRef.current.x + dx,
        y: panRef.current.y + dy,
      };
      setPan({ ...panRef.current });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current = pointers.current.filter((p) => p.id !== event.pointerId);
    if (pointers.current.length < 2) pinchStart.current = null;
    if (scaleRef.current < 1.08) resetZoom();
  };

  const onTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.changedTouches.length !== 1 || pointers.current.length > 0) return;
    const now = Date.now();
    if (now - lastTap.current < 280) {
      if (scaleRef.current > 1.1) resetZoom();
      else applyScale(2.4);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
  };

  const goTo = useCallback(
    (next: number) => {
      if (!emblaApi || safeItems.length === 0) return;
      emblaApi.scrollTo(clampIndex(next, safeItems.length));
    },
    [emblaApi, safeItems.length]
  );

  if (!mounted || !open || safeItems.length === 0) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} images`}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 z-20 flex size-10 items-center justify-center bg-black/55 text-white"
        aria-label="Close gallery"
      >
        <X className="size-5" />
      </button>

      <div className="relative flex min-h-0 flex-1 items-center">
        <div ref={emblaRef} className="h-full w-full overflow-hidden">
          <div className="flex h-full">
            {safeItems.map((item, itemIndex) => {
              const active = itemIndex === index;
              return (
                <div
                  key={`${item.type}-${item.url}-${itemIndex}`}
                  className="flex min-w-0 shrink-0 grow-0 basis-full items-center justify-center px-2"
                  onPointerDown={active ? onPointerDown : undefined}
                  onPointerMove={active ? onPointerMove : undefined}
                  onPointerUp={active ? onPointerUp : undefined}
                  onPointerCancel={active ? onPointerUp : undefined}
                  onTouchEnd={active ? onTouchEnd : undefined}
                >
                  <div
                    className="aspect-square w-full max-w-[min(100%,78svh)] overflow-hidden bg-neutral-950"
                    style={
                      active && item.type === 'image'
                        ? {
                            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
                            transition:
                              scale === 1
                                ? 'transform 120ms ease'
                                : 'none',
                            touchAction: scale > 1.05 ? 'none' : 'pan-y',
                          }
                        : undefined
                    }
                  >
                    <ProductMedia
                      item={item}
                      className="size-full object-contain"
                      contain
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {safeItems.length > 1 ? (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {safeItems.map((item, itemIndex) => {
            const thumb =
              item.type === 'image' ? item.url : item.poster || item.url;
            const active = itemIndex === index;
            return (
              <button
                key={`thumb-${item.url}-${itemIndex}`}
                type="button"
                onClick={() => goTo(itemIndex)}
                aria-label={`View ${itemIndex + 1}`}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'relative size-14 shrink-0 overflow-hidden bg-neutral-800 ring-1 ring-white/20',
                  active && 'ring-2 ring-white'
                )}
              >
                {item.type === 'video' && !item.poster ? (
                  <span className="flex size-full items-center justify-center text-[10px] font-medium uppercase">
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
      ) : null}
    </div>,
    document.body
  );
}
