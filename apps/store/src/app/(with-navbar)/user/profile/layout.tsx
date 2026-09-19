import config from "@/mine.config";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `Your Profile — ${config.brandName}`,
  description: `View and update your personal details, preferences, and account settings on ${config.brandName}.`,
  robots: { index: false, follow: true },
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}