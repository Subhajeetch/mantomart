'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Image as ImageIcon,
  MessageSquareText,
  Star,
} from 'lucide-react';

import { fetchProductReviewPage } from '../api';
import type {
  PublicProduct,
  PublicReview,
  PublicReviewFilter,
  PublicReviewPhoto,
} from '../types';
import { ReviewImageLightbox } from './review-image-lightbox';

type ProductReviewsProps = {
  product: PublicProduct;
};

function toPhoto(review: PublicReview, url: string): PublicReviewPhoto {
  return {
    url,
    reviewId: review.id,
    reviewerName: review.reviewerName,
    rating: review.rating,
    comment: review.comment,
    reviewDate: review.reviewDate,
  };
}

function photosFromReviews(reviews: PublicReview[]): PublicReviewPhoto[] {
  return reviews.flatMap((review) =>
    review.imageUrls.map((url) => toPhoto(review, url))
  );
}

function formatReviewDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function RatingStars({ rating }: { rating: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 text-amber-600"
      aria-label={`Rated ${rating} out of 5`}
    >
      {Array.from({ length: rating }, (_, index) => (
        <Star key={index} className="size-3.5 fill-current" aria-hidden />
      ))}
    </span>
  );
}

export function ProductReviews({ product }: ProductReviewsProps) {
  const [filter, setFilter] = useState<PublicReviewFilter>('comments');
  const [reviews, setReviews] = useState(product.reviews);
  const [totalCount, setTotalCount] = useState(product.reviewsWithComs);
  const [hasMore, setHasMore] = useState(
    product.reviewsWithComs > product.reviews.length
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryFilter, setRetryFilter] = useState(0);
  const [viewerPhotos, setViewerPhotos] = useState<PublicReviewPhoto[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerOffset, setViewerOffset] = useState(0);
  const [viewerHasMore, setViewerHasMore] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const viewerRequestId = useRef(0);
  const currentPhoto = viewerPhotos[viewerIndex] ?? null;

  const initialFilterCount = useMemo(
    () => ({
      all: product.reviewCount,
      images: product.reviewsWithImgs,
      comments: product.reviewsWithComs,
    }),
    [product.reviewCount, product.reviewsWithComs, product.reviewsWithImgs]
  );
  const [filterCounts, setFilterCounts] = useState(initialFilterCount);
  useEffect(() => {
    setFilterCounts(initialFilterCount);
  }, [initialFilterCount]);

  const previewPhotos = useMemo(() => {
    const photos =
      product.reviewImgsSnapShot.length > 0
        ? product.reviewImgsSnapShot
        : photosFromReviews(product.reviews);
    return photos.slice(0, 5);
  }, [product.reviewImgsSnapShot, product.reviews]);
  const photoCount = product.totalNumOfImgs;

  useEffect(() => {
    if (filter === 'comments') {
      setReviews(product.reviews);
      setTotalCount(product.reviewsWithComs);
      setHasMore(product.reviewsWithComs > product.reviews.length);
      setIsLoading(false);
      setError(null);
      return;
    }

    let active = true;
    setReviews([]);
    setTotalCount(initialFilterCount[filter]);
    setHasMore(false);
    setIsLoading(true);
    setError(null);
    void fetchProductReviewPage(product.slug, filter, 0)
      .then((page) => {
        if (!active) return;
        setReviews(page.reviews);
        setTotalCount(page.totalCount);
        setHasMore(page.hasMore);
        setFilterCounts((current) => ({
          ...current,
          [filter]: page.totalCount,
        }));
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Reviews could not be loaded. Please try again.'
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    filter,
    initialFilterCount,
    product.reviewCount,
    product.reviews,
    product.reviewsWithComs,
    product.slug,
    retryFilter,
  ]);

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    setError(null);
    try {
      const page = await fetchProductReviewPage(
        product.slug,
        filter,
        reviews.length
      );
      setReviews((current) => {
        const existing = new Set(current.map((review) => review.id));
        return [
          ...current,
          ...page.reviews.filter((review) => !existing.has(review.id)),
        ];
      });
      setTotalCount(page.totalCount);
      setHasMore(page.hasMore);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'More reviews could not be loaded. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [filter, hasMore, isLoading, product.slug, reviews.length]);

  const openViewer = useCallback(
    async (selectedPhoto: PublicReviewPhoto) => {
      const requestId = ++viewerRequestId.current;
      setViewerLoading(true);
      setViewerError(null);
      setError(null);
      try {
        const page = await fetchProductReviewPage(product.slug, 'images', 0);
        if (requestId !== viewerRequestId.current) return;
        const photos = photosFromReviews(page.reviews);
        const selectedIndex = photos.findIndex(
          (photo) =>
            photo.reviewId === selectedPhoto.reviewId &&
            photo.url === selectedPhoto.url
        );
        setViewerPhotos(
          selectedIndex >= 0 ? photos : [selectedPhoto, ...photos]
        );
        setViewerIndex(selectedIndex >= 0 ? selectedIndex : 0);
        setViewerOffset(page.reviews.length);
        setViewerHasMore(page.hasMore);
      } catch (requestError) {
        if (requestId !== viewerRequestId.current) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Review photos could not be loaded. Please try again.'
        );
        return;
      } finally {
        if (requestId === viewerRequestId.current) setViewerLoading(false);
      }
    },
    [product.slug]
  );

  const goToNextPhoto = useCallback(async () => {
    if (viewerIndex < viewerPhotos.length - 1) {
      setViewerIndex((index) => index + 1);
      return;
    }
    if (!viewerHasMore || viewerLoading) return;

    setViewerLoading(true);
    setViewerError(null);
    const requestId = viewerRequestId.current;
    try {
      const page = await fetchProductReviewPage(
        product.slug,
        'images',
        viewerOffset
      );
      if (requestId !== viewerRequestId.current) return;
      const nextPhotos = photosFromReviews(page.reviews);
      if (nextPhotos.length === 0) {
        setViewerHasMore(false);
        setViewerError('There are no more review photos to show.');
        return;
      }
      setViewerIndex(viewerPhotos.length);
      setViewerPhotos((current) => [...current, ...nextPhotos]);
      setViewerOffset((offset) => offset + page.reviews.length);
      setViewerHasMore(page.hasMore);
    } catch (requestError) {
      if (requestId !== viewerRequestId.current) return;
      setViewerError(
        requestError instanceof Error
          ? requestError.message
          : 'The next review photo could not be loaded. Please try again.'
      );
    } finally {
      if (requestId === viewerRequestId.current) setViewerLoading(false);
    }
  }, [
    product.slug,
    viewerHasMore,
    viewerIndex,
    viewerLoading,
    viewerOffset,
    viewerPhotos.length,
  ]);

  const filters: Array<{
    value: PublicReviewFilter;
    label: string;
    count: number;
    icon?: typeof ImageIcon;
  }> = [
    {
      value: 'comments',
      label: 'With comments',
      count: filterCounts.comments,
      icon: MessageSquareText,
    },
    {
      value: 'images',
      label: 'With photos',
      count: filterCounts.images,
      icon: ImageIcon,
    },
    {
      value: 'all',
      label: 'All reviews',
      count: filterCounts.all,
    },
  ];

  return (
    <div className="space-y-7">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {product.averageReview !== null ? (
            <div className="flex items-center gap-2">
              <p className="text-2xl font-semibold tabular-nums">
                {product.averageReview.toFixed(1)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / 5
                </span>
              </p>
              <RatingStars rating={Math.round(product.averageReview)} />
              <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                {product.averageReview >= 4.5
                  ? 'Excellent'
                  : product.averageReview >= 3.5
                    ? 'Good'
                    : product.averageReview >= 2.5
                      ? 'Fair'
                      : 'Poor'}
              </span>
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Based on {product.reviewCount.toLocaleString('en-US')} customer review
            {product.reviewCount === 1 ? '' : 's'}
          </p>
        </div>

        {previewPhotos.length > 0 ? (
          <div
            role="group"
            className="grid h-48 grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-xl sm:h-64"
            aria-label={`${product.totalNumOfImgs.toLocaleString('en-US')} customer review photos`}
          >
            {previewPhotos.map((photo, index) => {
              const remaining = photoCount - previewPhotos.length;
              const isLast = index === previewPhotos.length - 1;
              return (
                <button
                  key={`${photo.reviewId}-${photo.url}-${index}`}
                  type="button"
                  onClick={() => void openViewer(photo)}
                  disabled={viewerLoading}
                  aria-label={
                    isLast && remaining > 0
                      ? `View customer photo and ${remaining.toLocaleString('en-US')} more photos`
                      : `View customer photo by ${photo.reviewerName}`
                  }
                  className={`group relative min-h-0 overflow-hidden bg-muted text-left disabled:cursor-wait ${
                    index === 0
                      ? 'col-span-2 row-span-2'
                      : 'col-span-1 row-span-1'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Review photos are served from customer-provided public URLs. */}
                  <img
                    src={photo.url}
                    alt={`Customer review photo by ${photo.reviewerName}`}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  {isLast && remaining > 0 ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/65 text-xl font-semibold text-white">
                      +{remaining.toLocaleString('en-US')}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div
        role="group"
        className="flex flex-wrap gap-2"
        aria-label="Filter reviews"
      >
        {filters.map(({ value, label, count, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            disabled={isLoading}
            onClick={() => setFilter(value)}
            className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-60 ${
              filter === value
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-background text-foreground hover:bg-muted'
            }`}
          >
            {Icon ? <Icon className="size-4" aria-hidden /> : null}
            <span>{label}</span>
            <span className="tabular-nums opacity-75">
              {count.toLocaleString('en-US')}
            </span>
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {isLoading && reviews.length === 0 ? (
        <p className="py-5 text-sm text-muted-foreground" role="status">
          Loading customer reviews…
        </p>
      ) : reviews.length > 0 ? (
        <div className="divide-y">
          {reviews.map((review) => (
            <article key={review.id} className="space-y-3 py-5 first:pt-0">
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{review.reviewerName}</span>
                <RatingStars rating={review.rating} />
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={review.reviewDate}
                >
                  {formatReviewDate(review.reviewDate)}
                </time>
              </header>
              {review.comment ? (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {review.comment}
                </p>
              ) : null}
              {review.imageUrls.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {review.imageUrls.map((url, index) => (
                    <button
                      key={`${review.id}-${url}-${index}`}
                      type="button"
                      onClick={() => void openViewer(toPhoto(review, url))}
                      disabled={viewerLoading}
                      className="size-20 overflow-hidden rounded-md border bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      aria-label={`View review photo ${index + 1} by ${review.reviewerName}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- Review photos are served from customer-provided public URLs. */}
                      <img
                        src={url}
                        alt={`Customer review photo ${index + 1}`}
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : !error ? (
        <p className="py-5 text-sm text-muted-foreground">
          {filter === 'images'
            ? 'No customer reviews with photos yet.'
            : filter === 'comments'
              ? 'No customer reviews with comments yet.'
              : 'No reviews have been added for this product yet.'}
        </p>
      ) : null}

      {error && filter !== 'all' && reviews.length === 0 ? (
        <button
          type="button"
          onClick={() => setRetryFilter((count) => count + 1)}
          disabled={isLoading}
          className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
        >
          Try loading reviews again
        </button>
      ) : null}

      {hasMore ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={isLoading}
          className="mx-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60"
        >
          {isLoading ? 'Loading reviews…' : 'Load more reviews'}
          {!isLoading ? <ChevronDown className="size-4" aria-hidden /> : null}
        </button>
      ) : null}

      {reviews.length > 0 ? (
        <p className="text-center text-xs text-muted-foreground">
          Showing {reviews.length.toLocaleString('en-US')} of{' '}
          {totalCount.toLocaleString('en-US')} review
          {totalCount === 1 ? '' : 's'}
        </p>
      ) : null}

      <ReviewImageLightbox
        photo={currentPhoto}
        index={viewerIndex}
        totalCount={Math.max(photoCount, viewerIndex + 1)}
        canGoPrevious={viewerIndex > 0}
        canGoNext={
          viewerIndex < viewerPhotos.length - 1 || viewerHasMore
        }
        loadingNext={viewerLoading}
        errorMessage={viewerError}
        onPrevious={() => setViewerIndex((index) => Math.max(0, index - 1))}
        onNext={() => void goToNextPhoto()}
        onClose={() => {
          viewerRequestId.current += 1;
          setViewerLoading(false);
          setViewerPhotos([]);
        }}
      />
    </div>
  );
}
