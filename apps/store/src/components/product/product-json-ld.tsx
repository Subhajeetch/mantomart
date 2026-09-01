import { getStoreUrl } from '@/lib/app-urls';

import type { PublicProduct } from './types';

type ProductJsonLdProps = {
  product: PublicProduct;
};

export function ProductJsonLd({ product }: ProductJsonLdProps) {
  const url = `${getStoreUrl()}/product/${product.slug}`;
  const images = product.gallery
    .filter((item) => item.type === 'image')
    .map((item) => item.url);
  const prices = product.skus.map((sku) => sku.price).filter((n) => n >= 0);
  const low = prices.length ? Math.min(...prices) : null;
  const high = prices.length ? Math.max(...prices) : null;
  const inStock = product.skus.some((sku) => sku.stock > 0);
  const brand = product.attributes.find(
    (attr) => attr.name.trim().toLowerCase() === 'brand'
  );

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url,
    image: images,
    description:
      product.metaDescription ||
      product.description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ||
      product.name,
    sku: product.skus[0]?.id,
    category: product.category?.name,
  };

  if (brand) {
    jsonLd.brand = { '@type': 'Brand', name: brand.value };
  }

  if (low !== null && high !== null) {
    jsonLd.offers = {
      '@type': 'AggregateOffer',
      url,
      priceCurrency: 'USD',
      lowPrice: (low / 100).toFixed(2),
      highPrice: (high / 100).toFixed(2),
      offerCount: product.skus.length,
      availability: inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    };
  }

  if (product.aeRating && product.aeReviewCount && product.aeReviewCount > 0) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.aeRating,
      reviewCount: product.aeReviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
