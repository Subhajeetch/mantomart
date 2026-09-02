'use client';

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

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
            <dt className="text-sm font-medium text-foreground/55">{attr.name}</dt>
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
                <ExpandableCopy title="Description" html={product.description} />
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
          <p className="text-muted-foreground">
            Reviews for this product will appear here soon.
          </p>
        </TabsContent>
      </Tabs>
    </section>
  );
}
