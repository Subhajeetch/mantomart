import type { PublicProductCard } from '@/components/homepage/types';

export type PublicGalleryImage = {
  type: 'image';
  url: string;
  alt: string;
  forVariant: string | null;
  variantKeys: string[];
};

export type PublicGalleryVideo = {
  type: 'video';
  url: string;
  poster: string | null;
  alt: string;
};

export type PublicGalleryItem = PublicGalleryImage | PublicGalleryVideo;

export type PublicOptionValue = {
  value: string;
  image: string | null;
  inStock: boolean;
};

export type PublicOptionGroup = {
  name: string;
  values: PublicOptionValue[];
  hasImages: boolean;
};

export type PublicSku = {
  id: string;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  options: Record<string, string>;
};

export type PublicAttribute = {
  name: string;
  value: string;
  unit: string | null;
};

export type PublicCategoryRef = {
  id: string;
  name: string;
  slug: string;
  href: string;
};

export type PublicProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  mobileDetail: string | null;
  hasSizeChart: boolean;
  sizeChartImage: string | null;
  sizeChartDescription: string | null;
  aeRating: number | null;
  aeReviewCount: number | null;
  aeSalesCount: string | null;
  tags: string[];
  metaTitle: string | null;
  metaDescription: string | null;
  gallery: PublicGalleryItem[];
  optionGroups: PublicOptionGroup[];
  skus: PublicSku[];
  attributes: PublicAttribute[];
  category: PublicCategoryRef | null;
  breadcrumbs: PublicCategoryRef[];
};

export type ProductResponse = {
  success: true;
  data: PublicProduct;
};

export type ProductErrorResponse = {
  success: false;
  error?: string;
  message?: string;
  code?: string;
};

export type MoreForYouResponse = {
  success: true;
  data: {
    items: PublicProductCard[];
    nextCursor: string | null;
  };
};

export type MoreForYouPage = {
  items: PublicProductCard[];
  nextCursor: string | null;
};
