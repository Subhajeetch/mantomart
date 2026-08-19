export const HOMEPAGE_BLOCK_TYPES = [
  "promo_slider",
  "product_grid",
  "category_cta",
  "product_feed",
] as const;

export type HomepageBlockType = (typeof HOMEPAGE_BLOCK_TYPES)[number];

export type PromoSlideAudience = "all" | "new_user";

export type PromoSlideConfigItem = {
  id: string;
  imageUrl: string;
  mobileImageUrl?: string;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
  audience: PromoSlideAudience;
  discountLabel?: string;
};

export type PromoSliderConfig = {
  type: "promo_slider";
  slides: PromoSlideConfigItem[];
};

export type ProductGridConfig = {
  type: "product_grid";
  source: "category" | "featured";
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
  type: "category_cta";
  title?: string;
  subtitle?: string;
  buttons: CategoryCtaButtonConfig[];
};

export type ProductFeedConfig = {
  type: "product_feed";
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

export type DragKind = "block";

export function dragId(kind: DragKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseDragId(
  value: string | null | undefined
): { kind: DragKind; id: string } | null {
  if (!value) return null;
  const sep = value.indexOf(":");
  if (sep <= 0) return null;
  const kind = value.slice(0, sep);
  const id = value.slice(sep + 1);
  if (!id || kind !== "block") return null;
  return { kind: "block", id };
}

export const BLOCK_TYPE_LABELS: Record<HomepageBlockType, string> = {
  promo_slider: "Promo slider",
  product_grid: "Product grid",
  category_cta: "Category CTA",
  product_feed: "Product feed",
};
