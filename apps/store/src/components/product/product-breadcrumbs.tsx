import Link from 'next/link';

import type { PublicProduct } from './types';

type ProductBreadcrumbsProps = {
  product: PublicProduct;
};

export function ProductBreadcrumbs({ product }: ProductBreadcrumbsProps) {
  const crumbs = [
    { href: '/', name: 'Home' },
    ...product.breadcrumbs.map((crumb) => ({
      href: crumb.href,
      name: crumb.name,
    })),
  ];

  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-xs text-foreground/55">
      <ol className="flex flex-wrap items-center gap-1">
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.href}-${crumb.name}`} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden>/</span> : null}
            <Link href={crumb.href} className="hover:text-foreground hover:underline">
              {crumb.name}
            </Link>
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span aria-hidden>/</span>
          <span className="line-clamp-1 text-foreground/80" aria-current="page">
            {product.name}
          </span>
        </li>
      </ol>
    </nav>
  );
}
