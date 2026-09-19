import config from "@/mine.config";
import type { Metadata } from "next";
import { UserStubPage } from "../stub-page";

export const metadata: Metadata = {
  title: `Notifications — ${config.brandName}`,
  description: `Manage your notification preferences and stay up to date on order updates, offers, and news from ${config.brandName}.`,
  robots: { index: false, follow: true },
};

export default function NotificationsPage() {
  return (
    <UserStubPage
      eyebrow="Preferences"
      title="Notifications"
      description="Manage your notification preferences and updates."
    />
  );
}
