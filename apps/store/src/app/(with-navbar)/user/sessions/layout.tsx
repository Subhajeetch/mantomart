import config from "@/mine.config";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `Manage Sessions — ${config.brandName}`,
  description: `See the devices signed in to your ${config.brandName} account and sign out sessions you don't recognize.`,
  robots: { index: false, follow: true },
};

export default function SessionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}