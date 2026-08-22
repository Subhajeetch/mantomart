"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Autoplay from "embla-carousel-autoplay";
import useEmblaCarousel from "embla-carousel-react";
import type { Session } from "@repo/types/session-client";

import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { PromoSlideView } from "./promo-slides/layouts";
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
    if (slide.audience === "new_user") return newUser;
    return true;
  });
}

export function PromoSlider({ block }: PromoSliderProps) {
  const { data, isPending } = useSession();
  const session = data as Session | null;
  const newUser = isNewUser(session?.user);

  const allSlides = Array.isArray(block.config.slides)
    ? block.config.slides
    : EMPTY_SLIDES;

  const slides = useMemo(
    () => visibleSlides(allSlides, isPending ? false : newUser),
    [allSlides, isPending, newUser]
  );

  const autoplay = useRef(
    Autoplay({
      delay: 6500,
      stopOnInteraction: false,
      stopOnMouseEnter: true,
      playOnInit: false,
    })
  );

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const canLoop = slides.length > 1;

  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      loop: canLoop,
      align: "start",
      duration: reduceMotion ? 0 : 22,
      watchDrag: canLoop,
    },
    [autoplay.current]
  );

  const [index, setIndex] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.reInit({
      loop: slides.length > 1,
      align: "start",
      duration: reduceMotion ? 0 : 22,
      watchDrag: slides.length > 1,
    });
  }, [emblaApi, slides.length, reduceMotion]);

  const slideCount = slides.length;
  const prevCount = useRef(slideCount);
  useEffect(() => {
    if (!emblaApi) return;
    if (prevCount.current !== slideCount) {
      emblaApi.scrollTo(0, true);
      prevCount.current = slideCount;
    }
  }, [emblaApi, slideCount]);

  useEffect(() => {
    const plugin = emblaApi?.plugins()?.autoplay;
    if (!plugin) return;
    if (reduceMotion || slides.length <= 1) plugin.stop();
    else plugin.play();
  }, [emblaApi, reduceMotion, slides.length]);

  if (allSlides.length === 0 || slides.length === 0) return null;

  const canNav = slides.length > 1;
  const go = (dir: -1 | 1) => {
    if (!emblaApi) return;
    if (dir < 0) emblaApi.scrollPrev();
    else emblaApi.scrollNext();
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Promotions"
      className="relative overflow-hidden select-none"
      tabIndex={canNav ? 0 : undefined}
      onKeyDown={(event) => {
        if (!canNav) return;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(-1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          go(1);
        }
      }}
    >
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex items-stretch">
          {slides.map((slide, i) => (
            <div
              key={slide.id}
              className="flex min-w-0 flex-[0_0_100%]"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${slides.length}`}
            >
              <div className="w-full">
                <PromoSlideView slide={slide} priority={i === 0} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {canNav ? (
        <>
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-1/2 left-2 z-20 hidden size-8 -translate-y-1/2 bg-background/90 shadow-sm sm:inline-flex md:left-3"
            onClick={() => go(-1)}
            aria-label="Previous slide"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-1/2 right-2 z-20 hidden size-8 -translate-y-1/2 bg-background/90 shadow-sm sm:inline-flex md:right-3"
            onClick={() => go(1)}
            aria-label="Next slide"
          >
            <ChevronRight className="size-4" />
          </Button>
          <div
            className="absolute bottom-2.5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/30 px-2 py-1 backdrop-blur-sm"
            role="tablist"
            aria-label="Slides"
          >
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Slide ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index
                    ? "w-5 bg-white"
                    : "w-2 bg-white/50 hover:bg-white/80"
                )}
                onClick={() => emblaApi?.scrollTo(i)}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

const EMPTY_SLIDES: PublicPromoSlide[] = [];
