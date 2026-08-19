"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Session } from "@repo/types/session-client";

import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PublicPromoSlide, PublicPromoSliderBlock } from "./types";

type PromoSliderProps = {
  block: PublicPromoSliderBlock;
};

function isNewUser(user: Session["user"] | null | undefined): boolean {
  if (!user) return false;
  const total = user.totalOrders;
  return typeof total === "number" && total === 0;
}

function visibleSlides(
  slides: PublicPromoSlide[],
  newUser: boolean
): PublicPromoSlide[] {
  return slides.filter((slide) => {
    if (!slide.imageUrl) return false;
    if (slide.audience === "new_user") return newUser;
    return true;
  });
}

export function PromoSlider({ block }: PromoSliderProps) {
  const { data, isPending } = useSession();
  const session = data as Session | null;
  const newUser = isNewUser(session?.user);

  const allSlides = Array.isArray(block.config.slides)
    ? block.config.slides.filter((slide) => slide.imageUrl)
    : [];

  // While session is unknown, treat as NOT a new user (hide new_user slides).
  const slides = useMemo(
    () => visibleSlides(allSlides, isPending ? false : newUser),
    [allSlides, isPending, newUser]
  );

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [index, slides.length]);

  if (allSlides.length === 0) return null;

  const safeIndex =
    slides.length === 0 ? 0 : Math.max(0, Math.min(index, slides.length - 1));
  const current = slides[safeIndex] ?? allSlides[0];
  if (!current) return null;

  const canPrev = slides.length > 1;
  const go = (dir: -1 | 1) => {
    if (slides.length <= 1) return;
    setIndex((prev) => (prev + dir + slides.length) % slides.length);
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Promotions"
      className="relative overflow-hidden bg-muted"
    >
      {/*
        No-JS fallback: first slide is in the HTML and visible. Client
        hydration then filters audience:'new_user' slides.
      */}
      <div className="relative aspect-[16/7] min-h-48 w-full sm:aspect-[16/6]">
        {allSlides.map((slide, i) => {
          const hiddenByAudience =
            slide.audience === "new_user" && !newUser && !isPending;
          const isActive = slide.id === current.id;
          const show = isActive && !hiddenByAudience;
          // First slide stays in the layout for no-JS; others are inert.
          const isFirst = i === 0;
          return (
            <div
              key={slide.id}
              className={cn(
                "absolute inset-0",
                show || (isFirst && slides.length === 0)
                  ? "relative z-10"
                  : "pointer-events-none invisible"
              )}
              aria-hidden={!show}
            >
              <picture>
                {slide.mobileImageUrl ? (
                  <source
                    media="(max-width: 639px)"
                    srcSet={slide.mobileImageUrl}
                  />
                ) : null}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.imageUrl}
                  alt={slide.title || "Promotion"}
                  className="size-full object-cover"
                  fetchPriority={i === 0 ? "high" : "low"}
                />
              </picture>
              {(slide.title ||
                slide.subtitle ||
                slide.ctaLabel ||
                slide.discountLabel) && (
                <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/60 via-black/10 to-transparent p-6 sm:p-10">
                  {slide.discountLabel ? (
                    <p className="mb-2 w-fit bg-primary px-2 py-0.5 text-xs font-semibold tracking-wide text-primary-foreground uppercase">
                      {slide.discountLabel}
                    </p>
                  ) : null}
                  {slide.title ? (
                    <p className="max-w-xl text-2xl font-semibold text-white sm:text-4xl">
                      {slide.title}
                    </p>
                  ) : null}
                  {slide.subtitle ? (
                    <p className="mt-1 max-w-xl text-sm text-white/85 sm:text-base">
                      {slide.subtitle}
                    </p>
                  ) : null}
                  {slide.ctaLabel && slide.ctaHref ? (
                    <Link
                      href={slide.ctaHref}
                      className="mt-4 inline-flex w-fit items-center bg-white px-4 py-2 text-xs font-semibold tracking-wide text-foreground uppercase"
                    >
                      {slide.ctaLabel}
                    </Link>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canPrev ? (
        <>
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-1/2 left-3 z-20 -translate-y-1/2 bg-background/80"
            onClick={() => go(-1)}
            aria-label="Previous slide"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-1/2 right-3 z-20 -translate-y-1/2 bg-background/80"
            onClick={() => go(1)}
            aria-label="Next slide"
          >
            <ChevronRight className="size-4" />
          </Button>
          <div
            className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1.5"
            role="tablist"
            aria-label="Slides"
          >
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                role="tab"
                aria-selected={i === safeIndex}
                aria-label={`Slide ${i + 1}`}
                className={cn(
                  "size-2 rounded-full",
                  i === safeIndex ? "bg-white" : "bg-white/40"
                )}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
