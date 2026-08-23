"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import Link from "next/link";
import { Heart, Star, Tag } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  formatPriceCents,
  formatRating,
  formatReviewCount,
  formatSavingsAmount,
  percentOff,
} from "./format";
import type { PublicProductCard } from "./types";

type ProductCardProps = {
  product: PublicProductCard;
  className?: string;
};

const MAX_CARD_IMAGES = 7;

type CardImage = {
  url: string;
  alt: string;
};

function galleryImages(product: PublicProductCard): CardImage[] {
  const name = product.name.trim() || "Product";
  const out: CardImage[] = [];
  const seen = new Set<string>();
  const source = Array.isArray(product.images) ? product.images : [];

  for (const img of source) {
    if (!img || typeof img.url !== "string") continue;
    const url = img.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const alt =
      typeof img.alt === "string" && img.alt.trim() ? img.alt.trim() : name;
    out.push({ url, alt });
    if (out.length >= MAX_CARD_IMAGES) break;
  }

  if (out.length === 0) {
    const fallback = product.imageUrl?.trim();
    if (fallback) {
      out.push({
        url: fallback,
        alt: product.imageAlt?.trim() || name,
      });
    }
  }

  return out;
}

function productHref(product: PublicProductCard): string {
  const href = product.href?.trim();
  if (href && href.startsWith("/")) return href;
  const slug = product.slug?.trim().replace(/^\/+|\/+$/g, "");
  return slug ? `/product/${slug}` : "/";
}

function cardImageSrc(url: string): string {
  return `${url}_480x480q75.jpg_.avif`;
}

function imageIndexFromMouse(
  clientX: number,
  width: number,
  count: number
): number {
  if (count <= 1 || width <= 0) return 0;
  const x = Math.min(Math.max(clientX, 0), width - 0.001);
  return Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)));
}

export function ProductCard({ product, className }: ProductCardProps) {
  const images = galleryImages(product);
  const href = productHref(product);
  const canScrub = images.length > 1;

  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const hoveringRef = useRef(false);
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const imageCountRef = useRef(images.length);
  const previousImageIndexRef = useRef(0);
  const pendingXRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  // Local-only UI state — resets on remount/re-fetch; no wishlist backend yet.
  const [isWishlisted, setIsWishlisted] = useState(false);

  imageCountRef.current = images.length;

  const safeIndex =
    images.length === 0
      ? 0
      : Math.min(Math.max(activeImageIndex, 0), images.length - 1);
  const active = images[safeIndex];
  const previousIndex = previousImageIndexRef.current;

  const soldCount = product.aeSalesCount?.trim() || null;
  const savingsCents =
    product.price !== null &&
    product.compareAtPrice !== null &&
    product.compareAtPrice > product.price
      ? product.compareAtPrice - product.price
      : null;
  const savingsLabel =
    savingsCents !== null ? formatSavingsAmount(savingsCents) : "";

  const ratingLabel = formatRating(product.aeRating);
  const reviewCountLabel = formatReviewCount(product.aeReviewCount);
  const showRatingBadge = Boolean(ratingLabel);

  const off =
    product.onSale ||
    (product.price !== null &&
      product.compareAtPrice !== null &&
      product.compareAtPrice > product.price)
      ? percentOff(product.price, product.compareAtPrice)
      : 0;
  const priceLabel = formatPriceCents(product.price);
  const wasLabel = off > 0 ? formatPriceCents(product.compareAtPrice) : "";

  const cancelScrub = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingXRef.current = null;
  };

  const queueScrub = (clientX: number) => {
    if (!canScrub || !hoveringRef.current) return;
    pendingXRef.current = clientX;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const x = pendingXRef.current;
      const frame = imageFrameRef.current;
      pendingXRef.current = null;
      if (x == null || !frame || !hoveringRef.current) return;
      const rect = frame.getBoundingClientRect();
      const next = imageIndexFromMouse(
        x - rect.left,
        rect.width,
        imageCountRef.current
      );
      setActiveImageIndex((prev) => {
        if (prev === next) return prev;
        previousImageIndexRef.current = prev;
        return next;
      });
    });
  };

  useEffect(() => {
    return () => {
      hoveringRef.current = false;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingXRef.current = null;
    };
  }, []);

  const handlePointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    hoveringRef.current = true;
    setIsHovering(true);
  };

  const handlePointerLeave = () => {
    hoveringRef.current = false;
    cancelScrub();
    setIsHovering(false);
    previousImageIndexRef.current = 0;
    setActiveImageIndex(0);
  };

  const handleImagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    queueScrub(event.clientX);
  };

  const handleWishlistClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // TODO: wishlist feature not implemented yet — hook this up once backend is ready
    console.log("wishlist clicked for product:", product.name);
    setIsWishlisted((prev) => !prev);
  };

  const imageAlt = active?.alt || product.name;

  return (
    <article
      className={cn(
        "relative flex h-full min-w-0 flex-col bg-background transition-shadow duration-150",
        isHovering && "z-10 shadow-[0_4px_24px_rgba(0,0,0,0.16)]",
        className
      )}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <div
        ref={imageFrameRef}
        className="relative aspect-[3/4] overflow-hidden bg-neutral-100 select-none"
        onPointerEnter={canScrub ? handleImagePointerMove : undefined}
        onPointerMove={canScrub ? handleImagePointerMove : undefined}
      >
        <Link
          href={href}
          className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {images.length > 0 ? (
            images.map((image, index) => {
              const isActive = index === safeIndex;
              const isPrevious = index === previousIndex && !isActive;
              return (
                // eslint-disable-next-line @next/next/no-img-element -- R2 / arbitrary product URLs
                <img
                  key={`${image.url}-${index}`}
                  src={cardImageSrc(image.url)}
                  alt={isActive ? imageAlt : ""}
                  aria-hidden={!isActive}
                  width={600}
                  height={800}
                  loading={index === 0 || isHovering ? "eager" : "lazy"}
                  decoding="async"
                  draggable={false}
                  className={cn(
                    "absolute inset-0 size-full object-cover",
                    isActive
                      ? "z-[2]"
                      : isPrevious
                        ? "z-[1]"
                        : "z-0 opacity-0"
                  )}
                />
              );
            })
          ) : (
            <span
              className="flex size-full items-center justify-center text-xs text-muted-foreground"
              aria-hidden
            >
              No image
            </span>
          )}
        </Link>

        {showRatingBadge && !isHovering ? (
          <div
            className="pointer-events-none absolute bottom-2 left-2 z-10 flex items-center gap-1 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-neutral-800 ring-1 ring-neutral-800"
            aria-label={
              reviewCountLabel
                ? `Rated ${ratingLabel} from ${reviewCountLabel} reviews`
                : `Rated ${ratingLabel}`
            }
          >
            <span>{ratingLabel}</span>
            <Star
              className="size-3 fill-[#2d7ff9] text-[#2d7ff9]"
              aria-hidden
            />
            {reviewCountLabel ? (
              <>
                <span className="text-neutral-400" aria-hidden>
                  |
                </span>
                <span>{reviewCountLabel}</span>
              </>
            ) : null}
          </div>
        ) : null}

        {canScrub ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-center gap-1.5 pt-6 pb-2",
              isHovering
                ? "translate-y-0 opacity-100"
                : "translate-y-full opacity-0"
            )}
            aria-hidden
          >
            {images.map((image, index) => (
              <span
                key={`${image.url}-${index}`}
                className={cn(
                  "size-1.5",
                  index === safeIndex ? "bg-primary" : "bg-neutral-300"
                )}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-1.5 pt-2 pb-3 sm:px-2">
        {isHovering || soldCount || savingsLabel ? (
        <div className="flex min-h-8 items-center">
          {isHovering ? (
            <button
              type="button"
              onClick={handleWishlistClick}
              aria-pressed={isWishlisted}
              aria-label={
                isWishlisted
                  ? `Remove ${product.name} from wishlist`
                  : `Save ${product.name} to wishlist`
              }
              className="flex h-8 w-full items-center justify-center gap-1.5 border border-foreground/15 text-xs font-semibold tracking-[0.12em] text-foreground/88 uppercase transition hover:bg-muted hover:border-foreground/25"
            >
              <Heart
                className={cn(
                  "size-3.5",
                  isWishlisted
                    ? "fill-[#ff3f6c] text-[#ff3f6c]"
                    : "text-neutral-800"
                )}
              />
              {isWishlisted ? "Wishlisted" : "Wishlist"}
            </button>
          ) : soldCount ? (
            <p className="text-[12px] font-bold text-foreground/60">
              {soldCount} sold
            </p>
          ) : savingsLabel ? (
            <p className="flex items-center gap-1 text-sm font-bold text-destructive">
              <Tag className="size-3.5 shrink-0" aria-hidden />
              <span>Save {savingsLabel}</span>
            </p>
          ) : null}
        </div>
        ) : null}

        <Link
          href={href}
          className="mt-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h3
            className={cn(
              "line-clamp-2 text-sm leading-snug text-foreground/80",
            )}
          >
            {product.name}
          </h3>
        </Link>

        <p className="mt-1 flex flex-wrap items-baseline gap-1.5">
          {priceLabel ? (
            <span className="text-[15px] font-bold text-foreground/80 tabular-nums">
              {priceLabel}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">See price</span>
          )}
          {wasLabel ? (
            <span className="text-[13px] text-foreground/60 line-through tabular-nums">
              {wasLabel}
            </span>
          ) : null}
          {off > 0 ? (
            <span className="text-[13px] font-medium text-primary/70">
              ({off}% OFF)
            </span>
          ) : null}
        </p>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col bg-background">
      <div className="aspect-[3/4] animate-pulse bg-neutral-100" />
      <div className="flex flex-col gap-2 px-2 py-2">
        <div className="h-4 w-1/3 animate-pulse bg-muted" />
        <div className="h-3 w-4/5 animate-pulse bg-muted" />
        <div className="h-3 w-1/2 animate-pulse bg-muted" />
      </div>
    </div>
  );
}
