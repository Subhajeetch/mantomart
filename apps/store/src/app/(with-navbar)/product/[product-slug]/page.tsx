import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  getMoreForYou,
  getProduct,
  ProductJsonLd,
  ProductView,
} from '@/components/product';
import { getStoreUrl } from '@/lib/app-urls';

export const revalidate = 300;

type PageProps = {
  params: Promise<{ 'product-slug': string }>;
};

function stripHtml(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { 'product-slug': slug } = await params;
  const product = await getProduct(slug);
  if (!product) {
    return {
      title: 'Product not found',
      robots: { index: false, follow: false },
    };
  }

  const title = product.metaTitle || product.name;
  const description =
    product.metaDescription ||
    stripHtml(product.description) ||
    `Shop ${product.name} at RagiMart.`;
  const image = product.gallery.find((item) => item.type === 'image');
  const canonical = `${getStoreUrl()}/product/${product.slug}`;

  return {
    title,
    description,
    keywords: product.tags,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      images: image ? [{ url: image.url, alt: image.alt || product.name }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image.url] : undefined,
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { 'product-slug': slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  const more = await getMoreForYou(product.slug);

  return (
    <>
      <ProductJsonLd product={product} />
      <ProductView product={product} more={more} />
    </>
  );
}
