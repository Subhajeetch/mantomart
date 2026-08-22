import { cn } from "@/lib/utils";
import "./custom.css";

import type { PublicPromoSlide, PublicPromoSlideProduct } from "../types";
import {
  GraphicPoster,
  OfferTile,
  ProductTile,
  SlideCountdown,
  SlideCta,
  SlideShell,
  SlideTitle,
} from "./primitives";

const SLIDE_PAD =
  "mx-auto h-full w-full max-w-450 px-4 py-5 pb-10 sm:px-8 sm:py-6 sm:pb-11";

function take(products: PublicPromoSlideProduct[], count: number) {
  return products.slice(0, count);
}

function CopyBlock({
  slide,
  align = "left",
  chevron = false,
  showCta = true,
  compact = false,
}: {
  slide: PublicPromoSlide;
  align?: "left" | "center";
  chevron?: boolean;
  showCta?: boolean;
  compact?: boolean;
}) {
  const center = align === "center";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5",
        center ? "items-center text-center" : "items-start text-left"
      )}
    >
      {slide.kicker ? (
        <p className="text-[12px] font-medium tracking-wide text-[var(--slide-muted)] sm:text-xs lg:text-xl">
          {slide.kicker}
        </p>
      ) : null}
      <SlideCountdown
        endsAt={slide.endsAt}
        variant={center ? "badge" : "text"}
        className={
          center
            ? undefined
            : "text-[12px] font-medium text-[var(--slide-muted)] sm:text-xs lg:text-[18px]"
        }
      />
      <SlideTitle
        slide={slide}
        chevron={chevron}
        className="text-[24px] leading-tight font-semibold tracking-tight sm:text-3xl lg:text-5xl xl:text-7xl"
      />
      {slide.subtitle ? (
        <p
          className={cn(
            "max-w-md text-sm text-(--slide-muted) sm:text-base lg:text-[18px]",
            compact && "hidden sm:block"
          )}
        >
          {slide.subtitle}
        </p>
      ) : null}
      {showCta ? <SlideCta slide={slide} className="mt-1.5" /> : null}
    </div>
  );
}

export function DealsBannerSlide({
  slide,
  priority,
}: {
  slide: PublicPromoSlide;
  priority?: boolean;
}) {
  const product = slide.products[0];
  const offers = slide.offers.slice(0, 3);
  const hasGraphic = Boolean(slide.graphicTitle || slide.graphicSubtitle);

  return (
    <SlideShell slide={slide}>
      <div
        className={cn(
          SLIDE_PAD,
          "flex flex-col justify-center gap-3 lg:flex-row lg:items-center lg:gap-6"
        )}
      >
        <div className="min-w-0 flex-1">
          <CopyBlock slide={slide} chevron />
          {offers.length > 0 || product ? (
            <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row sm:items-stretch sm:gap-3">
              {offers.length > 0 ? (
                <div className="flex min-w-0 flex-1 overflow-hidden bg-background text-foreground ring-1 ring-foreground/10">
                  {offers.map((offer, i) => (
                    <div
                      key={offer.id}
                      className={cn(
                        "min-w-0 flex-1",
                        i > 0 && "border-l border-dashed border-primary/30"
                      )}
                    >
                      <OfferTile offer={offer} className="h-full py-2.5 sm:py-3" />
                    </div>
                  ))}
                </div>
              ) : null}
              {product ? (
                <ProductTile
                  product={product}
                  variant="featured"
                  priority={priority}
                  className="sm:w-56 sm:shrink-0 lg:w-64"
                />
              ) : null}
            </div>
          ) : null}
        </div>
        {hasGraphic ? (
          <div className="hidden w-56 shrink-0 lg:block xl:min-w-116">
            <GraphicPoster
              title={slide.graphicTitle}
              subtitle={slide.graphicSubtitle}
            />
          </div>
        ) : null}
      </div>
    </SlideShell>
  );
}

export function WelcomeDealSlide({
  slide,
  priority,
}: {
  slide: PublicPromoSlide;
  priority?: boolean;
}) {
  const [hero, ...rest] = take(slide.products, 3);
  const side = rest.slice(0, 2);

  return (
    <SlideShell slide={slide}>
      <div
        className={cn(
          SLIDE_PAD,
          "grid grid-cols-1 items-center gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-16 xl:gap-28"
        )}
      >
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <CopyBlock slide={slide} align="center" />
        </div>
        {hero || side.length > 0 ? (
          <div className="flex items-center justify-center gap-2 sm:gap-3 lg:contents">
            {hero ? (
              <div className="flex justify-center items-center lg:col-start-1 lg:row-start-1">
                <ProductTile
                  product={hero}
                  variant="polaroid"
                  priority={priority}
                  className="w-[11rem] -rotate-6 md:w-50 lg:w-60 xl:w-76 xl:mt-6"
                />
              </div>
            ) : null}
            {side.length > 0 ? (
              <div className="flex items-center justify-center gap-2 sm:gap-3 lg:col-start-3 lg:row-start-1 lg:justify-start">
                {side.map((product, i) => (
                  <ProductTile
                    key={product.id}
                    product={product}
                    variant="polaroid"
                    className={cn(
                      "w-[9rem] md:w-42 lg:w-45 xl:w-60",
                      i === 0 ? "rotate-6" : "-rotate-3",
                      i > 0 && "hidden sm:block"
                    )}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </SlideShell>
  );
}

export function SplitProductsSlide({
  slide,
  priority,
}: {
  slide: PublicPromoSlide;
  priority?: boolean;
}) {
  const products = take(slide.products, 4);
  const mid = Math.ceil(products.length / 2);
  const left = products.slice(0, mid);
  const right = products.slice(mid);
  const mobileProducts = products.slice(0, 2);

  return (
    <SlideShell slide={slide}>
      <div
        className={cn(
          SLIDE_PAD,
          "flex flex-col items-center justify-center gap-3 sm:gap-4 lg:flex-row lg:gap-6"
        )}
      >
        <div className="hidden min-w-0 flex-1 justify-end gap-2 lg:flex xl:gap-3">
          {left.map((product, i) => (
            <ProductTile
              key={product.id}
              product={product}
              variant="card"
              priority={priority && i === 0}
              className="w-28 shrink-0 xl:w-50"
            />
          ))}
        </div>
        <div className="w-full min-w-0 shrink-0 lg:max-w-sm">
          <CopyBlock slide={slide} align="center" compact />
        </div>
        {mobileProducts.length > 0 ? (
          <div className="flex w-full justify-center gap-2 sm:hidden">
            {mobileProducts.map((product, i) => (
              <ProductTile
                key={product.id}
                product={product}
                variant="card"
                priority={priority && i === 0}
                className="w-[10rem] shrink-0"
              />
            ))}
          </div>
        ) : null}
        {products.length > 0 ? (
          <div className="hidden w-full justify-center gap-2 sm:flex lg:hidden">
            {products.map((product, i) => (
              <ProductTile
                key={product.id}
                product={product}
                variant="card"
                priority={priority && i === 0}
                className="w-[7.25rem] shrink-0 md:w-32"
              />
            ))}
          </div>
        ) : null}
        <div className="hidden min-w-0 flex-1 justify-start gap-2 lg:flex xl:gap-3">
          {right.map((product) => (
            <ProductTile
              key={product.id}
              product={product}
              variant="card"
              className="w-28 shrink-0 xl:w-50"
            />
          ))}
        </div>
      </div>
    </SlideShell>
  );
}

export function FlashRowSlide({
  slide,
  priority,
}: {
  slide: PublicPromoSlide;
  priority?: boolean;
}) {
  const products = take(slide.products, 4);

  return (
    <SlideShell slide={slide}>
      <div
        className={cn(
          SLIDE_PAD,
          "flex flex-col-reverse md:flex-col gap-4 lg:flex-row lg:items-center lg:gap-10 justify-between"
        )}
      >
        <div className="min-w-0 lg:w-72 lg:shrink-0 xl:w-100">
          <CopyBlock slide={slide} align="center" />
        </div>
        {products.length > 0 ? (
          <div
            className={cn(
              "grid w-full gap-2 lg:flex lg:flex-1 lg:gap-8",
              products.length >= 4
                ? "grid-cols-2 sm:grid-cols-4 justify-end"
                : "grid-cols-2 "
            )}
          >
            {products.map((product, i) => (
              <ProductTile
                key={product.id}
                product={product}
                variant="card"
                priority={priority && i === 0}
                className={cn("justify-self-center lg:w-46 lg:max-w-none lg:flex-none xl:w-60",
                          i >= 2 && "hidden flash-row-slide-product-card",)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </SlideShell>
  );
}

export function StackShowcaseSlide({
  slide,
  priority,
}: {
  slide: PublicPromoSlide;
  priority?: boolean;
}) {
  const products = take(slide.products, 3);

  return (
    <SlideShell slide={slide}>
      <div
        className={cn(
          SLIDE_PAD,
          "flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-8 lg:gap-12"
        )}
      >
        {products.length > 0 ? (
          <div className="relative h-[13.5rem] w-[min(100%,19rem)] shrink-0 sm:h-[16rem] sm:w-[22rem] md:h-[17.5rem] md:w-[25rem] lg:h-[19rem] lg:w-[29rem] xl:h-[20.5rem] xl:w-[32rem] lg:mr-14 xl:mr-30">
            {products.length === 1 && products[0] ? (
              <ProductTile
                product={products[0]}
                variant="polaroid"
                priority={priority}
                className="absolute top-1/2 left-1/2 w-[55%] -translate-x-1/2 -translate-y-1/2"
              />
            ) : (
              <>
                {products[0] ? (
  <ProductTile
    product={products[0]}
    variant="polaroid"
    priority={priority}
    className="absolute top-[18%] left-0 z-20 w-[47%] -rotate-12 sm:-left-[3%] sm:w-[46%] md:-left-[6%] md:w-[48%] lg:-left-[9%] lg:w-[50%] xl:-left-[12%] xl:w-[52%]"
  />
                ) : null}
                {products[1] ? (
                  <ProductTile
                    product={products[1]}
                    variant="polaroid"
                    className="absolute top-0 left-1/2 z-30 w-[55%] -translate-x-1/2 rotate-2 sm:w-[54%] md:w-[56%] lg:w-[58%] xl:w-[60%]"
                  />
                ) : null}
                {products[2] ? (
                  <ProductTile
                    product={products[2]}
                    variant="polaroid"
                    className="absolute top-[18%] right-0 z-10 w-[47%] rotate-12 sm:-right-[3%] sm:w-[46%] md:-right-[6%] md:w-[48%] lg:-right-[9%] lg:w-[50%] xl:-right-[12%] xl:w-[52%]"
                  />
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <div className="min-w-0 w-full max-w-[400px] lg:ml-14 xl:ml-30">
          <CopyBlock slide={slide} align="center" />
        </div>
      </div>
    </SlideShell>
  );
}

export function LegacySlide({ slide }: { slide: PublicPromoSlide }) {
  if (!slide.imageUrl) return null;
  const href = slide.slideHref || slide.ctaHref || slide.titleHref;
  return (
    <div className="relative h-full min-h-[16.5rem] overflow-hidden bg-muted sm:min-h-[18.5rem] lg:min-h-[20rem]">
      <picture>
        {slide.mobileImageUrl ? (
          <source media="(max-width: 639px)" srcSet={slide.mobileImageUrl} />
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slide.imageUrl}
          alt={slide.title || "Promotion"}
          className="size-full object-cover"
        />
      </picture>
      {href ? (
        <a
          href={href}
          className="absolute inset-0 z-0"
          aria-label={slide.title || "Promotion"}
        />
      ) : null}
      {(slide.title ||
        slide.subtitle ||
        slide.ctaLabel ||
        slide.discountLabel) && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end bg-gradient-to-t from-black/60 via-black/10 to-transparent p-6 pb-10 sm:p-10 sm:pb-12">
          {slide.discountLabel ? (
            <p className="mb-2 w-fit bg-primary px-2 py-0.5 text-xs font-semibold tracking-wide text-primary-foreground uppercase">
              {slide.discountLabel}
            </p>
          ) : null}
          {slide.title ? (
            <p className="max-w-xl text-2xl font-semibold text-balance text-white sm:text-4xl">
              {slide.title}
            </p>
          ) : null}
          {slide.subtitle ? (
            <p className="mt-1 max-w-xl text-sm text-white/85 sm:text-base">
              {slide.subtitle}
            </p>
          ) : null}
          {slide.ctaLabel ? (
            <SlideCta
              slide={slide}
              className="pointer-events-auto mt-3 bg-white text-foreground hover:opacity-90 sm:mt-4"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

export function PromoSlideView({
  slide,
  priority,
}: {
  slide: PublicPromoSlide;
  priority?: boolean;
}) {
  switch (slide.layout) {
    case "deals_banner":
      return <DealsBannerSlide slide={slide} priority={priority} />;
    case "welcome_deal":
      return <WelcomeDealSlide slide={slide} priority={priority} />;
    case "split_products":
      return <SplitProductsSlide slide={slide} priority={priority} />;
    case "flash_row":
      return <FlashRowSlide slide={slide} priority={priority} />;
    case "stack_showcase":
      return <StackShowcaseSlide slide={slide} priority={priority} />;
    default:
      return <LegacySlide slide={slide} />;
  }
}
