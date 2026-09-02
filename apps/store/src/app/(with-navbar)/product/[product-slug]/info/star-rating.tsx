import { Star } from 'lucide-react';

import {
  formatRating,
  formatReviewCount,
} from '@/components/homepage/format';
import { cn } from '@/lib/utils';

type StarRatingProps = {
  rating: number | null;
  reviewCount: number | null;
  salesCount: string | null;
};

export function StarRating({
  rating,
  reviewCount,
  salesCount,
}: StarRatingProps) {
  const ratingLabel = formatRating(rating);
  const reviewLabel = formatReviewCount(reviewCount);
  const sold = salesCount?.trim() || null;

  if (!ratingLabel && !reviewLabel && !sold) return null;

  const filled = ratingLabel
    ? Math.max(0, Math.min(5, Math.round(Number(ratingLabel))))
    : 0;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground/70">
      {ratingLabel ? (
        <span className="flex items-center gap-1" aria-label={`Rated ${ratingLabel} out of 5`}>
          <span className="flex items-center" aria-hidden>
            {Array.from({ length: 5 }).map((_, index) => (
              <Star
                key={index}
                className={cn(
                  'size-3.5',
                  index < filled
                    ? 'fill-amber-400 text-amber-400'
                    : 'fill-neutral-200 text-neutral-200'
                )}
              />
            ))}
          </span>
          <span className="font-medium tabular-nums text-foreground/80">
            {ratingLabel}
          </span>
        </span>
      ) : null}
      {reviewLabel ? (
        <span className="tabular-nums">
          {reviewCount === 1 ? '1 review' : `${reviewLabel} reviews`}
        </span>
      ) : null}
      {sold ? <span>{sold} sold</span> : null}
    </div>
  );
}
