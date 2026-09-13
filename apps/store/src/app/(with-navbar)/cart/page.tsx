'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '@/lib/auth-client';
import { getStoreLoginUrl } from '@/lib/app-urls';
import { Button } from '@/components/ui/button';
import { cacheCartSummary, getCart, removeCartItem, startCartCheckout, updateCartItem, type CartData } from './api';

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export default function CartPage() {
  const router = useRouter();
  const { data: session, isPending: authPending } = useSession();
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!session?.user?.id) {
      setCart(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setCart(await getCart());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load your cart.');
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('cart-updated', refresh);
    return () => window.removeEventListener('cart-updated', refresh);
  }, [load]);

  const selectedTotal = useMemo(() => cart?.summary.total ?? 0, [cart]);

  async function changeQuantity(itemId: string, quantity: number) {
    setBusyId(itemId);
    try {
      const result = await updateCartItem(itemId, quantity);
      cacheCartSummary(result.summary);
      window.dispatchEvent(new CustomEvent('cart-updated', { detail: result.summary }));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update the item.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(itemId: string) {
    setBusyId(itemId);
    try {
      const result = await removeCartItem(itemId);
      cacheCartSummary(result.summary);
      window.dispatchEvent(new CustomEvent('cart-updated', { detail: result.summary }));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to remove the item.');
    } finally {
      setBusyId(null);
    }
  }

  async function checkout() {
    setBusyId('checkout');
    try {
      const { sessionId } = await startCartCheckout();
      router.push(`/checkout/${encodeURIComponent(sessionId)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start checkout.');
    } finally {
      setBusyId(null);
    }
  }

  if (authPending || loading) return <main className="mx-auto max-w-6xl p-8 text-center text-sm text-muted-foreground">Loading your cart…</main>;
  if (!session?.user?.id) {
    return (
      <main className="mx-auto max-w-6xl p-8">
        <div className="mx-auto max-w-md border p-8 text-center">
          <h1 className="text-2xl font-semibold">Your cart</h1>
          <p className="mt-3 text-sm text-muted-foreground">Log in to view and manage your cart.</p>
          <Button className="mt-6 rounded-none" onClick={() => window.location.assign(getStoreLoginUrl(`${window.location.origin}/cart`))}>Log in</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold">Shopping Bag</h1>
      {error ? <p className="mt-4 border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {!cart?.items.length ? (
        <div className="mt-8 border p-10 text-center text-muted-foreground">Your cart is empty.</div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-3">
            <div className="flex items-center justify-between border-b pb-4 text-sm font-semibold">
              <span>{cart.summary.itemCount} ITEM{cart.summary.itemCount === 1 ? '' : 'S'}</span>
              <span>SELECTED</span>
            </div>
            {cart.items.map((item) => (
              <article key={item.id} className="flex gap-4 border p-3">
                <div className="size-32 shrink-0 bg-muted">
                  {item.imageSnapshot ? <img src={item.imageSnapshot} alt={item.productNameSnapshot} className="size-full object-cover" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-3">
                    <div>
                      <h2 className="line-clamp-2 font-medium">
                        <Link href={item.href} className="hover:underline">{item.productNameSnapshot}</Link>
                      </h2>
                      {item.variantLabelSnapshot ? <p className="mt-1 text-sm text-muted-foreground">{item.variantLabelSnapshot}</p> : null}
                    </div>
                    <button type="button" aria-label="Remove item" disabled={busyId === item.id} onClick={() => void remove(item.id)}><Trash2 className="size-5" /></button>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <div className="inline-flex items-center border">
                      <button type="button" className="p-2" disabled={busyId === item.id || item.quantity <= 1} onClick={() => void changeQuantity(item.id, item.quantity - 1)}><Minus className="size-4" /></button>
                      <span className="min-w-8 text-center text-sm">{item.quantity}</span>
                      <button type="button" className="p-2" disabled={busyId === item.id} onClick={() => void changeQuantity(item.id, item.quantity + 1)}><Plus className="size-4" /></button>
                    </div>
                    <strong>{money(item.unitPriceSnapshot * item.quantity)}</strong>
                  </div>
                </div>
              </article>
            ))}
          </section>
          <aside className="h-fit border p-5">
            <h2 className="text-sm font-semibold">PRICE DETAILS</h2>
            <div className="mt-5 flex justify-between text-sm"><span>Total</span><span>{money(selectedTotal)}</span></div>
            <div className="mt-4 border-t pt-4 flex justify-between font-semibold"><span>Total Amount</span><span>{money(selectedTotal)}</span></div>
            <Button className="mt-6 w-full rounded-none bg-pink-500 hover:bg-pink-600" disabled={busyId === 'checkout'} onClick={() => void checkout()}>CHECKOUT</Button>
          </aside>
        </div>
      )}
    </main>
  );
}
