'use client';

import { Check, ImageIcon, Loader2, RefreshCw, Star, X } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ProxiedImg } from '@/util/proxied-image';
import type { ImportedReviewDraft } from './storage';

type ImportWizardReviewsProps = {
  reviews: ImportedReviewDraft[] | null;
  loading: boolean;
  error: string | null;
  selectionLimit: number;
  targetAverage: number | null;
  onRefresh: () => void;
  onChange: (reviews: ImportedReviewDraft[]) => void;
  onTargetChange: (target: number | null) => void;
};

const TARGET_AVERAGES = [4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9];

function randomReviewCount(available: number): number {
  if (available <= 0) return 0;
  try {
    const random = new Uint32Array(1);
    globalThis.crypto.getRandomValues(random);
    return 1 + (random[0]! % Math.min(8, available));
  } catch {
    return 1 + Math.floor(Math.random() * Math.min(8, available));
  }
}

function reviewsForAverage(
  reviews: ImportedReviewDraft[],
  target: number,
  limit: number
): Set<string> | null {
  const byRating = new Map<number, ImportedReviewDraft[]>(
    [1, 2, 3, 4, 5].map((rating) => [
      rating,
      reviews.filter((review) => review.rating === rating),
    ])
  );
  const max = Math.min(limit, reviews.length);
  const lowCounts = [1, 2, 3].map((_, index) => {
    const available = byRating.get(index + 1)?.length ?? 0;
    return randomReviewCount(available);
  });

  for (let count = max; count > 0; count--) {
    const lowTotal = lowCounts.reduce((sum, value) => sum + value, 0);
    if (lowTotal > count) continue;
    const fourAndFiveTotal = count - lowTotal;
    const lowScore = lowCounts.reduce(
      (sum, value, index) => sum + value * (index + 1),
      0
    );
    const rawFiveCount = target * count - lowScore - fourAndFiveTotal * 4;
    const fiveCount = Math.round(rawFiveCount);
    if (Math.abs(rawFiveCount - fiveCount) > 1e-8) continue;
    const counts = [...lowCounts, fourAndFiveTotal - fiveCount, fiveCount];
    if (
      counts.every(
        (needed, index) =>
          needed >= 0 && needed <= (byRating.get(index + 1)?.length ?? 0)
      ) &&
      Math.round(
        (counts.reduce((sum, needed, index) => sum + needed * (index + 1), 0) /
          count) *
          10
      ) /
        10 ===
        target
    ) {
      return new Set(
        counts.flatMap((needed, index) =>
          (byRating.get(index + 1) ?? [])
            .slice(0, needed)
            .map((review) => review.sourceReviewId)
        )
      );
    }
  }

  return null;
}

export function ImportWizardReviews({
  reviews,
  loading,
  error,
  selectionLimit,
  targetAverage,
  onRefresh,
  onChange,
  onTargetChange,
}: ImportWizardReviewsProps) {
  const [templateError, setTemplateError] = useState<string | null>(null);
  const data = reviews ?? [];
  const selectedCount = data.filter((review) => review.selected).length;
  const canSelect = selectedCount < selectionLimit;
  const selectedByRating = [1, 2, 3, 4, 5].map(
    (rating) =>
      data.filter((review) => review.selected && review.rating === rating)
        .length
  );

  const selectAll = () => {
    let remaining = selectionLimit;
    onChange(
      data.map((review) => {
        const selected = remaining > 0;
        if (selected) remaining--;
        return { ...review, selected };
      })
    );
    onTargetChange(null);
    setTemplateError(null);
  };

  const applyTarget = (target: number) => {
    const selectedIds = reviewsForAverage(data, target, selectionLimit);
    if (!selectedIds) {
      setTemplateError(
        `A ${target.toFixed(1)} average is not possible with the available review ratings. Your current selection was not changed.`
      );
      return;
    }
    setTemplateError(null);
    onChange(
      data.map((review) => ({
        ...review,
        selected: selectedIds.has(review.sourceReviewId),
      }))
    );
    onTargetChange(target);
  };

  return (
    <div className="space-y-5 p-2 md:p-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">AliExpress reviews</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Select reviews to publish. Review photos are copied to your storage
            during publishing. Up to {selectionLimit} reviews may be selected.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {reviews === null ? 'Fetch reviews' : 'Refresh reviews'}
        </Button>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-destructive">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {loading && reviews === null ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Fetching AliExpress reviews in the background…
        </div>
      ) : null}

      {reviews !== null && data.length > 0 ? (
        <>
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-semibold">{selectedCount}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    of {data.length} fetched reviews selected
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={selectAll}
                    disabled={selectionLimit === 0}
                  >
                    Select up to limit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onChange(
                        data.map((review) => ({ ...review, selected: false }))
                      );
                      onTargetChange(null);
                    }}
                    disabled={selectedCount === 0}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Average-rating template
                </p>
                <div className="flex flex-wrap gap-2">
                  {TARGET_AVERAGES.map((target) => (
                    <Button
                      key={target}
                      type="button"
                      size="sm"
                      variant={targetAverage === target ? 'default' : 'outline'}
                      onClick={() => applyTarget(target)}
                      disabled={data.length === 0}
                    >
                      <Star className="mr-1 h-3.5 w-3.5" />
                      {target.toFixed(1)}
                    </Button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Templates select available reviews around the chosen score;
                  you can adjust individual selections below.
                </p>
                {templateError ? (
                  <Alert variant="destructive" className="mt-3">
                    <AlertDescription>{templateError}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold">
                  Selected reviews by rating
                </h4>
                <span className="text-xs text-muted-foreground">
                  {selectedCount} total
                </span>
              </div>
              <div className="space-y-2">
                {selectedByRating.map((count, index) => {
                  const rating = index + 1;
                  const percentage =
                    selectedCount > 0 ? (count / selectedCount) * 100 : 0;
                  return (
                    <div
                      key={rating}
                      className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm"
                    >
                      <span className="text-muted-foreground">
                        {rating} star
                      </span>
                      <div
                        className="h-2 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-label={`${rating} star reviews`}
                        aria-valuemin={0}
                        aria-valuemax={selectedCount}
                        aria-valuenow={count}
                      >
                        <div
                          className="h-full rounded-full bg-amber-500 transition-[width]"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="text-right tabular-nums">{count}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            {data.map((review, index) => (
              <Card
                key={`${review.sourceReviewId}-${index}`}
                className={review.selected ? 'border-primary' : undefined}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select review by ${review.reviewerName}`}
                      checked={review.selected}
                      disabled={!review.selected && !canSelect}
                      onChange={(event) =>
                        onChange(
                          data.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, selected: event.target.checked }
                              : item
                          )
                        )
                      }
                      className="mt-1 h-4 w-4 accent-primary"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">
                          {review.reviewerName.trim().toLowerCase() ===
                          'aliexpress shopper'
                            ? 'Shopper'
                            : review.reviewerName}
                        </span>
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Star className="h-3.5 w-3.5 fill-current" />
                          {review.rating}/5
                        </span>
                        <time
                          className="text-xs text-muted-foreground"
                          dateTime={review.reviewDate}
                        >
                          {new Date(review.reviewDate).toLocaleDateString()}
                        </time>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        {review.comment || 'No written comment.'}
                      </p>
                      {review.imageUrls.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {review.imageUrls
                            .slice(0, 5)
                            .map((url, imageIndex) => (
                              <div
                                key={`${url}-${imageIndex}`}
                                className="relative h-16 w-16 overflow-hidden rounded-md border bg-muted"
                              >
                                <ProxiedImg
                                  src={url}
                                  alt={`Review photo ${imageIndex + 1}`}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                            ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="hidden text-muted-foreground sm:block">
                      {review.selected ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {reviews !== null && data.length === 0 && !loading ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <ImageIcon className="h-5 w-5" />
            No AliExpress reviews were returned for this product.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
