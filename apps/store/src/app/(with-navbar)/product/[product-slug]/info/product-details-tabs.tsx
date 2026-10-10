'use client';

import { useEffect, useState } from 'react';

import type { PublicAttribute, PublicProduct } from '../types';
import { Expandable, ExpandableCopy } from './expandable-copy';
import { ProductReviews } from './product-reviews';

const sections = [
  { id: 'info', label: 'Info' },
  { id: 'specs', label: 'Specification' },
  { id: 'reviews', label: 'Reviews' },
] as const;
const sectionActivationLine = 112;

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
            className={`grid grid-cols-[minmax(7rem,32%)_1fr] gap-3 border-b border-border/50 px-3 py-3 sm:grid-cols-[minmax(7rem,32%)_1px_1fr] ${
              index % 2 === 0 ? 'bg-muted/60' : 'bg-background'
            } ${
              index % 4 === 0 || index % 4 === 3
                ? 'sm:bg-muted/60'
                : 'sm:bg-background'
            } sm:odd:border-r sm:odd:pr-8 sm:even:pl-8`}
          >
            <dt className="text-sm font-medium text-foreground/55">
              {attr.name}
            </dt>
            <span
              aria-hidden="true"
              className="hidden w-px self-stretch bg-border sm:block"
            />
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
  const [activeSection, setActiveSection] = useState<string>('info');

  useEffect(() => {
    const elements = sections
      .map(({ id }) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    let observer: IntersectionObserver | null = null;
    const observeAtActivationLine = () => {
      observer?.disconnect();
      const bottomMargin = Math.max(
        window.innerHeight - sectionActivationLine - 1,
        0
      );
      const sectionObserver = new IntersectionObserver(
        () => {
          const currentSection = elements.reduce<HTMLElement | null>(
            (current, element) =>
              element.getBoundingClientRect().top <= sectionActivationLine
                ? element
                : current,
            null
          );

          setActiveSection(currentSection?.id ?? elements[0]?.id ?? 'info');
        },
        {
          rootMargin: `-${sectionActivationLine}px 0px -${bottomMargin}px 0px`,
          threshold: 0,
        }
      );
      observer = sectionObserver;

      elements.forEach((element) => sectionObserver.observe(element));
    };

    observeAtActivationLine();
    window.addEventListener('resize', observeAtActivationLine);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', observeAtActivationLine);
    };
  }, []);

  return (
    <section aria-label="Product details" className="mt-10">
      <nav
        aria-label="Product detail sections"
        className="sticky top-16 z-20 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80"
      >
        <div className="flex w-full justify-start gap-0">
          {sections.map(({ id, label }) => {
            const isActive = activeSection === id;

            return (
              <button
                key={id}
                type="button"
                aria-current={isActive ? 'location' : undefined}
                className={`relative flex-none px-4 py-3 text-sm ${
                  isActive
                    ? 'font-semibold text-foreground after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:bg-foreground'
                    : 'font-normal text-muted-foreground'
                }`}
                onClick={() => {
                  const target = document.getElementById(id);
                  if (!target) return;

                  setActiveSection(id);
                  target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  });
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </nav>

      <section
        id="info"
        aria-labelledby="product-info-heading"
        className="scroll-mt-28 pt-6 text-sm"
      >
        <h2
          id="product-info-heading"
          className="mb-4 text-lg font-semibold tracking-tight sm:text-xl"
        >
          About this product
        </h2>
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
      </section>

      <section
        id="specs"
        aria-labelledby="product-specs-heading"
        className="mt-6 scroll-mt-28 border-t border-border/60 pt-6 text-sm"
      >
        <h2
          id="product-specs-heading"
          className="mb-4 text-lg font-semibold tracking-tight sm:text-xl"
        >
          Product specifications
        </h2>
        <SpecGrid attributes={product.attributes} />
      </section>

      <section
        id="reviews"
        aria-labelledby="product-reviews-heading"
        className="mt-6 scroll-mt-28 border-t border-border/60 pt-6 text-sm"
      >
        <h2
          id="product-reviews-heading"
          className="mb-4 text-lg font-semibold tracking-tight sm:text-xl"
        >
          Customer reviews
        </h2>
        <ProductReviews product={product} />
      </section>
    </section>
  );
}
