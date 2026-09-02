import { ProductCard } from "./product-card";
import type { PublicProductGridBlock } from "./types";

type ProductGridProps = {
  block: PublicProductGridBlock;
};

export function ProductGrid({ block }: ProductGridProps) {
  const heading =
    block.config.source === "category" && block.config.categoryName
      ? block.config.categoryName
      : "Featured products";
  const products = Array.isArray(block.products) ? block.products : [];

  if (products.length === 0) {
    return (
      <section aria-labelledby={`grid-${block.id}-heading`} className="px-4 py-8">
        <h2
          id={`grid-${block.id}-heading`}
          className="mb-4 text-lg font-semibold tracking-tight"
        >
          {heading}
        </h2>
        <p className="text-sm text-muted-foreground">
          No products to show in this collection yet.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby={`grid-${block.id}-heading`} className="px-4 py-8 mx-auto max-w-7xl">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2
          id={`grid-${block.id}-heading`}
          className="text-lg font-semibold tracking-tight sm:text-xl"
        >
          {heading}
        </h2>
        {block.config.categorySlug ? (
          <a
            href={`/category/${block.config.categorySlug}`}
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Shop all
          </a>
        ) : null}
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:gap-4">
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}
