import type { Metadata } from "next";

import config from "@/mine.config";
import { LegalDocument } from "../legal-document";

const title = "Privacy Policy";
const canonicalUrl = `${config.storeFrontURI}/imp/privacy-policy`;
const sections = [
  { id: "information-collect", title: "Information We Collect" },
  { id: "how-we-use", title: "How We Use Your Information" },
  { id: "sharing", title: "Sharing of Information" },
  { id: "cookies", title: "Cookies" },
  { id: "data-retention", title: "Data Retention" },
  { id: "data-security", title: "Data Security" },
  { id: "your-rights", title: "Your Rights" },
  { id: "international-transfer", title: "International Shipping & Data Transfer" },
  { id: "childrens-privacy", title: "Children's Privacy" },
  { id: "changes", title: "Changes to This Policy" },
  { id: "contact", title: "Contact Us" },
];

export const metadata: Metadata = {
  title: `${title} | ${config.brandName}`,
  description:
    "Learn how Mantomart collects, uses, shares, and protects personal information when you use our website or place an order.",
  alternates: { canonical: canonicalUrl },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: canonicalUrl,
    title: `${title} | ${config.brandName}`,
    description:
      "The Mantomart Privacy Policy explains how your personal information is handled and the choices available to you.",
    siteName: config.brandName,
  },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      title={title}
      description="This policy explains what information Mantomart collects, how we use it, and the choices you have when you use our website."
      updated="September 28, 2026"
      sections={sections}
      relatedHref="/imp/terms-of-service"
      relatedLabel="Terms of Service"
    >
      <section
        id="information-collect"
        aria-labelledby="information-collect-heading"
      >
        <h2
          id="information-collect-heading"
          className="text-xl font-semibold tracking-tight"
        >
          1. Information We Collect
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-muted-foreground">
          <li>
            <strong>Account Information:</strong> name, email address, password
            (encrypted), phone number.
          </li>
          <li>
            <strong>Order Information:</strong> shipping address, billing
            details, order history.
          </li>
          <li>
            <strong>Payment Information:</strong> payments are processed via
            PayPal. We do not store your full card or PayPal account
            credentials — payment data is handled directly by PayPal under its
            own privacy policy.
          </li>
          <li>
            <strong>Automatically Collected Data:</strong> IP address, browser
            type, device information, and cookies for site functionality and
            analytics.
          </li>
        </ul>
      </section>

      <section id="how-we-use" aria-labelledby="how-we-use-heading">
        <h2
          id="how-we-use-heading"
          className="text-xl font-semibold tracking-tight"
        >
          2. How We Use Your Information
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-muted-foreground">
          <li>
            To process and fulfil your orders, including sharing necessary
            shipping details (name, address, contact number) with our
            fulfilment/logistics partners to deliver your product.
          </li>
          <li>
            To communicate with you about orders, support tickets, and account
            activity.
          </li>
          <li>
            To improve our Site, prevent fraud, and comply with legal
            obligations.
          </li>
          <li>
            We do <strong>not</strong> sell your personal data to third parties.
          </li>
        </ul>
      </section>

      <section id="sharing" aria-labelledby="sharing-heading">
        <h2 id="sharing-heading" className="text-xl font-semibold tracking-tight">
          3. Sharing of Information
        </h2>
        <p className="mt-3">We share limited necessary information with:</p>
        <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-muted-foreground">
          <li>
            <strong>Payment processors</strong> (PayPal) to complete
            transactions.
          </li>
          <li>
            <strong>Third-party suppliers/fulfilment partners</strong> solely
            to ship your order to you.
          </li>
          <li>
            <strong>Service providers</strong> (hosting, analytics, email) who
            help us operate the Site, under confidentiality obligations.
          </li>
        </ul>
        <p className="mt-3">
          We do not share your data for third-party marketing purposes.
        </p>
      </section>

      <section id="cookies" aria-labelledby="cookies-heading">
        <h2 id="cookies-heading" className="text-xl font-semibold tracking-tight">
          4. Cookies
        </h2>
        <p className="mt-3">
          We use cookies to keep you logged in, remember cart items, and
          analyze site traffic. You can disable cookies in your browser, though
          some features may not work properly.
        </p>
      </section>

      <section id="data-retention" aria-labelledby="data-retention-heading">
        <h2
          id="data-retention-heading"
          className="text-xl font-semibold tracking-tight"
        >
          5. Data Retention
        </h2>
        <p className="mt-3">
          We retain your account and order data as long as your account is
          active or as needed to comply with legal, tax, and dispute-resolution
          obligations.
        </p>
      </section>

      <section id="data-security" aria-labelledby="data-security-heading">
        <h2
          id="data-security-heading"
          className="text-xl font-semibold tracking-tight"
        >
          6. Data Security
        </h2>
        <p className="mt-3">
          We use reasonable technical and organizational measures to protect
          your data. However, no online system is 100% secure, and we cannot
          guarantee absolute security.
        </p>
      </section>

      <section id="your-rights" aria-labelledby="your-rights-heading">
        <h2
          id="your-rights-heading"
          className="text-xl font-semibold tracking-tight"
        >
          7. Your Rights
        </h2>
        <p className="mt-3">
          You may request to access, correct, or delete your personal data by
          contacting us at{" "}
          <a
            href="mailto:contact@mantomart.com"
            className="font-medium underline underline-offset-4 hover:text-primary"
          >
            contact@mantomart.com
          </a>
          . We will respond within a reasonable timeframe.
        </p>
      </section>

      <section
        id="international-transfer"
        aria-labelledby="international-transfer-heading"
      >
        <h2
          id="international-transfer-heading"
          className="text-xl font-semibold tracking-tight"
        >
          8. International Shipping &amp; Data Transfer
        </h2>
        <p className="mt-3">
          Products are sourced and shipped internationally by third-party
          suppliers. As a result, your shipping information may be transferred
          outside your country and India to facilitate delivery.
        </p>
      </section>

      <section
        id="childrens-privacy"
        aria-labelledby="childrens-privacy-heading"
      >
        <h2
          id="childrens-privacy-heading"
          className="text-xl font-semibold tracking-tight"
        >
          9. Children&apos;s Privacy
        </h2>
        <p className="mt-3">
          The Site is not intended for users under 18. We do not knowingly
          collect data from minors.
        </p>
      </section>

      <section id="changes" aria-labelledby="changes-heading">
        <h2 id="changes-heading" className="text-xl font-semibold tracking-tight">
          10. Changes to This Policy
        </h2>
        <p className="mt-3">
          We may update this Privacy Policy from time to time. Continued use of
          the Site after changes means you accept the updated policy.
        </p>
      </section>

      <section id="contact" aria-labelledby="contact-heading">
        <h2 id="contact-heading" className="text-xl font-semibold tracking-tight">
          11. Contact Us
        </h2>
        <p className="mt-3">
          For any privacy-related questions, contact us at{" "}
          <a
            href="mailto:contact@mantomart.com"
            className="font-medium underline underline-offset-4 hover:text-primary"
          >
            contact@mantomart.com
          </a>
          .
        </p>
      </section>
    </LegalDocument>
  );
}
