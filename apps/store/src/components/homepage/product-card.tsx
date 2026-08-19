import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { formatPriceCents, percentOff } from "./format";
import type { PublicProductCard } from "./types";

type ProductCardProps = {
  product: PublicProductCard;
  className?: string;
};

export function ProductCard({ product, className }: ProductCardProps) {
  const href = product.href || `/product/${product.slug}`;
  const off = product.onSale
    ? percentOff(product.price, product.compareAtPrice)
    : 0;
  const priceLabel = formatPriceCents(product.price);
  const wasLabel = product.onSale
    ? formatPriceCents(product.compareAtPrice)
    : "";

  return (
    <article
      className={cn(
        "group flex h-full flex-col overflow-hidden bg-card ring-1 ring-foreground/10",
        className
      )}
    >
      <Link
        href={href}
        className="flex h-full flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative aspect-square overflow-hidden bg-muted">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- R2 / arbitrary product URLs
            <img
              src={product.imageUrl}
              alt={product.imageAlt || product.name}
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div
              className="flex size-full items-center justify-center text-xs text-muted-foreground"
              aria-hidden
            >
              No image
            </div>
          )}
          {product.onSale && off > 0 && (
            <Badge
              variant="destructive"
              className="absolute top-2 left-2"
            >
              {off}% off
            </Badge>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 px-3 py-3">
          <h3 className="line-clamp-2 text-sm font-medium text-foreground">
            {product.name}
          </h3>
          <p className="mt-auto flex flex-wrap items-baseline gap-1.5 pt-1">
            {priceLabel ? (
              <span className="text-sm font-semibold tabular-nums">
                {priceLabel}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">See price</span>
            )}
            {wasLabel ? (
              <span className="text-xs text-muted-foreground line-through tabular-nums">
                {wasLabel}
              </span>
            ) : null}
          </p>
        </div>
      </Link>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden bg-card ring-1 ring-foreground/10">
      <div className="aspect-square animate-pulse bg-muted" />
      <div className="flex flex-col gap-2 px-3 py-3">
        <div className="h-4 w-4/5 animate-pulse bg-muted" />
        <div className="h-3 w-1/3 animate-pulse bg-muted" />
      </div>
    </div>
  );
}
