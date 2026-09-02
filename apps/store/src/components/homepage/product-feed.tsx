"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchFeedPage } from "./api";
import { ProductCard, ProductCardSkeleton } from "./product-card";
import type { PublicProductCard, PublicProductFeedBlock } from "./types";

type ProductFeedProps = {
  block: PublicProductFeedBlock;
};

export function ProductFeed({ block }: ProductFeedProps) {
  const initialItems = Array.isArray(block.items) ? block.items : [];
  const [items, setItems] = useState<PublicProductCard[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(block.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef(false);
  const seenIds = useRef(new Set(initialItems.map((item) => item.id)));
  const generation = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pageSize = block.config.pageSize;

  const loadMore = useCallback(async () => {
    if (inFlight.current || !cursor) return;
    inFlight.current = true;
    const gen = generation.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchFeedPage(cursor, pageSize);
      if (gen !== generation.current) return;
      const next: PublicProductCard[] = [];
      for (const item of page.items) {
        if (seenIds.current.has(item.id)) continue;
        seenIds.current.add(item.id);
        next.push(item);
      }
      if (next.length > 0) {
        setItems((prev) => [...prev, ...next]);
      }
      setCursor(page.nextCursor);
    } catch {
      if (gen !== generation.current) return;
      setError("Could not load more products.");
    } finally {
      if (gen === generation.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [cursor, pageSize]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: "480px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  return (
    <section aria-labelledby={`feed-${block.id}-heading`} className="px-4 py-8 mx-auto max-w-7xl">
      <h2
        id={`feed-${block.id}-heading`}
        className="mb-4 text-lg font-semibold tracking-tight sm:text-xl"
      >
        More to shop
      </h2>
      {items.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground">
          No products published yet.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:gap-4">
          {items.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} />
            </li>
          ))}
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <li key={`sk-${i}`}>
                  <ProductCardSkeleton />
                </li>
              ))
            : null}
        </ul>
      )}
      {error ? (
        <p className="mt-3 text-center text-sm text-destructive">{error}</p>
      ) : null}
      <div ref={sentinelRef} className="h-8" aria-hidden />
      {!cursor && items.length > 0 ? (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          You’ve reached the end.
        </p>
      ) : null}
    </section>
  );
}
