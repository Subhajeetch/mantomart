'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  CircleAlert,
  CreditCard,
  MapPin,
  Package,
  PackageCheck,
  Truck,
} from 'lucide-react';
import CustomImage from '@/components/custom-image';
import { buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  formatOrderDate,
  formatOrderMoney,
  orderStatusLabel,
  requestOrderData,
  type CustomerOrder,
} from '../../orders/order-data';

function addressLines(order: CustomerOrder) {
  const { address } = order;
  return [
    [address.firstName, address.lastName].filter(Boolean).join(' '),
    address.addressLine1,
    address.addressLine2,
    [address.city, address.state, address.postalCode]
      .filter(Boolean)
      .join(', '),
    address.countryName,
    address.phone,
  ].filter((line): line is string => Boolean(line?.trim()));
}

export default function OrderDetail() {
  const params = useParams<{ orderId: string }>();
  const orderId = typeof params.orderId === 'string' ? params.orderId : '';
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!orderId || orderId.length > 128) {
      setError('This order reference is invalid.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    void requestOrderData<{ order: CustomerOrder }>(
      `/api/store/orders/${encodeURIComponent(orderId)}`
    )
      .then(({ order: loadedOrder }) => {
        if (active) setOrder(loadedOrder);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Unable to load this order.'
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  if (loading) {
    return (
      <main className="grid min-h-[55vh] place-items-center px-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <Spinner className="size-7 text-primary" />
          <p className="text-sm text-muted-foreground">Loading your order…</p>
        </div>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-12 sm:py-20">
        <div
          role="alert"
          className="rounded-2xl border bg-card p-8 text-center shadow-sm sm:p-12"
        >
          <CircleAlert className="mx-auto size-9 text-destructive" />
          <h1 className="mt-4 text-xl font-semibold">
            We couldn’t find that order
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error || 'This order is not available.'}
          </p>
          <Link
            href="/user/orders"
            className={buttonVariants({
              variant: 'outline',
              className: 'mt-6',
            })}
          >
            <ArrowLeft className="mr-2 size-4" />
            Back to your orders
          </Link>
        </div>
      </main>
    );
  }

  const isProblem = order.status === 'cancelled' || order.status === 'refunded';
  const deliveryAddress = addressLines(order);
  const itemCount = order.items.reduce(
    (count, item) => count + item.quantity,
    0
  );
  const steps = [
    { label: 'Order placed', complete: true, icon: Check },
    {
      label: 'Processing',
      complete: ['processing', 'fulfilled'].includes(order.status),
      icon: Package,
    },
    {
      label: 'Fulfilled',
      complete: order.isFulfilled || order.status === 'fulfilled',
      icon: PackageCheck,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <Link
        href="/user/orders"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All orders
      </Link>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Order details
          </p>
          <h1 className="mt-2 break-all text-2xl font-semibold tracking-tight sm:text-3xl">
            Order {order.id}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Placed {formatOrderDate(order.createdAt)}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold ${
            isProblem
              ? 'border-border bg-muted text-muted-foreground'
              : order.status === 'fulfilled'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-primary/20 bg-primary/5 text-primary'
          }`}
        >
          {order.status === 'fulfilled' ? (
            <PackageCheck className="size-4" />
          ) : (
            <Package className="size-4" />
          )}
          {orderStatusLabel(order.status)}
        </span>
      </header>

      {isProblem ? (
        <section className="mt-7 rounded-2xl border border-amber-300/70 bg-amber-50/70 p-5 sm:p-6">
          <p className="text-sm font-semibold text-amber-950">
            {order.status === 'refunded'
              ? 'This order was refunded.'
              : 'This order was cancelled.'}
          </p>
          <p className="mt-1 text-sm leading-6 text-amber-900/80">
            {order.status === 'refunded'
              ? 'The payment was refunded. Please contact customer support if you have questions.'
              : 'This order will not be processed. Contact customer support if you need help.'}
          </p>
        </section>
      ) : (
        <section className="mt-7 rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Truck className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">Order progress</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                We’ll keep your order status up to date.
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {steps.map(({ label, complete, icon: Icon }, index) => (
              <div
                key={label}
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  complete
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'bg-muted/20'
                }`}
              >
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-full ${
                    complete
                      ? 'bg-emerald-600 text-white'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <Icon className="size-4" />
                </span>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Step {index + 1}
                  </p>
                  <p className="text-sm font-semibold">{label}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="font-semibold">Items in this order</h2>
              <span className="text-xs text-muted-foreground">
                {itemCount} item{itemCount === 1 ? '' : 's'}
              </span>
            </div>
            <div className="divide-y">
              {order.items.map((item, index) => (
                <div
                  key={`${item.productSlug}-${index}`}
                  className="flex gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <div className="size-20 shrink-0 overflow-hidden rounded-xl border bg-muted">
                    {item.image ? (
                      <CustomImage
                        src={item.image}
                        alt={item.productName}
                        width={80}
                        height={80}
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="grid size-full place-items-center text-muted-foreground">
                        <Package className="size-6" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/product/${encodeURIComponent(item.productSlug)}`}
                      className="line-clamp-2 text-sm font-semibold hover:text-primary"
                    >
                      {item.productName}
                    </Link>
                    {item.variantLabel ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.variantLabel}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Qty {item.quantity} ·{' '}
                      {formatOrderMoney(item.unitPriceCents, order.currency)}{' '}
                      each
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold">
                    {formatOrderMoney(
                      item.unitPriceCents * item.quantity,
                      order.currency
                    )}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <MapPin className="size-4 text-primary" />
                Delivery address
              </div>
              {deliveryAddress.length ? (
                <address className="mt-4 space-y-1 text-sm not-italic leading-5 text-muted-foreground">
                  {deliveryAddress.map((line, index) => (
                    <p key={`${index}-${line}`}>{line}</p>
                  ))}
                </address>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  Address details are unavailable.
                </p>
              )}
            </div>
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CreditCard className="size-4 text-primary" />
                Payment
              </div>
              <p className="mt-4 text-sm">
                {order.paymentMethod === 'paypal'
                  ? 'PayPal'
                  : order.paymentMethod}
              </p>
              <p
                className={`mt-1 text-xs font-medium ${order.paymentStatus === 'paid' ? 'text-emerald-700' : 'text-muted-foreground'}`}
              >
                Payment {order.paymentStatus}
              </p>
              <p className="mt-3 break-all text-xs text-muted-foreground">
                {order.customerEmail}
              </p>
            </div>
          </section>
        </div>

        <aside className="rounded-2xl border bg-card p-5 shadow-sm lg:sticky lg:top-24">
          <h2 className="font-semibold">Order summary</h2>
          <div className="mt-5 space-y-3 border-b pb-5 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Subtotal</span>
              <span>
                {formatOrderMoney(order.subtotalCents, order.currency)}
              </span>
            </div>
            {order.shipping.map((shipping, index) => (
              <div
                key={`${shipping.serviceName}-${index}`}
                className="flex justify-between gap-3"
              >
                <span className="min-w-0 text-muted-foreground">
                  {shipping.serviceName}
                  {shipping.minDays != null && shipping.maxDays != null ? (
                    <span className="mt-1 block text-xs">
                      Estimated {shipping.minDays}–{shipping.maxDays} days
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0">
                  {formatOrderMoney(
                    shipping.amountCents,
                    shipping.currency || order.currency
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-between gap-3 pt-4 text-base font-semibold">
            <span>Total</span>
            <span>{formatOrderMoney(order.totalCents, order.currency)}</span>
          </div>
          {order.fulfilledAt ? (
            <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
              Fulfilled {formatOrderDate(order.fulfilledAt)}
            </p>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
