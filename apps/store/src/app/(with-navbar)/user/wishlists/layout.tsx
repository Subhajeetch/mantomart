import config from "@/mine.config";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `Your Wishlists — ${config.brandName}`,
  description: `Create and manage your wishlists to save and shop products you love across ${config.brandName}.`,
  robots: { index: false, follow: true },
};

export default function WishlistsLayout({ children }: { children: React.ReactNode }) {
  return children;
}