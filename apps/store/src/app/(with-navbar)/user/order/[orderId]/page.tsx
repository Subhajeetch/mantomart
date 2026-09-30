import type { Metadata } from 'next';
import config from '@/mine.config';
import OrderDetail from './order-detail';

export const metadata: Metadata = {
  title: `Order details — ${config.brandName}`,
  description: `View your order details from ${config.brandName}.`,
  robots: { index: false, follow: true },
};

export default function OrderPage() {
  return <OrderDetail />;
}
