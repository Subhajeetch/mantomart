import config from "@/mine.config";
import type { Metadata } from "next";
import { UserStubPage } from "../stub-page";

export const metadata: Metadata = {
  title: `Your Orders — ${config.brandName}`,
  description: `Track, view, and manage the orders you've placed with ${config.brandName} in one place.`,
  robots: { index: false, follow: true },
};

export default function OrdersPage() {
  return (
    <UserStubPage
      eyebrow="Preferences"
      title="Orders"
      description="View and manage your orders."
    />
  );
}