import type { Metadata } from 'next';
import config from '@/mine.config';

export const metadata: Metadata = {
  title: `Saved Addresses — ${config.brandName}`,
  description: `View, add, and manage the delivery addresses saved to your ${config.brandName} account.`,
  robots: { index: false, follow: true },
};

export default function AddressesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
