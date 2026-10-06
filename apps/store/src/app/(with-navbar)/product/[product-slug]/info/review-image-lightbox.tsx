'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Star, X } from 'lucide-react';

import type { PublicReviewPhoto } from '../types';

type ReviewImageLightboxProps = {
  photo: PublicReviewPhoto | null;
  index: number;
  totalCount: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  loadingNext: boolean;
  errorMessage: string | null;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function ReviewImageLightbox({
  photo,
  index,
  totalCount,
  canGoPrevious,
  canGoNext,
  loadingNext,
  errorMessage,
  onPrevious,
  onNext,
  onClose,
}: ReviewImageLightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!photo) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && canGoPrevious) onPrevious();
      if (event.key === 'ArrowRight' && canGoNext) onNext();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [canGoNext, canGoPrevious, onClose, onNext, onPrevious, photo]);

  if (!photo || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 text-white md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Review photo by ${photo.reviewerName}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative flex size-full max-h-full max-w-6xl flex-col overflow-hidden bg-neutral-950 md:max-h-[92svh] md:rounded-xl md:border md:border-white/10">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-20 flex size-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white"
          aria-label="Close review photo"
        >
          <X className="size-5" />
        </button>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- Review images use customer-provided public URLs. */}
          <img
            src={photo.url}
            alt={`Customer review photo by ${photo.reviewerName}`}
            decoding="async"
            fetchPriority="high"
            className="size-full select-none object-contain"
            draggable={false}
          />

          {canGoPrevious ? (
            <button
              type="button"
              onClick={onPrevious}
              className="absolute top-1/2 left-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white"
              aria-label="Previous review photo"
            >
              <ChevronLeft className="size-6" />
            </button>
          ) : null}
          {canGoNext ? (
            <button
              type="button"
              onClick={onNext}
              className="absolute top-1/2 right-3 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white"
              aria-label="Next review photo"
            >
              <ChevronRight className="size-6" />
            </button>
          ) : null}

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-5 pt-16 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-8">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{photo.reviewerName}</span>
                <span
                  className="inline-flex items-center gap-0.5 text-amber-400"
                  aria-label={`Rated ${photo.rating} out of 5`}
                >
                  {Array.from({ length: photo.rating }, (_, starIndex) => (
                    <Star
                      key={starIndex}
                      className="size-3.5 fill-current"
                      aria-hidden
                    />
                  ))}
                </span>
                <time
                  className="text-xs text-white/65"
                  dateTime={photo.reviewDate}
                >
                  {new Date(photo.reviewDate).toLocaleDateString('en-US', {
                    timeZone: 'UTC',
                  })}
                </time>
              </div>
              {photo.comment ? (
                <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap text-sm text-white/85">
                  {photo.comment}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-white/55">
                Photo {index + 1} of {totalCount.toLocaleString('en-US')}
                {loadingNext ? ' · Loading next photo…' : ''}
              </p>
              {errorMessage ? (
                <p className="mt-2 text-sm text-red-200" role="alert">
                  {errorMessage}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
