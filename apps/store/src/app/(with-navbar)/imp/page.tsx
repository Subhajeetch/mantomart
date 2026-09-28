import Link from "next/link";
import type { Metadata } from "next";

import config from "@/mine.config";

export const metadata: Metadata = {
  title: `Legal Information | ${config.brandName}`,
  description:
    "Find the Mantomart Terms of Service and Privacy Policy, including information about orders, refunds, and personal data.",
  alternates: { canonical: `${config.storeFrontURI}/imp` },
  robots: { index: true, follow: true },
};

const documents = [
  {
    href: "/imp/terms-of-service",
    title: "Terms of Service",
    description:
      "Review the terms for using Mantomart, placing orders, shipping, payments, cancellations, and refunds.",
  },
  {
    href: "/imp/privacy-policy",
    title: "Privacy Policy",
    description:
      "Learn how Mantomart collects, uses, shares, and protects your personal information.",
  },
];

export default function LegalInformationPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
      <header className="max-w-3xl border-b border-border pb-8 sm:pb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Mantomart · Legal
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Legal information
        </h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          Important information about using {config.brandName} and how we
          handle your personal information.
        </p>
      </header>
      <nav aria-label="Legal documents" className="mt-8 grid gap-4 sm:grid-cols-2">
        {documents.map((document) => (
          <Link
            key={document.href}
            href={document.href}
            className="group border border-border p-6 transition-colors hover:border-foreground/30 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <h2 className="text-lg font-semibold tracking-tight group-hover:underline group-hover:underline-offset-4">
              {document.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {document.description}
            </p>
            <span className="mt-5 inline-block text-sm font-medium">
              Read document <span aria-hidden="true">→</span>
            </span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
