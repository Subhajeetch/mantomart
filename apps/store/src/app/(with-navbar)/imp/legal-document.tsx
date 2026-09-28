import Link from "next/link";

type LegalSection = {
  id: string;
  title: string;
};

type LegalDocumentProps = {
  title: string;
  description: string;
  updated: string;
  sections: LegalSection[];
  children: React.ReactNode;
  relatedHref: string;
  relatedLabel: string;
};

export function LegalDocument({
  title,
  description,
  updated,
  sections,
  children,
  relatedHref,
  relatedLabel,
}: LegalDocumentProps) {
  return (
    <article className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-8 text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="hover:text-foreground hover:underline">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href="/imp"
              className="hover:text-foreground hover:underline"
            >
              Legal information
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">
            {title}
          </li>
        </ol>
      </nav>

      <header className="border-b border-border pb-8 sm:pb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Mantomart · Legal
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
          {description}
        </p>
        <p className="mt-5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Last updated:</span>{" "}
          <time dateTime="2026-09-28">{updated}</time>
        </p>
      </header>

      <div className="grid gap-10 py-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-14">
        <div className="order-2 min-w-0 space-y-10 text-sm leading-7 text-foreground sm:text-base lg:order-1">
          {children}
          <nav
            aria-label="Related legal document"
            className="border-t border-border pt-6 text-sm"
          >
            <span className="text-muted-foreground">
              Also see:{" "}
              <Link
                href={relatedHref}
                className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
              >
                {relatedLabel}
              </Link>
            </span>
          </nav>
        </div>

        <aside className="order-1 h-fit border border-border bg-muted/30 p-5 lg:sticky lg:top-24 lg:order-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em]">
            On this page
          </h2>
          <nav aria-label="On this page">
            <ol className="mt-4 space-y-2.5">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="flex gap-3 text-sm leading-5 text-muted-foreground hover:text-foreground"
                  >
                    <span aria-hidden="true" className="tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
      </div>
    </article>
  );
}
