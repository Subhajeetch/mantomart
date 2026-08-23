"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { formatPriceCents, percentOff } from "../format";
import type {
  PromoSlideLayout,
  PublicPromoSlide,
  PublicPromoSlideOffer,
  PublicPromoSlideProduct,
} from "../types";
import { slideThemeStyle } from "./themes";

export function PromoHref({
  href,
  className,
  children,
  ariaLabel,
}: {
  href?: string;
  className?: string;
  children?: ReactNode;
  ariaLabel?: string;
}) {
  if (!href) {
    return <div className={className}>{children}</div>;
  }
  const external = /^https?:\/\//i.test(href);
  const linkClass = cn(
    "pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-[var(--slide-fg)]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
    className
  );
  if (external) {
    return (
      <a
        href={href}
        className={linkClass}
        rel="noopener noreferrer"
        aria-label={ariaLabel}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={linkClass} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}

export function SlideShell({
  slide,
  children,
  className,
}: {
  slide: PublicPromoSlide;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative h-full min-h-[16.5rem] overflow-hidden sm:min-h-[18.5rem] lg:min-h-[20rem]",
        className
      )}
      style={slideThemeStyle(slide.theme)}
    >
      <SlidePattern layout={slide.layout} />
      {slide.slideHref ? (
        <PromoHref
          href={slide.slideHref}
          className="absolute inset-0 z-0"
          ariaLabel={slide.title || "Promotion"}
        />
      ) : null}
      <div className="relative z-10 h-full pointer-events-none">{children}</div>
    </div>
  );
}

export function SlidePattern({ layout }: { layout: PromoSlideLayout }) {
  if (layout === "legacy") return null;

if (layout === "split_products") {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0, transparent 33px, var(--slide-pattern) 33px, var(--slide-pattern) 66px)",
        }}
      />
    </div>
  );
}

  if (layout === "welcome_deal") {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <span className="absolute -top-8 -left-6 size-28 rounded-full bg-[var(--slide-pattern)]" />
        <span className="absolute top-6 left-10 size-3 rotate-45 bg-[var(--slide-fg)]/30" />
        <span className="absolute bottom-8 left-8 size-16 rounded-full border-4 border-[var(--slide-pattern)]" />
        <span className="absolute -right-10 -top-10 size-40 rounded-full bg-[var(--slide-pattern)]" />
        <span className="absolute right-16 bottom-6 size-4 rotate-12 bg-[var(--slide-fg)]/25" />
        <span className="absolute right-8 top-1/3 h-10 w-10 rounded-full border-2 border-[var(--slide-pattern)]" />
      </div>
    );
  }

  if (layout === "flash_row") {
    return (
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--slide-pattern) 1px, transparent 0)",
          backgroundSize: "18px 18px",
        }}
      />
    );
  }

  if (layout === "stack_showcase") {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <span className="absolute -left-10 top-8 size-40 rounded-full bg-[var(--slide-pattern)]" />
        <span className="absolute right-10 -bottom-12 size-52 rounded-full bg-[var(--slide-pattern)]" />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(var(--slide-pattern) 1px, transparent 1px), linear-gradient(90deg, var(--slide-pattern) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden
      style={{
        backgroundImage:
          "radial-gradient(circle at 20% 20%, var(--slide-pattern) 0 18%, transparent 19%), radial-gradient(circle at 80% 80%, var(--slide-pattern) 0 14%, transparent 15%)",
      }}
    />
  );
}

export function SlideCountdown({
  endsAt,
  className,
  variant = "text",
}: {
  endsAt?: string;
  className?: string;
  variant?: "text" | "badge";
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  if (!endsAt) return null;
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end)) return null;
  const diff = end - now;
  const badge =
    variant === "badge"
      ? "inline-flex w-fit bg-[var(--slide-accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--slide-cta-fg)] sm:text-xs"
      : undefined;
  if (diff <= 0) {
    return <span className={cn(badge, className)}>Sale ended</span>;
  }

  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const label =
    days > 0
      ? `Ends in ${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `Ends in ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return (
    <time
      className={cn(badge, className)}
      dateTime={new Date(end).toISOString()}
      suppressHydrationWarning
    >
      {label}
    </time>
  );
}

export function SlideTitle({
  slide,
  className,
  chevron = false,
}: {
  slide: PublicPromoSlide;
  className?: string;
  chevron?: boolean;
}) {
  if (!slide.title) return null;
  const inner = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 text-balance wrap-break-word",
        className
      )}
    >
      <span className="min-w-0">{slide.title}</span>
      {chevron ? (
        <ChevronRight
          className="size-5 shrink-0 sm:size-6 lg:size-7 xl:size-11 mt-1"
          aria-hidden
        />
      ) : null}
    </span>
  );
  if (!slide.titleHref) return inner;
  return (
    <PromoHref href={slide.titleHref} className="inline-flex max-w-full">
      {inner}
    </PromoHref>
  );
}

export function SlideCta({
  slide,
  className,
}: {
  slide: PublicPromoSlide;
  className?: string;
}) {
  if (!slide.ctaLabel) return null;
  const href = slide.ctaHref || slide.titleHref || slide.slideHref;
  return (
    <PromoHref
      href={href}
      className={cn(
        "inline-flex w-fit shrink-0 items-center justify-center bg-[var(--slide-accent)] px-4 py-2 text-sm lg:text-[18px] lg:text-xl font-semibold text-[var(--slide-cta-fg)] shadow-sm transition-opacity hover:opacity-90",
        !href && "pointer-events-none",
        className
      )}
    >
      {slide.ctaLabel}
    </PromoHref>
  );
}

function discountText(product: PublicPromoSlideProduct): string | null {
  if (product.discountLabel) return product.discountLabel;
  const off = percentOff(product.price, product.compareAtPrice);
  return off > 0 ? `${off}% off` : null;
}

export function ProductTile({
  product,
  variant = "card",
  priority = false,
  className,
}: {
  product: PublicPromoSlideProduct;
  variant?: "card" | "compact" | "featured" | "polaroid" | "hero";
  priority?: boolean;
  className?: string;
}) {
  const price = formatPriceCents(product.price);
  const was = product.onSale ? formatPriceCents(product.compareAtPrice) : "";
  const off = discountText(product);

  if (variant === "featured") {
    return (
      <PromoHref
        href={product.href}
        className={cn(
          "flex min-w-0 items-stretch overflow-hidden bg-background text-foreground shadow-sm ring-1 ring-foreground/10 transition-transform hover:-translate-y-0.5",
          className
        )}
        ariaLabel={product.name}
      >
        <div className="relative w-24 shrink-0 bg-muted sm:w-28">
          <ProductImage product={product} priority={priority} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-3 py-2">
          <p className="line-clamp-2 text-xs font-medium text-muted-foreground">
            {product.name}
          </p>
          {price ? (
            <p className="w-fit bg-foreground px-1.5 py-0.5 text-sm font-semibold text-background tabular-nums">
              {price}
            </p>
          ) : null}
        </div>
      </PromoHref>
    );
  }

  if (variant === "polaroid") {
    return (
      <PromoHref
        href={product.href}
        className={cn(
          "relative block bg-background p-1.5 text-foreground shadow-md ring-1 ring-foreground/10 transition-transform hover:-translate-y-0.5",
          className
        )}
        ariaLabel={product.name}
      >
        <div className="relative aspect-square overflow-hidden bg-muted">
          <ProductImage product={product} priority={priority} />
          {price ? (
            <span className="absolute top-1.5 left-1.5 bg-background/95 px-1.5 py-0.5 text-xs font-semibold tabular-nums">
              {price}
            </span>
          ) : null}
        </div>
        {(() => {
          const pct = percentOff(product.price, product.compareAtPrice);
          if (pct <= 0) return null;
          return (
            <span className="absolute -top-3.5 -right-3.5 flex size-16 items-center justify-center rounded-full bg-primary text-[20px] font-bold text-primary-foreground shadow-sm sm:-top-6 sm:-right-6 sm:size-18 sm:text-[20px] outline-6 outline-white">
              -{pct}%
            </span>
          );
        })()}
      </PromoHref>
    );
  }

  if (variant === "hero") {
    return (
      <PromoHref
        href={product.href}
        className={cn(
          "relative block overflow-hidden bg-background text-foreground shadow-md ring-1 ring-foreground/10 transition-transform hover:-translate-y-0.5",
          className
        )}
        ariaLabel={product.name}
      >
        <div className="relative aspect-square bg-muted sm:aspect-[4/5]">
          <ProductImage product={product} priority={priority} />
        </div>
        {off ? (
          <span className="absolute top-2 left-2 bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
            {off}
          </span>
        ) : null}
      </PromoHref>
    );
  }

  return (
    <PromoHref
      href={product.href}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden bg-background text-foreground shadow-sm ring-1 ring-foreground/10 transition-transform hover:-translate-y-0.5",
        className
      )}
      ariaLabel={product.name}
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        <ProductImage product={product} priority={priority} />
      </div>
      <div className="flex flex-col gap-0.5 px-2 py-1.5">
        <p className="flex flex-wrap items-baseline gap-1">
          {price ? (
            <span className="text-sm font-semibold text-primary tabular-nums">
              {price}
            </span>
          ) : null}
          {was ? (
            <span className="text-[11px] text-muted-foreground line-through tabular-nums">
              {was}
            </span>
          ) : null}
        </p>
        {off ? (
          <p className="text-[11px] font-medium text-primary">{off}</p>
        ) : null}
      </div>
    </PromoHref>
  );
}

function ProductImage({
  product,
  priority,
}: {
  product: PublicPromoSlideProduct;
  priority?: boolean;
}) {
  if (!product.imageUrl) {
    return (
      <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
        No image
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- product URLs from R2 / CDN
    <img
      src={`${product.imageUrl}_480x480q75.jpg_.avif`}
      alt={product.imageAlt || product.name}
      className="size-full object-cover"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "low"}
    />
  );
}

export function OfferTile({
  offer,
  className,
}: {
  offer: PublicPromoSlideOffer;
  className?: string;
}) {
  const inner = (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col items-center justify-center px-1.5 py-2 text-center sm:px-2",
        className
      )}
    >
      <p className="line-clamp-2 text-xs font-bold text-primary sm:text-sm md:text-[24px]">
        {offer.title}
      </p>
      {offer.subtitle ? (
        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground sm:text-[14px]">
          {offer.subtitle}
        </p>
      ) : null}
      {offer.code ? (
        <p className="mt-1 max-w-full truncate text-[10px] md:text-[14px] lg:text-[16px] xl:text-[18px] font-bold tracking-wide text-foreground uppercase">
          Code: {offer.code}
        </p>
      ) : null}
    </div>
  );
  if (!offer.href) return inner;
  return (
    <PromoHref href={offer.href} className="min-w-0 flex-1">
      {inner}
    </PromoHref>
  );
}

export function GraphicPoster({
  title,
  subtitle,
}: {
  title?: string;
  subtitle?: string;
}) {
  if (!title && !subtitle) return null;
  return (
    <div className="relative mx-auto flex h-full min-h-36 w-full max-w-[240px] items-center justify-center sm:max-w-none">
      <div className="absolute inset-y-4 right-6 left-10 rotate-6 bg-yellow-400/60" />
      <div className="absolute inset-y-6 right-4 left-8 -rotate-3 bg-green-400/40" />
      <div className="relative flex aspect-[4/3] w-full max-w-[220px] rotate-2 flex-col items-center justify-center bg-[color-mix(in_oklch,var(--slide-fg)_12%,var(--slide-bg))] p-4 text-center shadow-md ring-1 ring-foreground/10">
        {subtitle ? (
          <p className="mb-1 text-[10px] font-semibold tracking-[0.2em] text-[var(--slide-fg)]/80 uppercase">
            {subtitle}
          </p>
        ) : null}
        <p className="text-2xl leading-none font-black tracking-tight text-[var(--slide-fg)] uppercase sm:text-3xl">
          {title}
        </p>
        <span className="absolute -top-2 right-6 size-4 rounded-full bg-primary shadow-sm" />
      </div>
    </div>
  );
}
