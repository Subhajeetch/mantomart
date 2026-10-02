'use client';

import { Star } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import type { PublicAttribute, PublicProduct } from '../types';
import { Expandable, ExpandableCopy } from './expandable-copy';

type ProductDetailsTabsProps = {
  product: PublicProduct;
};

function SpecGrid({ attributes }: { attributes: PublicAttribute[] }) {
  if (attributes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No specifications listed for this product.
      </p>
    );
  }

  return (
    <Expandable>
      <dl className="grid grid-cols-1 sm:grid-cols-2">
        {attributes.map((attr, index) => (
          <div
            key={`${attr.name}-${attr.value}-${index}`}
            className="grid grid-cols-[minmax(7rem,32%)_1fr] gap-3 py-3 pr-4 sm:odd:pr-8 sm:even:pl-8"
          >
            <dt className="text-sm font-medium text-foreground/55">
              {attr.name}
            </dt>
            <dd className="text-sm text-foreground">
              {attr.value}
              {attr.unit ? ` ${attr.unit}` : ''}
            </dd>
          </div>
        ))}
      </dl>
    </Expandable>
  );
}

export function ProductDetailsTabs({ product }: ProductDetailsTabsProps) {
  const hasInfo = Boolean(product.description || product.mobileDetail);

  return (
    <section aria-label="Product details" className="mt-10">
      <Tabs defaultValue="info" className="w-full gap-0">
        <TabsList
          variant="line"
          className=" w-full justify-start gap-0 rounded-none p-0"
        >
          <TabsTrigger
            value="info"
            className="flex-none px-4 text-sm data-active:text-foreground"
          >
            Info
          </TabsTrigger>
          <TabsTrigger
            value="specs"
            className="flex-none px-4 text-sm data-active:text-foreground"
          >
            Specification
          </TabsTrigger>
          <TabsTrigger
            value="reviews"
            className="flex-none px-4 text-sm data-active:text-foreground"
          >
            Reviews
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" keepMounted className="pt-6 text-sm">
          <h2 className="sr-only">Product information</h2>
          {hasInfo ? (
            <div className="space-y-8">
              {product.description ? (
                <ExpandableCopy
                  title="Description"
                  html={product.description}
                />
              ) : null}
              {product.mobileDetail ? (
                <ExpandableCopy title="Details" html={product.mobileDetail} />
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground">
              No additional information is available for this product.
            </p>
          )}
        </TabsContent>

        <TabsContent value="specs" keepMounted className="pt-4 text-sm">
          <h2 className="sr-only">Specifications</h2>
          <SpecGrid attributes={product.attributes} />
        </TabsContent>

        <TabsContent value="reviews" keepMounted className="pt-6 text-sm">
          <h2 className="sr-only">Reviews</h2>
          {product.reviews.length > 0 ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {product.averageReview !== null ? (
                  <p className="text-xl font-semibold">
                    {product.averageReview.toFixed(1)}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      / 5
                    </span>
                  </p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {product.reviewCount} customer review
                  {product.reviewCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="divide-y">
                {product.reviews.map((review) => (
                  <article
                    key={review.id}
                    className="space-y-3 py-5 first:pt-0"
                  >
                    <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">{review.reviewerName}</span>
                      <span
                        className="inline-flex items-center gap-1 text-amber-600"
                        aria-label={`Rated ${review.rating} out of 5`}
                      >
                        {Array.from({ length: review.rating }).map(
                          (_, index) => (
                            <Star
                              key={index}
                              className="size-3.5 fill-current"
                              aria-hidden
                            />
                          )
                        )}
                      </span>
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={review.reviewDate}
                      >
                        {new Date(review.reviewDate).toLocaleDateString()}
                      </time>
                    </header>
                    {review.comment ? (
                      <p className="whitespace-pre-wrap text-muted-foreground">
                        {review.comment}
                      </p>
                    ) : null}
                    {review.imageUrls.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {review.imageUrls.slice(0, 5).map((url, index) => (
                          <a
                            key={`${url}-${index}`}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block size-20 overflow-hidden rounded-md border"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`Customer review photo ${index + 1}`}
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
              {product.reviewCount > product.reviews.length ? (
                <p className="text-xs text-muted-foreground">
                  Showing the {product.reviews.length} most recent reviews.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground">
              No reviews have been added for this product yet.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
