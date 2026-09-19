import type { Metadata } from 'next';
import config from '@/mine.config';

export const metadata: Metadata = {
  title: `Search — ${config.brandName}`,
  description: `Search is coming soon to ${config.brandName}.`,
};

export default function SearchPage() {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-6xl items-center justify-center px-4 py-16 text-center sm:px-6">
      <section aria-labelledby="search-coming-soon">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Search
        </p>
        <h1
          id="search-coming-soon"
          className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Coming soon
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
          We&apos;re working on a better way to help you find your next
          favorite product.
        </p>
      </section>
    </main>
  );
}
