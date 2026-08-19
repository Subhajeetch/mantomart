import type {
  CategoryNode,
  HomepageAdminBlock,
  HomepageBlockConfig,
  HomepageBlockType,
  PromoSliderConfig,
  ProductGridConfig,
  CategoryCtaConfig,
  ProductFeedConfig,
} from "./types";
import { BLOCK_TYPE_LABELS } from "./types";

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

export function asPromoConfig(raw: unknown): PromoSliderConfig {
  if (isRecord(raw) && raw.type === "promo_slider" && Array.isArray(raw.slides)) {
    return raw as PromoSliderConfig;
  }
  return defaultConfig("promo_slider") as PromoSliderConfig;
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
