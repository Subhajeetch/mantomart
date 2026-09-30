import type { Metadata } from 'next';
import config from '@/mine.config';
import OrdersList from './orders-list';

export const metadata: Metadata = {
  title: `Your Orders — ${config.brandName}`,
  description: `View and track your orders from ${config.brandName}.`,
  robots: { index: false, follow: true },
};

export default function OrdersPage() {
  return <OrdersList />;
}
