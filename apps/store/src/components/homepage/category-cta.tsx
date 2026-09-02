import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PublicCategoryCtaBlock } from "./types";

type CategoryCtaProps = {
  block: PublicCategoryCtaBlock;
};

export function CategoryCta({ block }: CategoryCtaProps) {
  const buttons = (block.config.buttons ?? []).filter((btn) => btn.href);
  const title = block.config.title?.trim() || "Shop by category";
  const subtitle = block.config.subtitle?.trim();

  if (buttons.length === 0) return null;

  const twoCol = buttons.length === 2;

  return (
    <section
      aria-labelledby={`cta-${block.id}-heading`}
      className="px-4 py-10 mx-auto max-w-7xl"
    >
      <div className="mx-auto max-w-4xl text-center">
        <h2
          id={`cta-${block.id}-heading`}
          className="text-xl font-semibold tracking-tight sm:text-2xl"
        >
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
        <ul
          className={cn(
            "mt-6 grid gap-3",
            twoCol ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3"
          )}
        >
          {buttons.map((btn) => (
            <li key={btn.id}>
              <Link
                href={btn.href || `/category/${btn.categorySlug ?? ""}`}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-auto w-full min-h-12 px-4 py-3 text-sm font-semibold uppercase tracking-wide"
                )}
              >
                {btn.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
