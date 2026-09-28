import type { Metadata } from "next";

import config from "@/mine.config";
import { LegalDocument } from "../legal-document";

const title = "Terms of Service";
const canonicalUrl = `${config.storeFrontURI}/imp/terms-of-service`;
const sections = [
  { id: "about-us", title: "About Us" },
  { id: "orders-pricing", title: "Orders & Pricing" },
  { id: "shipping-delivery", title: "Shipping & Delivery" },
  { id: "payments", title: "Payments" },
  { id: "cancellations-refunds", title: "Cancellations & Refunds" },
  { id: "product-descriptions", title: "Product Descriptions" },
  { id: "user-accounts", title: "User Accounts" },
  { id: "limitation-liability", title: "Limitation of Liability" },
  { id: "intellectual-property", title: "Intellectual Property" },
  { id: "governing-law", title: "Governing Law" },
  { id: "changes", title: "Changes to These Terms" },
  { id: "contact", title: "Contact Us" },
];

export const metadata: Metadata = {
  title: `${title} | ${config.brandName}`,
  description:
    "Read the Mantomart Terms of Service for information about orders, shipping, payments, cancellations, refunds, and use of our online store.",
  alternates: { canonical: canonicalUrl },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: canonicalUrl,
    title: `${title} | ${config.brandName}`,
    description:
      "The terms and conditions that apply when you use the Mantomart website and place an order.",
    siteName: config.brandName,
  },
};

export default function TermsOfServicePage() {
  return (
    <LegalDocument
      title={title}
      description="Please read these terms carefully before using the Mantomart website or placing an order."
      updated="September 28, 2026"
      sections={sections}
      relatedHref="/imp/privacy-policy"
      relatedLabel="Privacy Policy"
    >
      <section id="about-us" aria-labelledby="about-us-heading">
        <h2 id="about-us-heading" className="text-xl font-semibold tracking-tight">
          1. About Us
        </h2>
        <p className="mt-3">
          Mantomart is operated from India. We curate and sell products sourced
          from third-party international suppliers and manufacturers. We are
          not the manufacturer of the products listed.
        </p>
      </section>

      <section id="orders-pricing" aria-labelledby="orders-pricing-heading">
        <h2 id="orders-pricing-heading" className="text-xl font-semibold tracking-tight">
          2. Orders &amp; Pricing
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-muted-foreground">
          <li>
            All product listings, descriptions, and prices on the Site are set
            by Mantomart and may differ from prices found on other platforms.
          </li>
          <li>
            We reserve the right to refuse, cancel, or limit any order at our
            discretion, including due to pricing errors, stock unavailability,
            or suspected fraud.
          </li>
          <li>
            Order confirmation does not guarantee product availability; we will
            notify you if an item cannot be fulfilled and issue a refund for
            that item.
          </li>
        </ul>
      </section>

      <section id="shipping-delivery" aria-labelledby="shipping-delivery-heading">
        <h2 id="shipping-delivery-heading" className="text-xl font-semibold tracking-tight">
          3. Shipping &amp; Delivery
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-muted-foreground">
          <li>
            Products are shipped directly by our third-party suppliers from
            their location of origin, which may be international.
          </li>
          <li>
            Delivery times are estimates only and may vary due to customs,
            logistics, or supplier processing time. We are not liable for delays
            caused by shipping carriers, customs authorities, or suppliers
            beyond our control.
          </li>
          <li>Risk of loss passes to the customer upon delivery to the address provided.</li>
        </ul>
      </section>

      <section id="payments" aria-labelledby="payments-heading">
        <h2 id="payments-heading" className="text-xl font-semibold tracking-tight">
          4. Payments
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-muted-foreground">
          <li>
            We accept payments via PayPal. By placing an order, you authorize
            us to charge the listed price through PayPal.
          </li>
          <li>
            All prices are in the currency displayed at checkout and are
            inclusive/exclusive of taxes as noted at checkout.
          </li>
        </ul>
      </section>

      <section
        id="cancellations-refunds"
        aria-labelledby="cancellations-refunds-heading"
      >
        <h2
          id="cancellations-refunds-heading"
          className="text-xl font-semibold tracking-tight"
        >
          5. Cancellations &amp; Refunds
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-muted-foreground">
          <li>
            <strong>Cancellations:</strong> Orders may be cancelled only before
            they are processed for fulfilment. Once processing has begun,
            orders cannot be cancelled.
          </li>
          <li>
            <strong>No General Refunds:</strong> We do not offer refunds for
            change of mind, incorrect orders placed by the customer, or
            delivery delays.
          </li>
          <li>
            <strong>Damaged Products:</strong> If you receive a damaged product,
            you must raise a support ticket from your account profile with
            photo/video evidence. Our team will verify the claim.
            <ul className="mt-2 list-[circle] space-y-2 pl-6 marker:text-muted-foreground">
              <li>
                If verified, we will send a replacement of the same product at
                no additional cost.
              </li>
              <li>
                If the replacement also arrives damaged, we will issue a full
                refund for that item.
              </li>
            </ul>
          </li>
          <li>
            Refund decisions are made solely at our discretion based on the
            evidence provided.
          </li>
        </ul>
      </section>

      <section
        id="product-descriptions"
        aria-labelledby="product-descriptions-heading"
      >
        <h2
          id="product-descriptions-heading"
          className="text-xl font-semibold tracking-tight"
        >
          6. Product Descriptions
        </h2>
        <p className="mt-3">
          We strive for accuracy in product titles, images, and descriptions,
          but we do not warrant that all details are error-free, complete, or
          current. Minor variations in color, size, or packaging may occur due
          to supplier differences.
        </p>
      </section>

      <section id="user-accounts" aria-labelledby="user-accounts-heading">
        <h2 id="user-accounts-heading" className="text-xl font-semibold tracking-tight">
          7. User Accounts
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 marker:text-muted-foreground">
          <li>You must provide accurate information when creating an account and placing orders.</li>
          <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
          <li>
            We reserve the right to suspend or terminate accounts involved in
            fraud, abuse, or violation of these Terms.
          </li>
        </ul>
      </section>

      <section
        id="limitation-liability"
        aria-labelledby="limitation-liability-heading"
      >
        <h2
          id="limitation-liability-heading"
          className="text-xl font-semibold tracking-tight"
        >
          8. Limitation of Liability
        </h2>
        <p className="mt-3">
          To the maximum extent permitted by law, Mantomart shall not be liable
          for any indirect, incidental, or consequential damages arising from
          use of the Site or products purchased, including but not limited to
          shipping delays, customs issues, or third-party supplier errors. Our
          total liability for any claim shall not exceed the amount paid for
          the relevant order.
        </p>
      </section>

      <section
        id="intellectual-property"
        aria-labelledby="intellectual-property-heading"
      >
        <h2
          id="intellectual-property-heading"
          className="text-xl font-semibold tracking-tight"
        >
          9. Intellectual Property
        </h2>
        <p className="mt-3">
          All content on the Site, including logos, design, and original
          product descriptions, is owned by Mantomart and may not be copied or
          reproduced without permission.
        </p>
      </section>

      <section id="governing-law" aria-labelledby="governing-law-heading">
        <h2 id="governing-law-heading" className="text-xl font-semibold tracking-tight">
          10. Governing Law
        </h2>
        <p className="mt-3">
          These Terms are governed by the laws of India. Any disputes shall be
          subject to the exclusive jurisdiction of the courts of India.
        </p>
      </section>

      <section id="changes" aria-labelledby="changes-heading">
        <h2 id="changes-heading" className="text-xl font-semibold tracking-tight">
          11. Changes to These Terms
        </h2>
        <p className="mt-3">
          We may revise these Terms at any time. Continued use of the Site
          after changes constitutes acceptance of the updated Terms.
        </p>
      </section>

      <section id="contact" aria-labelledby="contact-heading">
        <h2 id="contact-heading" className="text-xl font-semibold tracking-tight">
          12. Contact Us
        </h2>
        <p className="mt-3">
          For questions regarding these Terms, contact us at{" "}
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
