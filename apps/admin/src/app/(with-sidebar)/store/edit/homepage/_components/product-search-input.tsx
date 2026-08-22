"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { searchHomepageProducts } from "./api";
import type { HomepageProductHit } from "./types";
import { formatCents } from "./utils";

type ProductSearchInputProps = {
  disabled?: boolean;
  placeholder?: string;
  onSelect: (hit: HomepageProductHit) => void;
};

export function ProductSearchInput({
  disabled,
  placeholder = "Search published products…",
  onSelect,
}: ProductSearchInputProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<HomepageProductHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setBusy(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError(null);
      searchHomepageProducts(q, controller.signal)
        .then((hits) => {
          setResults(hits);
          setOpen(true);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setError(err instanceof Error ? err.message : "Search failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        className="pl-8"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
      />
      {busy ? (
        <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : null}
      {open && query.trim().length >= 2 ? (
        <div
          id={listId}
          role="listbox"
          className="mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1"
        >
          {error ? (
            <p className="px-2 py-2 text-xs text-destructive">{error}</p>
          ) : results.length === 0 && !busy ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              No published products match “{query.trim()}”.
            </p>
          ) : (
            results.map((hit) => (
              <button
                key={hit.id}
                type="button"
                role="option"
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted"
                )}
                onClick={() => {
                  onSelect(hit);
                  setQuery("");
                  setResults([]);
                  setOpen(false);
                }}
              >
                <div className="size-9 shrink-0 overflow-hidden bg-muted">
                  {hit.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={hit.imageUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{hit.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatCents(hit.price) || "No price"} · /{hit.slug}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
