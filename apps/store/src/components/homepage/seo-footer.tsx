import Link from "next/link";

import type { HeaderNavCollection } from "@/components/navbar";

type SeoFooterProps = {
  collections: HeaderNavCollection[];
};

export function SeoFooter({ collections }: SeoFooterProps) {
  const year = new Date().getFullYear();
  const safeCollections = Array.isArray(collections) ? collections : [];

  return (
    <footer className="border-t bg-muted/30 px-4 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-sm font-semibold tracking-wide uppercase">
            RagiMart
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Shop fashion, electronics, and everyday essentials.
          </p>
        </div>
        {safeCollections.slice(0, 3).map((collection) => (
          <nav
            key={collection.id}
            aria-label={collection.name}
            className="text-sm"
          >
            <p className="font-semibold">{collection.name}</p>
            <ul className="mt-2 space-y-1">
              {(collection.items ?? []).slice(0, 8).map((item) => {
                const href = item.href;
                if (!href) {
                  return (
                    <li key={item.id} className="text-muted-foreground">
                      {item.name}
                    </li>
                  );
                }
                return (
                  <li key={item.id}>
                    <Link
                      href={href}
                      className="text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {item.name}
                    </Link>
                  </li>
                );
              })}
              {collection.href ? (
                <li>
                  <Link
                    href={collection.href}
                    className="font-medium text-foreground hover:underline"
                  >
                    Shop {collection.name}
                  </Link>
                </li>
              ) : null}
            </ul>
          </nav>
        ))}
      </div>
      <p className="mx-auto mt-10 max-w-6xl text-xs text-muted-foreground">
        © {year} RagiMart. All rights reserved.
      </p>
    </footer>
  );
}
