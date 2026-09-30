'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CircleAlert, Package, ShoppingBag } from 'lucide-react';
import CustomImage from '@/components/custom-image';
import { Button, buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  formatOrderMoney,
  orderStatusLabel,
  requestOrderData,
  type OrderSummary,
} from './order-data';

type OrderPage = { orders: OrderSummary[]; nextCursor: string | null };

function statusStyle(status: OrderSummary['status']) {
  if (status === 'fulfilled')
    return 'bg-emerald-50 text-emerald-700 ring-emerald-600/15';
  if (status === 'cancelled' || status === 'refunded')
    return 'bg-muted text-muted-foreground ring-border';
  return 'bg-primary/10 text-primary ring-primary/15';
}

export default function OrdersList() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const loadOrders = useCallback(async (cursor?: string, append = false) => {
    setError('');
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const page = await requestOrderData<OrderPage>(
        `/api/store/orders${query}`
      );
      setOrders((current) =>
        append ? [...current, ...page.orders] : page.orders
      );
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to load your orders.'
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  return (
    <section className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <header className="mb-8 border-b border-border pb-6">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Purchases
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Your Orders</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review your purchases and check the latest status of each order.
        </p>
      </header>

      {loading ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border bg-card">
          <Spinner className="size-6 text-primary" />
          <p className="text-sm text-muted-foreground">Loading your orders…</p>
        </div>
      ) : error && orders.length === 0 ? (
        <div
          role="alert"
          className="rounded-2xl border border-destructive/20 bg-destructive/[0.035] p-6 text-center sm:p-10"
        >
          <CircleAlert className="mx-auto size-8 text-destructive" />
          <h2 className="mt-4 text-lg font-semibold">
            We couldn’t load your orders
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {error}
          </p>
          <Button
            className="mt-5"
            variant="outline"
            onClick={() => void loadOrders()}
          >
            Try again
          </Button>
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border bg-card px-6 py-14 text-center shadow-sm sm:py-20">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <ShoppingBag className="size-6" />
          </span>
          <h2 className="mt-5 text-xl font-semibold">
            Your next favorite is waiting
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Orders you place will appear here, along with their payment and
            delivery details.
          </p>
          <Link href="/" className={buttonVariants({ className: 'mt-6' })}>
            Explore the store <ArrowRight className="ml-2 size-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {error ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/[0.035] px-4 py-3"
            >
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void loadOrders(nextCursor ?? undefined, Boolean(nextCursor))
                }
              >
                Try again
              </Button>
            </div>
          ) : null}
          {orders.map((order) => {
            return (
              <Link
              key={order.id}
              href={`/user/order/${encodeURIComponent(order.id)}`}
              className="group relative flex items-center gap-4 overflow-hidden border bg-card p-2 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:gap-5 sm:pr-5"
            >
              {/* Accent bar */}
              <span className="absolute inset-y-0 left-0 w-0.5 origin-top scale-y-0 bg-primary transition-transform duration-300 group-hover:scale-y-100" />

              {/* Image */}
              <div className="relative size-[4.5rem] shrink-0 overflow-hidden border bg-muted sm:size-20">
                {order.image ? (
                  <CustomImage
                    src={order.image}
                    alt={order.productName}
                    width={80}
                    height={80}
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <span className="grid size-full place-items-center text-muted-foreground">
                    <Package className="size-6" />
                  </span>
                )}
                {order.additionalItemCount > 0 ? (
                  <span className="absolute bottom-0 right-0 bg-foreground px-1.5 py-0.5 text-[10px] font-semibold leading-none text-background">
                    +{order.additionalItemCount}
                  </span>
                ) : null}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold tracking-tight sm:text-base">
                  {order.productName}
                </h2>
                <span
                  className={`mt-2 inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${statusStyle(order.status)}`}
                >
                  <span className="size-1.5 bg-current" />
                  {orderStatusLabel(order.status)}
                </span>
              </div>

              {/* Price */}
              <div className="flex shrink-0 items-center gap-3 sm:gap-4 sm:border-l sm:pl-5">
                <div className="text-right">
                  <p className="text-base font-semibold tabular-nums sm:text-lg">
                    {formatOrderMoney(order.totalCents, order.currency)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                  </p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
            </Link>
            );
          })}
          {nextCursor ? (
            <div className="flex justify-center pt-3">
              <Button
                variant="outline"
                disabled={loadingMore}
                onClick={() => void loadOrders(nextCursor, true)}
              >
                {loadingMore ? (
                  <>
                    <Spinner className="mr-2" />
                    Loading more…
                  </>
                ) : (
                  'Load more orders'
                )}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
