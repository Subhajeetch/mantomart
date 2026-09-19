import config from "@/mine.config";
import type { Metadata } from "next";
import { UserStubPage } from "../stub-page";

export const metadata: Metadata = {
  title: `Saved Addresses — ${config.brandName}`,
  description: `View, add, and manage the delivery and billing addresses saved to your ${config.brandName} account.`,
  robots: { index: false, follow: true },
};

export default function AddressesPage() {
  return (
    <UserStubPage
      eyebrow="Account"
      title="Saved Addresses"
      description="Manage the addresses used for your deliveries."
    />
  );
}
