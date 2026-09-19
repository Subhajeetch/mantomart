import config from "@/mine.config";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `Your Wishlist — ${config.brandName}`,
  description: `View and manage the products saved to this wishlist on ${config.brandName}.`,
  robots: { index: false, follow: true },
};

export default function WishlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}