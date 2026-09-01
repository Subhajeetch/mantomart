import Link from 'next/link';

export default function ProductNotFound() {
  return (
    <section className="mx-auto max-w-lg px-4 py-20 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        Product not found
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This product is unavailable or no longer listed.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-10 items-center justify-center bg-foreground px-4 text-sm font-medium text-background"
      >
        Continue shopping
      </Link>
    </section>
  );
}
