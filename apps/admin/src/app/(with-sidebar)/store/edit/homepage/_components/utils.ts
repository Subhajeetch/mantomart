import type {
  CategoryNode,
  HomepageAdminBlock,
  HomepageBlockConfig,
  HomepageBlockType,
  PromoSlideConfigItem,
  PromoSlideLayout,
  PromoSlideProductSlot,
  PromoSliderConfig,
  ProductGridConfig,
  CategoryCtaConfig,
  ProductFeedConfig,
} from "./types";
import {
  BLOCK_TYPE_LABELS,
  PROMO_SLIDE_LAYOUTS,
  PROMO_SLIDE_THEMES,
} from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function reorderList<T>(list: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return list;
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (!moved) return list;
  next.splice(to, 0, moved);
  return next;
}

export function withPositions<T extends { position: number }>(
  list: T[],
  step = 10
): T[] {
  return list.map((entry, index) => ({ ...entry, position: index * step }));
}

export function localId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 21);
  }
  return `id_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultConfig(type: HomepageBlockType): HomepageBlockConfig {
  switch (type) {
    case "promo_slider":
      return { type: "promo_slider", slides: [] };
    case "product_grid":
      return { type: "product_grid", source: "featured", limit: 8 };
    case "category_cta":
      return { type: "category_cta", buttons: [] };
    case "product_feed":
      return { type: "product_feed", pageSize: 12 };
  }
}

function isPromoLayout(value: unknown): value is PromoSlideLayout {
  return (
    typeof value === "string" &&
    (PROMO_SLIDE_LAYOUTS as readonly string[]).includes(value)
  );
}

export function emptyPromoSlide(id: string): PromoSlideConfigItem {
  return {
    id,
    layout: "deals_banner",
    audience: "all",
    theme: "primary",
    products: [],
    offers: [],
  };
}

export function normalizeAdminSlide(
  raw: unknown,
  fallbackId: string
): PromoSlideConfigItem {
  if (!isRecord(raw)) return emptyPromoSlide(fallbackId);
  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId;
  const imageUrl =
    typeof raw.imageUrl === "string" && raw.imageUrl.trim()
      ? raw.imageUrl.trim()
      : undefined;
  const audience = raw.audience === "new_user" ? "new_user" : "all";

  if (raw.layout === "legacy" || (!isPromoLayout(raw.layout) && imageUrl)) {
    const slide: PromoSlideConfigItem = {
      id,
      layout: "legacy",
      audience,
      imageUrl,
    };
    if (typeof raw.mobileImageUrl === "string" && raw.mobileImageUrl.trim()) {
      slide.mobileImageUrl = raw.mobileImageUrl.trim();
    }
    if (typeof raw.title === "string") slide.title = raw.title;
    if (typeof raw.subtitle === "string") slide.subtitle = raw.subtitle;
    if (typeof raw.ctaLabel === "string") slide.ctaLabel = raw.ctaLabel;
    if (typeof raw.ctaHref === "string") slide.ctaHref = raw.ctaHref;
    if (typeof raw.discountLabel === "string") {
      slide.discountLabel = raw.discountLabel;
    }
    return slide;
  }

  const products = Array.isArray(raw.products)
    ? (raw.products.filter(isRecord) as PromoSlideProductSlot[])
    : [];

  const slide: PromoSlideConfigItem = {
    id,
    layout: isPromoLayout(raw.layout) ? raw.layout : "deals_banner",
    audience,
    theme:
      typeof raw.theme === "string" &&
      (PROMO_SLIDE_THEMES as readonly string[]).includes(raw.theme)
        ? (raw.theme as PromoSlideConfigItem["theme"])
        : "primary",
    products,
    offers: Array.isArray(raw.offers)
      ? (raw.offers.filter(isRecord) as PromoSlideConfigItem["offers"])
      : [],
  };
  if (typeof raw.kicker === "string") slide.kicker = raw.kicker;
  if (typeof raw.title === "string") slide.title = raw.title;
  if (typeof raw.subtitle === "string") slide.subtitle = raw.subtitle;
  if (typeof raw.ctaLabel === "string") slide.ctaLabel = raw.ctaLabel;
  if (typeof raw.endsAt === "string") slide.endsAt = raw.endsAt;
  if (typeof raw.graphicTitle === "string") slide.graphicTitle = raw.graphicTitle;
  if (typeof raw.graphicSubtitle === "string") {
    slide.graphicSubtitle = raw.graphicSubtitle;
  }
  if (isRecord(raw.slideLink)) {
    slide.slideLink = raw.slideLink as PromoSlideConfigItem["slideLink"];
  }
  if (isRecord(raw.titleLink)) {
    slide.titleLink = raw.titleLink as PromoSlideConfigItem["titleLink"];
  }
  return slide;
}

export function asPromoConfig(raw: unknown): PromoSliderConfig {
  if (isRecord(raw) && raw.type === "promo_slider" && Array.isArray(raw.slides)) {
    return {
      type: "promo_slider",
      slides: raw.slides.map((slide, index) =>
        normalizeAdminSlide(slide, `slide_${index}`)
      ),
    };
  }
  return defaultConfig("promo_slider") as PromoSliderConfig;
}

export function isoToDatetimeLocal(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function datetimeLocalToIso(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function centsToInput(cents?: number): string {
  if (cents === undefined || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

export function inputToCents(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return "";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function asGridConfig(raw: unknown): ProductGridConfig {
  if (isRecord(raw) && raw.type === "product_grid") {
    return {
      type: "product_grid",
      source: raw.source === "category" ? "category" : "featured",
      categoryId: typeof raw.categoryId === "string" ? raw.categoryId : undefined,
      limit: typeof raw.limit === "number" && Number.isFinite(raw.limit) ? raw.limit : 8,
    };
  }
  return defaultConfig("product_grid") as ProductGridConfig;
}

export function asCtaConfig(raw: unknown): CategoryCtaConfig {
  if (isRecord(raw) && raw.type === "category_cta" && Array.isArray(raw.buttons)) {
    return raw as CategoryCtaConfig;
  }
  return defaultConfig("category_cta") as CategoryCtaConfig;
}

export function asFeedConfig(raw: unknown): ProductFeedConfig {
  if (isRecord(raw) && raw.type === "product_feed") {
    return {
      type: "product_feed",
      pageSize:
        typeof raw.pageSize === "number" && Number.isFinite(raw.pageSize)
          ? raw.pageSize
          : 12,
    };
  }
  return defaultConfig("product_feed") as ProductFeedConfig;
}

export function blockNeedsRepair(block: HomepageAdminBlock): boolean {
  if (block.needsRepair) return true;
  const config = block.config;
  if (!isRecord(config) || config.type !== block.blockType) return true;
  return false;
}

export function blockSummary(block: HomepageAdminBlock): string {
  if (blockNeedsRepair(block)) return "Needs repair";
  switch (block.blockType) {
    case "promo_slider": {
      const n = asPromoConfig(block.config).slides.length;
      return n === 1 ? "1 slide" : `${n} slides`;
    }
    case "product_grid": {
      const cfg = asGridConfig(block.config);
      const source = cfg.source === "featured" ? "Featured" : "Category";
      return `${source} · ${cfg.limit} products`;
    }
    case "category_cta": {
      const cfg = asCtaConfig(block.config);
      const n = cfg.buttons.length;
      return cfg.title?.trim() || (n === 1 ? "1 button" : `${n} buttons`);
    }
    case "product_feed": {
      return `Page size ${asFeedConfig(block.config).pageSize}`;
    }
  }
}

export function normalizeBlocks(
  blocks: HomepageAdminBlock[]
): HomepageAdminBlock[] {
  return [...blocks].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });
}

export function feedIsLast(blocks: HomepageAdminBlock[]): boolean {
  const sorted = normalizeBlocks(blocks);
  const feeds = sorted.filter((b) => b.blockType === "product_feed");
  if (feeds.length > 1) return false;
  if (feeds.length === 1) {
    const last = sorted[sorted.length - 1];
    return last?.id === feeds[0]?.id;
  }
  return true;
}

export function flattenCategories(
  tree: CategoryNode[]
): Array<{ id: string; name: string; slug: string; depth: number; label: string }> {
  const result: Array<{
    id: string;
    name: string;
    slug: string;
    depth: number;
    label: string;
  }> = [];

  const walk = (nodes: CategoryNode[], depth: number) => {
    for (const node of nodes) {
      result.push({
        id: node.id,
        name: node.name,
        slug: node.slug,
        depth,
        label: `${"— ".repeat(Math.max(0, depth))}${node.name}`,
      });
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, depth + 1);
      }
    }
  };

  walk(tree, 0);
  return result;
}

export { BLOCK_TYPE_LABELS };
