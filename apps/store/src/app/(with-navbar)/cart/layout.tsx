import config from "@/mine.config";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `Your Cart — ${config.brandName}`,
  description: `Review the items in your shopping bag, adjust quantities, and head to a secure checkout on ${config.brandName}.`,
  robots: { index: false, follow: true },
};

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return children;
}