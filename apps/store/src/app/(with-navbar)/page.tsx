import type { Metadata } from "next";

import { getHeaderNav } from "@/components/navbar";
import {
  CategoryCta,
  getHomepage,
  ProductFeed,
  ProductGrid,
  PromoSlider,
  SeoFooter,
} from "@/components/homepage";

export const revalidate = 5 * 24 * 60 * 60;

export const metadata: Metadata = {
  title: "RagiMart — Shop fashion, electronics, and more",
  description:
    "Discover featured products, shop by category, and find deals on fashion and electronics at RagiMart.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "RagiMart — Shop fashion, electronics, and more",
    description:
      "Discover featured products, shop by category, and find deals on fashion and electronics at RagiMart.",
    type: "website",
  },
};

export default async function Home() {
  const [blocks, collections] = await Promise.all([
    getHomepage(),
    getHeaderNav(),
  ]);

  return (
    <>
      <h1 className="sr-only">RagiMart online store</h1>
      {blocks.length === 0 ? (
        <section className="px-4 py-16 text-center">
          <p className="text-lg font-medium">Welcome to RagiMart</p>
          <p className="mt-2 text-sm text-muted-foreground">
            New collections are on the way.
          </p>
        </section>
      ) : (
        blocks.map((block) => {
          switch (block.blockType) {
            case "promo_slider":
              return <PromoSlider key={block.id} block={block} />;
            case "product_grid":
              return <ProductGrid key={block.id} block={block} />;
            case "category_cta":
              return <CategoryCta key={block.id} block={block} />;
            case "product_feed":
              return <ProductFeed key={block.id} block={block} />;
            default:
              return null;
          }
        })
      )}
      <SeoFooter collections={collections} />
    </>
  );
}
