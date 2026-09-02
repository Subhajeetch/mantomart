import Link from 'next/link';

import type { PublicProduct } from './types';

type ProductBreadcrumbsProps = {
  product: PublicProduct;
};

type Crumb = { href: string; name: string };

function isSafeInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

function buildCrumbs(product: PublicProduct): Crumb[] {
  const crumbs: Crumb[] = [{ href: '/', name: 'Home' }];
  const trail = Array.isArray(product.breadcrumbs) ? product.breadcrumbs : [];

  for (const crumb of trail) {
    if (!crumb) continue;
    const name = crumb.name?.trim();
    const href = crumb.href?.trim();
    if (!name || !href || !isSafeInternalHref(href)) continue;
    if (crumbs.some((entry) => entry.href === href)) continue;
    crumbs.push({ href, name });
  }

  return crumbs;
}

export function ProductBreadcrumbs({ product }: ProductBreadcrumbsProps) {
  if (!product) return null;

  const crumbs = buildCrumbs(product);
  const productName = product.name?.trim() || 'Product';

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 hidden text-xs text-foreground/55 md:block"
    >
      <ol className="flex flex-wrap items-center gap-1">
        {crumbs.map((crumb, index) => (
          <li
            key={`${crumb.href}-${crumb.name}-${index}`}
            className="flex items-center gap-1"
          >
            {index > 0 ? <span aria-hidden>/</span> : null}
            <Link
              href={crumb.href}
              className="hover:text-foreground hover:underline"
            >
              {crumb.name}
            </Link>
          </li>
        ))}
        <li className="flex min-w-0 items-center gap-1">
          <span aria-hidden>/</span>
          <span className="line-clamp-1 text-foreground/80" aria-current="page">
            {productName}
          </span>
        </li>
      </ol>
    </nav>
  );
}
