export type HeaderNavItem = {
  id: string;
  name: string;
  slug: string;
  /**
   * Resolved navigation target from the API.
   * Null when the node is a pure grouping label with no destination.
   */
  href: string | null;
  position: number;
  featured: boolean;
  /** Nested subcategories under this item (e.g. Men → Shirts). */
  children: HeaderNavItem[];
};

export type HeaderNavCollection = {
  id: string;
  name: string;
  slug: string;
  /**
   * Resolved navigation target for the top tab.
   * Null when the tab is only a mega-menu container.
   */
  href: string | null;
  position: number;
  /**
   * First-level children of the root category.
   * Rendered as columns in the mega menu (e.g. Men | Women).
   */
  items: HeaderNavItem[];
};

export type HeaderNavResponse = {
  success: true;
  data: {
    collections: HeaderNavCollection[];
    updatedAt: string | null;
    cachedAt: string;
  };
  meta?: {
    maxVisibleCollections?: number;
    cacheTtlSeconds?: number;
    source?: string;
  };
};

export type HeaderNavErrorResponse = {
  success: false;
  error?: string;
  message?: string;
  code?: string;
};
