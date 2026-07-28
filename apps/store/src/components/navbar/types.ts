export type HeaderNavItem = {
  id: string;
  name: string;
  slug: string;
  href: string;
  position: number;
  featured: boolean;
  /** Nested subcategories under this item (e.g. Men → Shirts). */
  children: HeaderNavItem[];
};

export type HeaderNavCollection = {
  id: string;
  name: string;
  slug: string;
  href: string;
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
};
