'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import CustomImage from '@/components/custom-image';
import Link from 'next/link';
import { useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { useNeedLogin } from '@/components/need-login-context';
import { formatPriceCents, percentOff } from '@/components/homepage/format';
import { cacheCartSummary, getCart, removeCartItem, startCartCheckout, updateCartItem, type CartData } from './api';

const PENDING_CHECKOUT_KEY = 'ragimart.pending-checkout';

/** One-time intent set before sending an anonymous shopper to log in, so the
 *  cart can resume checkout automatically the moment they return authenticated. */
function readPendingCheckout() {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(PENDING_CHECKOUT_KEY) === '1';
  } catch {
    return false;
  }
}

function setPendingCheckout() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PENDING_CHECKOUT_KEY, '1');
  } catch {
    /* ignore */
  }
}

function clearPendingCheckout() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
  } catch {
    /* ignore */
  }
}

export default function CartPage() {
  const router = useRouter();
  const { data: session, isPending: authPending } = useSession();
  const { openNeedLogin } = useNeedLogin();
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const pendingCheckedRef = useRef(false);

  const isLoggedIn = Boolean(session?.user?.id);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCart(await getCart());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load your cart.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('cart-updated', refresh);
    return () => window.removeEventListener('cart-updated', refresh);
  }, [load]);

  const items = cart?.items ?? [];
  const selectedTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.unitPriceSnapshot * item.quantity, 0),
    [items]
  );

  // Savings across line items based on the compared price, if any.
  const savings = useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            ((item.compareAtPriceSnapshot ?? item.unitPriceSnapshot) - item.unitPriceSnapshot) *
              item.quantity
          ),
        0
      ),
    [items]
  );
  const mrpTotal = selectedTotal + savings;

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

  // An anonymous shopper who tried to check out is sent to log in via
  // need-login; when they come back authenticated, resume checkout for them.
  useEffect(() => {
    if (!isLoggedIn) return;
    const pending = readPendingCheckout();
    if (pending) clearPendingCheckout();
    if (pending && !pendingCheckedRef.current && items.length > 0) {
      pendingCheckedRef.current = true;
      void checkout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, items.length]);

  if (authPending || loading) return <main className="mx-auto max-w-6xl p-8 text-center text-sm text-muted-foreground">Loading your bag…</main>;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold sr-only">Shopping Bag</h1>
      {error ? <p className="mt-4 border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {!items.length ? (
        <div className="mt-8 flex min-h-[420px] flex-col items-center justify-center px-6 py-12 text-center">
          <CustomImage
            src="/images/empty-cart-mantomart.webp"
            alt="An empty shopping bag"
            className="h-48 w-48 sm:h-56 sm:w-56"
            width={224}
            height={224}
            priority
          />
          <h2 className="mt-6 text-xl font-semibold tracking-tight">Looks like it&apos;s empty</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Your bag is waiting for something special. Discover your next favorite find and it&apos;ll show up here.
          </p>
          {!isLoggedIn ? (
            <Link
              href="/login"
              className="mt-7 inline-flex min-h-11 items-center justify-center rounded-none bg-primary px-7 text-sm font-medium text-background transition-colors hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Log in
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-3">
            <div className="flex items-center justify-between border-b pb-4 text-sm font-semibold">
              <span>{cart?.summary.itemCount ?? items.length} ITEM{items.length === 1 ? '' : 'S'}</span>
              <span>SELECTED</span>
            </div>
            {items.map((item) => {
              const off = percentOff(item.unitPriceSnapshot, item.compareAtPriceSnapshot);
              return (
                <article key={item.id} className="flex gap-4 border p-3">
                  <div className="size-32 shrink-0 bg-muted">
                    {item.imageSnapshot ? <CustomImage src={item.imageSnapshot} alt={item.productNameSnapshot} className="size-full object-cover" width={128} height={128} /> : null}
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
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-semibold tabular-nums">{formatPriceCents(item.unitPriceSnapshot)}</span>
                      {item.compareAtPriceSnapshot && item.compareAtPriceSnapshot > item.unitPriceSnapshot ? (
                        <>
                          <span className="text-muted-foreground line-through tabular-nums">{formatPriceCents(item.compareAtPriceSnapshot)}</span>
                          <span className="bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-600">-{off}%</span>
                        </>
                      ) : null}
                    </div>
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                      <div className="inline-flex items-center border">
                        <button type="button" className="p-2" disabled={busyId === item.id || item.quantity <= 1} onClick={() => void changeQuantity(item.id, item.quantity - 1)}><Minus className="size-4" /></button>
                        <span className="min-w-8 text-center text-sm">{item.quantity}</span>
                        <button type="button" className="p-2" disabled={busyId === item.id} onClick={() => void changeQuantity(item.id, item.quantity + 1)}><Plus className="size-4" /></button>
                      </div>
                      <strong className="tabular-nums">{formatPriceCents(item.unitPriceSnapshot * item.quantity)}</strong>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
          <aside className="h-fit border p-5">
            <h2 className="text-sm font-semibold">PRICE DETAILS</h2>
            <div className="mt-5 flex justify-between text-sm"><span>Total (MRP)</span><span className="tabular-nums">{formatPriceCents(mrpTotal)}</span></div>
            <div className="mt-2 flex justify-between text-sm"><span>Item discount</span><span className="text-emerald-600 tabular-nums">− {formatPriceCents(savings)}</span></div>
            <div className="mt-2 flex justify-between text-sm"><span>Shipping</span><span className="text-emerald-600">FREE</span></div>
            <div className="mt-4 border-t pt-4 flex justify-between font-semibold"><span>Total Amount</span><span className="tabular-nums">{formatPriceCents(selectedTotal)}</span></div>
            <Button
              className="mt-6 w-full rounded-none bg-primary hover:bg-primary/70"
              disabled={busyId === 'checkout'}
              onClick={() => {
                if (!isLoggedIn) {
                  setPendingCheckout();
                  openNeedLogin({
                    title: 'Log in to continue',
                    description: 'Log in to review your bag and complete your purchase. We’ll bring you right back.',
                    returnTo: typeof window !== 'undefined' ? window.location.href : undefined,
                    // If they close the prompt instead of signing in, drop the
                    // intent so we never surprise-redirect them later.
                    onDismiss: clearPendingCheckout,
                  });
                  return;
                }
                void checkout();
              }}
            >
              CHECKOUT
            </Button>
          </aside>
        </div>
      )}
    </main>
  );
}