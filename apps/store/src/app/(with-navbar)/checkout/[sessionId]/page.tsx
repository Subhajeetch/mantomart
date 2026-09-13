'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

type CheckoutItem = {
  id: string;
  quantity: number;
  unitPriceSnapshot: number;
  productNameSnapshot: string;
  variantLabelSnapshot: string | null;
  imageSnapshot: string | null;
};
type CheckoutData = { items: CheckoutItem[]; total: number; expiresAt: string };

function apiUrl(path: string) { return `${(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}${path}`; }
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export default function CheckoutPage() {
  const params = useParams<{ sessionId: string }>();
  const [data, setData] = useState<CheckoutData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(apiUrl(`/api/store/checkout/${encodeURIComponent(params.sessionId)}`), { credentials: 'include', cache: 'no-store' });
        const body = await response.json() as { success: boolean; data?: CheckoutData; error?: string };
        if (!response.ok || !body.success || !body.data) throw new Error(body.error ?? 'Unable to load checkout.');
        setData(body.data);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Unable to load checkout.');
      }
    };
    if (params.sessionId) void load();
  }, [params.sessionId]);

  if (error) return <main className="mx-auto max-w-3xl p-8"><div className="border border-red-200 bg-red-50 p-5 text-red-700">{error}</div></main>;
  if (!data) return <main className="mx-auto max-w-3xl p-8 text-center text-muted-foreground">Loading checkout…</main>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">You are buying:</h1>
      <p className="mt-2 text-sm text-muted-foreground">Review the products in this checkout session.</p>
      <section className="mt-6 space-y-3">
        {data.items.map((item) => (
          <article key={item.id} className="flex gap-4 border p-4">
            <div className="size-24 shrink-0 bg-muted">{item.imageSnapshot ? <img src={item.imageSnapshot} alt={item.productNameSnapshot} className="size-full object-cover" /> : null}</div>
            <div className="flex-1">
              <h2 className="font-medium">{item.productNameSnapshot}</h2>
              {item.variantLabelSnapshot ? <p className="mt-1 text-sm text-muted-foreground">{item.variantLabelSnapshot}</p> : null}
              <p className="mt-3 text-sm">Qty: {item.quantity}</p>
            </div>
            <strong>{money(item.unitPriceSnapshot * item.quantity)}</strong>
          </article>
        ))}
      </section>
      <div className="mt-6 flex items-center justify-between border-t pt-5 text-lg font-semibold"><span>Total</span><span>{money(data.total)}</span></div>
      <Button disabled className="mt-6 w-full rounded-none">PAYMENT COMING SOON</Button>
    </main>
  );
}
