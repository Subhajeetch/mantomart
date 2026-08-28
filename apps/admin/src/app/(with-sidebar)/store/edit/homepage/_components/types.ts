export const HOMEPAGE_BLOCK_TYPES = [
  'promo_slider',
  'product_grid',
  'category_cta',
  'product_feed',
] as const;

export type HomepageBlockType = (typeof HOMEPAGE_BLOCK_TYPES)[number];

export type PromoSlideAudience = 'all' | 'new_user';

export const PROMO_SLIDE_LAYOUTS = [
  'deals_banner',
  'welcome_deal',
  'split_products',
  'flash_row',
  'stack_showcase',
] as const;

export type PromoSlideLayout = (typeof PROMO_SLIDE_LAYOUTS)[number];
export type PromoSlideLayoutOrLegacy = PromoSlideLayout | 'legacy';

export const PROMO_SLIDE_THEMES = [
  'primary',
  'warm',
  'cool',
  'forest',
  'sunset',
  'slate',
] as const;

export type PromoSlideTheme = (typeof PROMO_SLIDE_THEMES)[number];

export type PromoLinkKind = 'product' | 'category' | 'custom';

export type PromoLinkConfig = {
  kind: PromoLinkKind;
  productId?: string;
  productName?: string;
  productSlug?: string;
  categoryId?: string;
  categoryName?: string;
  categorySlug?: string;
  href?: string;
};

export type PromoSlideProductSlot = {
  id: string;
  productId: string;
  name?: string;
  slug?: string;
  imageUrl?: string;
  imageAlt?: string;
  price?: number;
  compareAtPrice?: number;
  discountLabel?: string;
  salePriceCents?: number;
  compareAtOverrideCents?: number;
  link?: PromoLinkConfig;
};

export type PromoSlideOffer = {
  id: string;
  title: string;
  subtitle?: string;
  code?: string;
  link?: PromoLinkConfig;
};

export type PromoSlideConfigItem = {
  id: string;
  layout: PromoSlideLayoutOrLegacy;
  audience: PromoSlideAudience;
  theme?: PromoSlideTheme;
  kicker?: string;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  endsAt?: string;
  graphicTitle?: string;
  graphicSubtitle?: string;
  slideLink?: PromoLinkConfig;
  titleLink?: PromoLinkConfig;
  products?: PromoSlideProductSlot[];
  offers?: PromoSlideOffer[];
  imageUrl?: string;
  mobileImageUrl?: string;
  ctaHref?: string;
  discountLabel?: string;
};

export type PromoSliderConfig = {
  type: 'promo_slider';
  slides: PromoSlideConfigItem[];
};

export const PROMO_SLIDE_LAYOUT_META: Record<
  PromoSlideLayout,
  {
    label: string;
    description: string;
    productSlots: number;
    offerSlots: number;
    hasGraphic: boolean;
  }
> = {
  deals_banner: {
    label: 'Deals banner',
    description: 'Offer tiles, one featured product, and a graphic title.',
    productSlots: 1,
    offerSlots: 3,
    hasGraphic: true,
  },
  welcome_deal: {
    label: 'Welcome deal',
    description: 'Centered copy with tilted product cards.',
    productSlots: 3,
    offerSlots: 0,
    hasGraphic: false,
  },
  split_products: {
    label: 'Split products',
    description: 'Two products on each side of the headline.',
    productSlots: 4,
    offerSlots: 0,
    hasGraphic: false,
  },
  flash_row: {
    label: 'Flash row',
    description: 'Headline on the left, a row of products on the right.',
    productSlots: 4,
    offerSlots: 0,
    hasGraphic: false,
  },
  stack_showcase: {
    label: 'Stack showcase',
    description: 'Overlapping product cards beside the headline.',
    productSlots: 3,
    offerSlots: 0,
    hasGraphic: false,
  },
};

export const PROMO_SLIDE_THEME_META: Record<
  PromoSlideTheme,
  { label: string; swatch: string }
> = {
  primary: { label: 'Brand', swatch: 'var(--primary)' },
  warm: { label: 'Warm', swatch: 'oklch(0.64 0.12 48)' },
  cool: { label: 'Cool', swatch: 'oklch(0.52 0.10 264)' },
  forest: { label: 'Forest', swatch: 'oklch(0.48 0.07 155)' },
  sunset: { label: 'Sunset', swatch: 'oklch(0.74 0.11 42)' },
  slate: { label: 'Slate', swatch: 'oklch(0.40 0.03 250)' },
};

export type HomepageProductHit = {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  imageAlt: string | null;
  images?: Array<{
    url: string;
    alt: string;
    position?: number;
    /** isOptimised — smaller card-sized copy hosted alongside the full image. */
    isOp?: boolean;
    /** Full-quality image URL paired with an optimized card image. */
    fullUrl?: string;
  }>;
  price: number | null;
  compareAtPrice: number | null;
};

export type FlatCategory = {
  id: string;
  name: string;
  slug: string;
  depth: number;
  label: string;
};

export type ProductGridConfig = {
  type: 'product_grid';
  source: 'category' | 'featured';
  categoryId?: string;
  limit: number;
};

export type CategoryCtaButtonConfig = {
  id: string;
  label: string;
  categoryId: string;
  href?: string;
};

export type CategoryCtaConfig = {
  type: 'category_cta';
  title?: string;
  subtitle?: string;
  buttons: CategoryCtaButtonConfig[];
};

export type ProductFeedConfig = {
  type: 'product_feed';
  pageSize: number;
};

export type HomepageBlockConfig =
  | PromoSliderConfig
  | ProductGridConfig
  | CategoryCtaConfig
  | ProductFeedConfig;

export type HomepageAdminBlock = {
  id: string;
  blockType: HomepageBlockType;
  config: HomepageBlockConfig | Record<string, unknown>;
  position: number;
  isVisible: boolean;
  needsRepair: boolean;
  createdAt: string | Date | number | null;
  updatedAt: string | Date | number | null;
};

export type HomepageMeta = {
  totalBlocks: number;
  visibleBlocks: number;
  maxBlocks: number;
  maxSlidesPerSlider: number;
  maxButtonsPerCta: number;
  maxGridLimit: number;
  maxFeedPageSize: number;
  currentUserId?: string;
  currentUserRole: string;
  canUpdate: boolean;
};

export type AvailableCategory = {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  position: number;
  parentId: string | null;
};

export type CategoryNode = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  parentId: string | null;
  position: number;
  depth: number;
  children: CategoryNode[];
};

export type ApiErrorBody = {
  success?: false;
  error?: string;
  message?: string;
  code?: string;
};

export type ReorderItemPayload = {
  id: string;
  position: number;
};

export type DragKind = 'block';

export function dragId(kind: DragKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseDragId(
  value: string | null | undefined
): { kind: DragKind; id: string } | null {
  if (!value) return null;
  const sep = value.indexOf(':');
  if (sep <= 0) return null;
  const kind = value.slice(0, sep);
  const id = value.slice(sep + 1);
  if (!id || kind !== 'block') return null;
  return { kind: 'block', id };
}

export const BLOCK_TYPE_LABELS: Record<HomepageBlockType, string> = {
  promo_slider: 'Promo slider',
  product_grid: 'Product grid',
  category_cta: 'Category CTA',
  product_feed: 'Product feed',
};
