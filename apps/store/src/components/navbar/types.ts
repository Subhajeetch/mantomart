export type HeaderNavItem = {
  id: string;
  name: string;
  slug: string;
  href: string;
  description: string | null;
  image: string | null;
  position: number;
  featured: boolean;
};

export type HeaderNavCollection = {
  id: string;
  name: string;
  slug: string;
  href: string;
  description: string | null;
  image: string | null;
  position: number;
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
