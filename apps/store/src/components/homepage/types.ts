export type PublicProductCardImage = {
  url: string;
  alt: string;
  position?: number;
};

export type PublicProductCard = {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  imageAlt: string | null;
  images: PublicProductCardImage[];
  price: number | null;
  compareAtPrice: number | null;
  onSale: boolean;
  href: string;
  aeSalesCount: string | null;
  aeRating: number | null;
  aeReviewCount: number | null;
};

export type PromoSlideLayout =
  | "deals_banner"
  | "welcome_deal"
  | "split_products"
  | "flash_row"
  | "stack_showcase"
  | "legacy";

export type PromoSlideTheme =
  | "primary"
  | "warm"
  | "cool"
  | "forest"
  | "sunset"
  | "slate";

export type PublicPromoSlideProduct = {
  id: string;
  href: string;
  name: string;
  imageUrl: string | null;
  imageAlt: string | null;
  price: number | null;
  compareAtPrice: number | null;
  onSale: boolean;
  discountLabel?: string;
};

export type PublicPromoSlideOffer = {
  id: string;
  title: string;
  subtitle?: string;
  code?: string;
  href?: string;
};

export type PublicPromoSlide = {
  id: string;
  layout: PromoSlideLayout;
  audience: "all" | "new_user";
  theme: PromoSlideTheme;
  kicker?: string;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  endsAt?: string;
  graphicTitle?: string;
  graphicSubtitle?: string;
  slideHref?: string;
  titleHref?: string;
  products: PublicPromoSlideProduct[];
  offers: PublicPromoSlideOffer[];
  imageUrl?: string;
  mobileImageUrl?: string;
  ctaHref?: string;
  discountLabel?: string;
};

export type PublicPromoSliderBlock = {
  id: string;
  blockType: "promo_slider";
  position: number;
  config: { type: "promo_slider"; slides: PublicPromoSlide[] };
};

export type PublicProductGridBlock = {
  id: string;
  blockType: "product_grid";
  position: number;
  config: {
    type: "product_grid";
    source: "category" | "featured";
    categoryId?: string;
    categoryName?: string | null;
    categorySlug?: string | null;
    limit: number;
  };
  products: PublicProductCard[];
};

export type PublicCategoryCtaButton = {
  id: string;
  label: string;
  categoryId: string;
  href: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  categoryImage: string | null;
};

export type PublicCategoryCtaBlock = {
  id: string;
  blockType: "category_cta";
  position: number;
  config: {
    type: "category_cta";
    title?: string;
    subtitle?: string;
    buttons: PublicCategoryCtaButton[];
  };
};

export type PublicProductFeedBlock = {
  id: string;
  blockType: "product_feed";
  position: number;
  config: { type: "product_feed"; pageSize: number };
  items: PublicProductCard[];
  nextCursor: string | null;
};

export type PublicHomepageBlock =
  | PublicPromoSliderBlock
  | PublicProductGridBlock
  | PublicCategoryCtaBlock
  | PublicProductFeedBlock;

export type HomepageResponse = {
  success: true;
  data: {
    blocks: PublicHomepageBlock[];
    updatedAt: string | null;
    cachedAt: string;
  };
};

export type HomepageErrorResponse = {
  success: false;
  error?: string;
  message?: string;
  code?: string;
};

export type FeedResponse = {
  success: true;
  data: {
    items: PublicProductCard[];
    nextCursor: string | null;
  };
};
