'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  CreditCard,
  LockKeyhole,
  MapPin,
  PackageCheck,
  ArrowRight,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { getCountries, getCountryCallingCode } from 'libphonenumber-js';
import { Button, buttonVariants } from '@/components/ui/button';
import CustomImage from '@/components/custom-image';
import { Input } from '@/components/ui/input';
import { PayPalButtons, type PayPalActions } from '@/components/paypal-buttons';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

type Address = {
  id: string;
  firstName: string;
  lastName: string;
  countryCode: string;
  countryName: string;
  phoneCountryCode: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  deliveryInstructions: string | null;
  isDefault: boolean;
};
type CountryCode = ReturnType<typeof getCountries>[number];
type AddressForm = Omit<Address, 'id' | 'isDefault' | 'addressLine2' | 'deliveryInstructions' | 'countryCode' | 'phoneCountryCode'> & {
  countryCode: CountryCode;
  phoneCountryCode: CountryCode;
  addressLine2: string;
  deliveryInstructions: string;
};
type Quote = {
  quoteId: string;
  serviceName: string;
  logisticsServiceName: string;
  amountCents: number;
  currency: string;
  minDays: number | null;
  maxDays: number | null;
};
type CheckoutItem = {
  id: string;
  quantity: number;
  unitPriceSnapshot: number;
  productNameSnapshot: string;
  variantLabelSnapshot: string | null;
  imageSnapshot: string | null;
  href: string;
};
type ShippingSelection = {
  itemId: string;
  quoteId: string;
  serviceName: string;
  logisticsServiceName: string;
  amountCents: number;
  currency: string;
  minDays: number | null;
  maxDays: number | null;
};
type CheckoutData = {
  id: string;
  status: string;
  addressId: string | null;
  items: CheckoutItem[];
  subtotal: number;
  shippingTotal: number;
  total: number;
  expiresAt: string;
  address: Record<string, unknown> | null;
  shipping: ShippingSelection[] | null;
  orderId: string | null;
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded' | null;
};
type ApiResult<T> = { success: true; data: T } | {
  success: false;
  error?: string;
  code?: string;
  retryable?: boolean;
};
class ApiRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly retryable = false) {
    super(message);
  }
}
type PayPalConfig = {
  clientId: string;
  environment: 'sandbox' | 'live';
  currency: 'USD';
};
type Step = 1 | 2;
type BusyAction = 'load' | 'quotes' | 'advance' | 'payment' | 'capture' | null;

const countries = getCountries().map((code) => ({
  code,
  name: new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code,
})).sort((a, b) => a.name.localeCompare(b.name));

const emptyAddress: AddressForm = {
  firstName: '',
  lastName: '',
  countryCode: 'US',
  countryName: 'United States',
  phoneCountryCode: 'US',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  deliveryInstructions: '',
};

function OrderSuccessScreen({ orderId }: { orderId: string | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <main
      aria-live="polite"
      className={`grid min-h-[calc(100svh-4rem)] place-items-center overflow-hidden bg-gradient-to-b from-emerald-50/80 via-background to-background px-5 py-12 transition-opacity duration-700 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <section className="w-full max-w-2xl text-center">
        <div className="relative mx-auto grid size-24 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/10 [animation-duration:2.4s]" />
          <span className="relative grid size-20 place-items-center rounded-full bg-emerald-600 text-white shadow-[0_16px_50px_-18px_rgba(5,150,105,0.65)]">
            <PackageCheck className="size-10" strokeWidth={1.7} />
          </span>
        </div>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Order confirmed</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Thanks for your order!</h1>
        <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-muted-foreground">
          Your purchase is confirmed. We’ll send updates as your order moves through each step.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:max-w-80 mx-auto">
          <Link
            href={orderId ? `/user/order/${encodeURIComponent(orderId)}` : '/user/orders'}
            className={buttonVariants({ size: 'lg', className: 'shadow-sm' })}
          >
           <PackageCheck className="mr-1 size-4" /> <span className="uppercase mt-0.5">Go to order</span>
          </Link>
          <Link href="/" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            <span className="uppercase">Continue shopping</span>
          </Link>
        </div>

        <p className="mt-7 text-xs text-muted-foreground">
          A confirmation and receipt will be sent to your email address.
        </p>
        {orderId ? (
          <div className="mx-auto mt-1 flex items-center justify-center gap-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <span>Order Reference: </span>
            <span>{orderId}</span>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function apiUrl(path: string) {
  return `${(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const result = await response.json().catch(() => null) as ApiResult<T> | null;
  if (!response.ok || !result || result.success !== true) {
    throw new ApiRequestError(
      result && 'error' in result ? result.error ?? 'Request failed.' : 'Request failed.',
      result && 'code' in result ? result.code : undefined,
      result && 'retryable' in result ? result.retryable === true : false,
    );
  }
  return result.data;
}

const money = (cents: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
}).format(cents / 100);

function formatAddress(address: Partial<Address> | Record<string, unknown>) {
  const fields = [
    address.firstName,
    address.lastName,
    address.addressLine1,
    address.addressLine2,
    address.city,
    address.state,
    address.postalCode,
    address.countryName,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return fields;
}

function StepMarker({ number, label, active, complete }: {
  number: number;
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-full border text-sm font-semibold ${
        complete ? 'border-emerald-600 bg-emerald-600 text-white' :
          active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground'
      }`}>
        {complete ? <Check className="size-4" /> : number}
      </span>
      <span className={`truncate text-sm font-medium ${active || complete ? 'text-foreground' : 'text-muted-foreground'}`}>
        {label}
      </span>
    </div>
  );
}

function Field({ label, required, className, children }: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`grid gap-1.5 text-sm ${className ?? ''}`}>
      <span className="font-medium">{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</span>
      {children}
    </label>
  );
}

export default function CheckoutPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [addressForm, setAddressForm] = useState<AddressForm>(emptyAddress);
  const [useNewAddress, setUseNewAddress] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote[]>>({});
  const [shippingErrors, setShippingErrors] = useState<Record<string, string>>({});
  const [selectedQuotes, setSelectedQuotes] = useState<Record<string, string>>({});
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState<BusyAction>('load');
  const [pageError, setPageError] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [paymentCancelled, setPaymentCancelled] = useState(false);
  const [paypalConfig, setPayPalConfig] = useState<PayPalConfig | null>(null);
  const [paypalConfigLoading, setPayPalConfigLoading] = useState(false);
  const [paypalConfigAttempt, setPayPalConfigAttempt] = useState(0);
  const [successScreenVisible, setSuccessScreenVisible] = useState(false);
  const paymentOperationInProgress = useRef(false);
  const captureInProgress = useRef(false);
  const paypalFailureHandled = useRef(false);

  useEffect(() => {
    const isPaid = checkout?.paymentStatus === 'paid' ||
      (checkout?.status === 'completed' && checkout.paymentStatus == null);
    if (!isPaid) {
      setSuccessScreenVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setSuccessScreenVisible(true), 320);
    return () => window.clearTimeout(timer);
  }, [checkout?.orderId, checkout?.paymentStatus, checkout?.status]);

  const selectedAddress = useMemo(
    () => addresses.find((address) => address.id === selectedAddressId) ?? null,
    [addresses, selectedAddressId],
  );
  const shippingTotal = useMemo(() => {
    return Object.entries(selectedQuotes).reduce((sum, [itemId, quoteId]) => {
      const quote = quotes[itemId]?.find((option) => option.quoteId === quoteId);
      return sum + (quote?.amountCents ?? 0);
    }, 0);
  }, [quotes, selectedQuotes]);
  const estimatedTotal = (checkout?.subtotal ?? 0) + shippingTotal;

  const load = useCallback(async () => {
    setBusy('load');
    setPageError('');
    try {
      const data = await request<CheckoutData>(`/api/store/checkout/${encodeURIComponent(sessionId)}`);
      setCheckout(data);
      if (data.shipping?.length) {
        const restoredQuotes = Object.fromEntries(data.shipping.map((quote) => [quote.itemId, quote.quoteId]));
        setSelectedQuotes(restoredQuotes);
      }
      if (data.status === 'completed' || data.orderId) setStep(2);
      else if (data.shipping?.length) setStep(2);
      try {
        const addressResponse = await request<{ addresses: Address[] }>('/api/store/addresses');
        setAddresses(addressResponse.addresses);
        const defaultAddress = addressResponse.addresses.find((address) => address.isDefault) ?? addressResponse.addresses[0];
        if (defaultAddress) setSelectedAddressId(defaultAddress.id);
        const savedAddress = addressResponse.addresses.find((address) => address.id === data.addressId);
        if (savedAddress) setSelectedAddressId(savedAddress.id);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Unable to load saved addresses.';
        toast.add({ title: 'Saved addresses unavailable', description: `${message} You can still add a new address.`, type: 'warning' });
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to load checkout.';
      setPageError(message);
      toast.add({ title: 'Checkout unavailable', description: message, type: 'error' });
    } finally {
      setBusy(null);
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) void load();
  }, [sessionId, load]);

  useEffect(() => {
    if (step !== 2 || checkout?.status === 'completed' || checkout?.orderId) return;
    let active = true;
    setPayPalConfigLoading(true);
    setPayPalConfig(null);
    void request<PayPalConfig>(`/api/store/checkout/${encodeURIComponent(sessionId)}/paypal/config`)
      .then((config) => {
        if (active) {
          setPayPalConfig(config);
          setPaymentError('');
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : 'PayPal checkout is unavailable.';
        setPaymentError(message);
        toast.add({ title: 'PayPal unavailable', description: message, type: 'error' });
      })
      .finally(() => {
        if (active) setPayPalConfigLoading(false);
      });
    return () => {
      active = false;
    };
  }, [checkout?.orderId, checkout?.status, paypalConfigAttempt, sessionId, step]);

  async function getQuotes() {
    setBusy('quotes');
    setPageError('');
    setPaymentError('');
    setQuotes({});
    setShippingErrors({});
    setSelectedQuotes({});
    try {
      let addressId = selectedAddressId;
      if (useNewAddress) {
        const created = await request<{ address: Address }>('/api/store/addresses', {
          method: 'POST',
          body: JSON.stringify({ ...addressForm, isDefault: false }),
        });
        addressId = created.address.id;
        setAddresses((current) => [created.address, ...current]);
        setSelectedAddressId(addressId);
        setUseNewAddress(false);
        toast.add({ title: 'Address saved', description: 'Your delivery address is ready.', type: 'success' });
      }
      if (!addressId) throw new Error('Choose or add a delivery address to continue.');
      const result = await request<{ items: Array<{ itemId: string; options: Quote[]; error?: string }> }>(
        `/api/store/shipping/${encodeURIComponent(sessionId)}/quotes`,
        { method: 'POST', body: JSON.stringify({ addressId }) },
      );
      const byItem = Object.fromEntries(result.items.map((item) => [item.itemId, item.options]));
      const errorsByItem = Object.fromEntries(
        result.items.flatMap((item) => item.error ? [[item.itemId, item.error] as const] : []),
      );
      const defaultSelections = Object.fromEntries(result.items.map((item) => [item.itemId, item.options[0]?.quoteId ?? '']));
      setQuotes(byItem);
      setShippingErrors(errorsByItem);
      setSelectedQuotes(defaultSelections);
      setSelectedAddressId(addressId);
      if (Object.keys(errorsByItem).length) {
        toast.add({
          title: 'Some items need another delivery option',
          description: `${Object.keys(errorsByItem).length} item${Object.keys(errorsByItem).length === 1 ? '' : 's'} could not be quoted. See the message under each item.`,
          type: 'warning',
        });
      } else {
        toast.add({ title: 'Shipping options ready', description: 'Choose the delivery service for each item.', type: 'success' });
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to calculate shipping.';
      setPageError(message);
      toast.add({ title: 'Could not calculate shipping', description: message, type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function continueToPayment() {
    setBusy('advance');
    setPageError('');
    try {
      if (!selectedAddressId || !checkout || checkout.items.some((item) => !selectedQuotes[item.id])) {
        throw new Error('Choose an address and a shipping option for every item.');
      }
      const saved = await request<{ shippingTotal: number; shipping: ShippingSelection[]; address: Record<string, unknown> }>(
        `/api/store/checkout/${encodeURIComponent(sessionId)}/fulfillment`,
        {
          method: 'POST',
          body: JSON.stringify({
            addressId: selectedAddressId,
            quotes: Object.values(selectedQuotes).map((quoteId) => ({ quoteId })),
          }),
        },
      );
      setCheckout((current) => current ? {
        ...current,
        address: saved.address,
        shipping: saved.shipping,
        shippingTotal: saved.shippingTotal,
        total: current.subtotal + saved.shippingTotal,
      } : current);
      setStep(2);
      toast.add({ title: 'Delivery details saved', description: 'You are ready for secure payment.', type: 'success' });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to continue to payment.';
      setPageError(message);
      toast.add({ title: 'Could not continue', description: message, type: 'error' });
      if (message.toLowerCase().includes('shipping')) {
        setStep(1);
        setQuotes({});
        setShippingErrors({});
        setSelectedQuotes({});
      }
    } finally {
      setBusy(null);
    }
  }

  async function createPayPalOrder() {
    if (paymentOperationInProgress.current) throw new Error('Payment is already being prepared.');
    paymentOperationInProgress.current = true;
    setBusy('payment');
    setPaymentError('');
    setPaymentCancelled(false);
    paypalFailureHandled.current = false;
    try {
      const result = await request<{ orderId: string }>(
        `/api/store/checkout/${encodeURIComponent(sessionId)}/paypal/order`,
        { method: 'POST' },
      );
      if (!result.orderId) throw new Error('PayPal did not create a payment order.');
      return result.orderId;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to start PayPal payment.';
      paypalFailureHandled.current = true;
      if (message.toLowerCase().includes('shipping quote')) {
        setStep(1);
        setQuotes({});
        setShippingErrors({});
        setSelectedQuotes({});
        setPageError(message);
      } else {
        setPaymentError(message);
      }
      toast.add({ title: 'Payment could not start', description: message, type: 'error' });
      throw reason;
    } finally {
      paymentOperationInProgress.current = false;
      setBusy(null);
    }
  }

  async function capturePayPalOrder(paypalOrderId: string, actions: PayPalActions) {
    if (paymentOperationInProgress.current || captureInProgress.current) return;
    captureInProgress.current = true;
    paymentOperationInProgress.current = true;
    setBusy('capture');
    setPaymentError('');
    setPaymentCancelled(false);
    try {
      const captureAttemptId = crypto.randomUUID();
      const result = await request<{
        orderId: string;
        status: string;
        paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
      }>(
        `/api/store/checkout/${encodeURIComponent(sessionId)}/paypal/capture`,
        { method: 'POST', body: JSON.stringify({ paypalOrderId, captureAttemptId }) },
      );
      const isPending = result.paymentStatus === 'pending';
      toast.add({
        title: isPending ? 'Payment pending' : 'Payment confirmed',
        description: isPending
          ? 'PayPal is reviewing your payment. Your order will not be processed until it clears.'
          : 'Your order is placed and ready for processing.',
        type: isPending ? 'warning' : 'success',
      });
      setCheckout((current) => current ? {
        ...current,
        status: isPending ? 'awaiting_payment' : 'completed',
        orderId: result.orderId,
        paymentStatus: result.paymentStatus,
      } : current);
      setStep(2);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'PayPal could not confirm your payment.';
      setPaymentError(message);
      if (reason instanceof ApiRequestError &&
        reason.code === 'PAYMENT_DECLINED' &&
        reason.retryable) {
        try {
          await actions.restart();
        } catch (restartError) {
          console.error('PayPal checkout restart failed:', restartError);
          const restartMessage = 'PayPal could not reopen checkout. Close the PayPal window and try again.';
          setPaymentError(restartMessage);
          toast.add({ title: 'Payment not completed', description: restartMessage, type: 'error' });
        }
      } else {
        toast.add({ title: 'Payment not completed', description: message, type: 'error' });
      }
    } finally {
      captureInProgress.current = false;
      paymentOperationInProgress.current = false;
      setBusy(null);
    }
  }

  function handlePayPalCancel() {
    paymentOperationInProgress.current = false;
    setBusy(null);
    setPaymentCancelled(true);
    setPaymentError('Your payment was cancelled. Your order has not been placed.');
    toast.add({ title: 'Payment cancelled', description: 'You can safely retry when you are ready.', type: 'warning' });
  }

  function handlePayPalError() {
    paymentOperationInProgress.current = false;
    setBusy(null);
    if (paypalFailureHandled.current) {
      paypalFailureHandled.current = false;
      return;
    }
    const message = 'PayPal checkout encountered a problem. Please try again.';
    setPayPalConfig(null);
    setPaymentError(message);
    toast.add({ title: 'PayPal checkout unavailable', description: message, type: 'error' });
  }

  if (busy === 'load') {
    return (
      <main className="mx-auto grid min-h-[55vh] max-w-5xl place-items-center px-4 py-16">
        <div className="flex flex-col items-center gap-4 text-center">
          <Spinner className="size-8 text-primary" />
          <p className="text-sm text-muted-foreground">Preparing your secure checkout…</p>
        </div>
      </main>
    );
  }

  if (pageError && !checkout) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive"><CircleAlert /></span>
          <h1 className="mt-4 text-xl font-semibold">We couldn’t open this checkout</h1>
          <p className="mt-2 text-sm text-muted-foreground">{pageError}</p>
          <Link href="/cart" className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90">
            Return to your cart
          </Link>
        </div>
      </main>
    );
  }

  if (!checkout) return null;
  const isPaid = checkout.paymentStatus === 'paid' ||
    (checkout.status === 'completed' && checkout.paymentStatus == null);
  const isPending = checkout.paymentStatus === 'pending';
  const isFinalized = isPaid || isPending ||
    checkout.paymentStatus === 'failed' || checkout.paymentStatus === 'refunded';

  if (isPaid && successScreenVisible) {
    return <OrderSuccessScreen orderId={checkout.orderId} />;
  }

  return (
    <main className={`mx-auto min-w-0 max-w-7xl px-4 pb-16 pt-8 transition-opacity duration-300 sm:px-6 lg:pt-12 ${isPaid ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/cart" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
            <ArrowLeft className="size-4" /> Back to cart
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {isPending
              ? 'Payment pending'
              : isPaid
                ? 'Order confirmed'
                : checkout.paymentStatus === 'refunded'
                  ? 'Payment refunded'
                  : checkout.paymentStatus === 'failed'
                    ? 'Payment not completed'
                    : 'Secure checkout'}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            {isPending
              ? 'PayPal is reviewing your payment. We will process the order once it clears.'
              : isPaid
                ? 'Thank you — your payment is confirmed and your order is in our hands.'
                : isFinalized
                  ? 'See the payment status below for next steps.'
                  : 'A few details, then your order is on its way.'}
          </p>
        </div>
        <div className="hidden items-center gap-2 rounded-full border bg-card px-4 py-2 text-xs font-medium text-muted-foreground sm:flex">
          <LockKeyhole className="size-3.5 text-emerald-600" />
          Secure, encrypted checkout
        </div>
      </div>

      {!isFinalized ? (
        <div className="mb-8 flex items-center gap-3 rounded-xl border bg-card p-4 sm:gap-5 sm:px-6">
          <StepMarker number={1} label="Address & shipping" active={step === 1} complete={step === 2} />
          <div className="h-px min-w-5 flex-1 bg-border" />
          <StepMarker number={2} label="Payment" active={step === 2} complete={false} />
        </div>
      ) : null}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {isPending ? (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6 sm:p-8">
              <div className="flex items-start gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-amber-500 text-white"><CreditCard className="size-6" /></span>
                <div>
                  <p className="text-sm font-semibold text-amber-900">Payment under review</p>
                  <h2 className="mt-1 text-2xl font-semibold text-foreground">We’ll update your order when PayPal clears it.</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Your order will not be processed until the payment is confirmed.</p>
                  {checkout.orderId ? (
                    <>
                      <p className="mt-4 text-xs text-muted-foreground">Order reference <span className="font-mono font-medium text-foreground">{checkout.orderId}</span></p>
                      <Link
                        href={`/user/order/${encodeURIComponent(checkout.orderId)}`}
                        className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-4' })}
                      >
                        View order details <ArrowRight className="ml-2 size-3.5" />
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
            </section>
          ) : isPaid ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 sm:p-8">
              <div className="flex items-start gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><PackageCheck className="size-6" /></span>
                <div>
                  <p className="text-sm font-semibold text-emerald-800">Payment successful</p>
                  <h2 className="mt-1 text-2xl font-semibold text-foreground">Thanks for your order!</h2>
                  <p className="mt-2 text-sm text-muted-foreground">We’ve received your order and will email your receipt and updates.</p>
                  {checkout.orderId ? (
                    <>
                      <p className="mt-4 text-xs text-muted-foreground">Order reference <span className="font-mono font-medium text-foreground">{checkout.orderId}</span></p>
                      <Link
                        href={`/user/order/${encodeURIComponent(checkout.orderId)}`}
                        className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-4' })}
                      >
                        View order details <ArrowRight className="ml-2 size-3.5" />
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="mt-6 border-t border-emerald-200 pt-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Delivering to</p>
                {formatAddress(checkout.address ?? {}).map((line, index) => <p key={`${index}-${line}`} className="mt-1 text-sm">{line}</p>)}
              </div>
            </section>
          ) : isFinalized ? (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6 sm:p-8">
              <p className="text-sm font-semibold text-amber-900">
                {checkout.paymentStatus === 'refunded' ? 'This payment was refunded.' : 'This payment was not completed.'}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {checkout.paymentStatus === 'refunded'
                  ? 'Contact us if you have questions about your refund.'
                  : 'Contact support for help completing this order.'}
              </p>
              {checkout.orderId ? <p className="mt-4 text-xs text-muted-foreground">Order reference <span className="font-mono font-medium text-foreground">{checkout.orderId}</span></p> : null}
            </section>
          ) : step === 1 ? (
            <>
              <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
                <div className="mb-6 flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><MapPin className="size-5" /></span>
                  <div>
                    <h2 className="text-lg font-semibold">Delivery address</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Choose where we should send your order.</p>
                  </div>
                </div>
                {addresses.length ? (
                  <div className="mb-5 grid gap-3 sm:grid-cols-2">
                    {addresses.map((address) => (
                      <button
                        key={address.id}
                        type="button"
                        onClick={() => {
                          setSelectedAddressId(address.id);
                          setUseNewAddress(false);
                          setQuotes({});
                          setShippingErrors({});
                          setSelectedQuotes({});
                          setPageError('');
                        }}
                        className={`relative rounded-xl border p-4 text-left transition ${
                          selectedAddressId === address.id && !useNewAddress
                            ? 'border-primary bg-primary/[0.035] ring-1 ring-primary'
                            : 'hover:border-foreground/30'
                        }`}
                      >
                        {selectedAddressId === address.id && !useNewAddress ? <Check className="absolute right-3 top-3 size-4 text-primary" /> : null}
                        <span className="block pr-5 text-sm font-semibold">{address.firstName} {address.lastName}</span>
                        {address.isDefault ? <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Default</span> : null}
                        <span className="mt-2 block space-y-0.5 text-xs leading-5 text-muted-foreground">
                          {formatAddress(address).slice(2).map((line, index) => <span key={`${index}-${line}`} className="block">{line}</span>)}
                          <span className="block">{address.phone}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setUseNewAddress(true);
                    setSelectedAddressId('');
                    setQuotes({});
                    setShippingErrors({});
                    setSelectedQuotes({});
                  }}
                  className={`mb-5 flex w-full items-center justify-between rounded-xl border p-4 text-left transition ${
                    useNewAddress || addresses.length === 0 ? 'border-primary bg-primary/[0.035] ring-1 ring-primary' : 'hover:border-foreground/30'
                  }`}
                >
                  <span>
                    <span className="block text-sm font-semibold">{addresses.length ? 'Add a new address' : 'Add your delivery address'}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Your address is securely saved to your account.</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
                {useNewAddress || addresses.length === 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="First name" required><Input autoComplete="given-name" value={addressForm.firstName} onChange={(event) => setAddressForm({ ...addressForm, firstName: event.target.value })} /></Field>
                    <Field label="Last name" required><Input autoComplete="family-name" value={addressForm.lastName} onChange={(event) => setAddressForm({ ...addressForm, lastName: event.target.value })} /></Field>
                    <Field label="Country" required className="sm:col-span-2">
                      <select
                        value={addressForm.countryCode}
                        onChange={(event) => {
                          const country = countries.find((entry) => entry.code === event.target.value);
                          if (country) setAddressForm({ ...addressForm, countryCode: country.code, countryName: country.name, phoneCountryCode: country.code });
                        }}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Street address" required className="sm:col-span-2"><Input autoComplete="address-line1" value={addressForm.addressLine1} onChange={(event) => setAddressForm({ ...addressForm, addressLine1: event.target.value })} /></Field>
                    <Field label="Apartment, suite, etc."><Input autoComplete="address-line2" value={addressForm.addressLine2} onChange={(event) => setAddressForm({ ...addressForm, addressLine2: event.target.value })} /></Field>
                    <Field label="City" required><Input autoComplete="address-level2" value={addressForm.city} onChange={(event) => setAddressForm({ ...addressForm, city: event.target.value })} /></Field>
                    <Field label="State / province" required><Input autoComplete="address-level1" value={addressForm.state} onChange={(event) => setAddressForm({ ...addressForm, state: event.target.value })} /></Field>
                    <Field label="ZIP / postal code" required><Input autoComplete="postal-code" value={addressForm.postalCode} onChange={(event) => setAddressForm({ ...addressForm, postalCode: event.target.value })} /></Field>
                    <Field label="Phone number" required className="sm:col-span-2">
                      <div className="flex gap-2">
                        <div className="grid h-10 min-w-20 place-items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">+{getCountryCallingCode(addressForm.phoneCountryCode)}</div>
                        <Input autoComplete="tel" inputMode="tel" value={addressForm.phone} onChange={(event) => setAddressForm({ ...addressForm, phone: event.target.value })} />
                      </div>
                    </Field>
                  </div>
                ) : null}
                {pageError ? <p className="mt-4 flex items-center gap-2 text-sm text-destructive"><CircleAlert className="size-4" />{pageError}</p> : null}
                <Button className="mt-6 w-full sm:w-auto" disabled={busy !== null} onClick={() => void getQuotes()}>
                  {busy === 'quotes'
                    ? <><Spinner className="mr-2" />Finding shipping options…</>
                    : <>{Object.keys(quotes).length ? 'Refresh shipping options' : 'Find shipping options'} <ChevronRight className="ml-2 size-4" /></>}
                </Button>
              </section>

              {Object.keys(quotes).length || Object.keys(shippingErrors).length ? (
                <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
                  <div className="mb-5 flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Truck className="size-5" /></span>
                    <div>
                      <h2 className="text-lg font-semibold">Shipping method</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Delivery options are calculated for your address.</p>
                    </div>
                  </div>
                  <div className="space-y-5">
                    {checkout.items.map((item) => (
                      <div key={item.id} className="border-t pt-4 first:border-0 first:pt-0">
                        <h3 className="mb-3 text-sm font-medium">{item.productNameSnapshot}</h3>
                        <div className="grid gap-2">
                          {(quotes[item.id] ?? []).map((option) => (
                            <label key={option.quoteId} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                              selectedQuotes[item.id] === option.quoteId ? 'border-primary bg-primary/[0.035] ring-1 ring-primary' : 'hover:border-foreground/30'
                            }`}>
                              <input
                                type="radio"
                                name={`shipping-${item.id}`}
                                checked={selectedQuotes[item.id] === option.quoteId}
                                onChange={() => setSelectedQuotes((current) => ({ ...current, [item.id]: option.quoteId }))}
                                className="accent-primary"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium">{option.serviceName}</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  {option.minDays != null && option.maxDays != null ? `${option.minDays}–${option.maxDays} day delivery` : 'Delivery estimate unavailable'}
                                </span>
                              </span>
                              <span className="text-sm font-semibold">{money(option.amountCents)}</span>
                            </label>
                          ))}
                          {shippingErrors[item.id] ? (
                            <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-900">
                              <CircleAlert className="mt-0.5 size-4 shrink-0" />
                              <span>{shippingErrors[item.id]}</span>
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t pt-4 text-sm">
                    <span className="text-muted-foreground">Shipping total</span><span className="font-semibold">{money(shippingTotal)}</span>
                  </div>
                  <Button
                    className="mt-5 w-full"
                    disabled={busy !== null || checkout.items.some((item) => !selectedQuotes[item.id])}
                    onClick={() => void continueToPayment()}
                  >
                    {busy === 'advance' ? <><Spinner className="mr-2" />Securing delivery details…</> : <>Continue to payment <ChevronRight className="ml-2 size-4" /></>}
                  </Button>
                </section>
              ) : null}
            </>
          ) : isFinalized ? null : (
            <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
              <div className="mb-6 flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><CreditCard className="size-5" /></span>
                <div>
                  <h2 className="text-lg font-semibold">Payment</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Pay securely with PayPal without leaving checkout.</p>
                </div>
              </div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-lg border bg-white font-bold italic text-[#003087]">P</span>
                    <div>
                      <p className="text-sm font-semibold">PayPal</p>
                      <p className="text-xs text-muted-foreground">Pay securely with your PayPal account</p>
                    </div>
                  </div>
                  <ShieldCheck className="size-5 shrink-0 text-emerald-600" />
                </div>
              </div>
              {selectedAddress ? (
                <div className="mt-5 flex items-start justify-between gap-4 rounded-xl border p-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shipping to</p>
                    <p className="mt-2 text-sm font-medium">{selectedAddress.firstName} {selectedAddress.lastName}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{formatAddress(selectedAddress).slice(2).join(', ')}</p>
                  </div>
                  {!isFinalized ? <button type="button" className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline" onClick={() => setStep(1)}>Edit</button> : null}
                </div>
              ) : null}
              {paymentError ? (
                <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div>
                    <p className="text-sm font-semibold">{paymentCancelled ? 'Payment cancelled' : 'Payment didn’t go through'}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{paymentError}</p>
                  </div>
                </div>
              ) : null}
              <p className="mt-5 flex items-center gap-2 text-xs leading-5 text-muted-foreground">
                <LockKeyhole className="size-3.5 shrink-0 text-emerald-600" />
                PayPal handles your payment details. They are never stored on our servers.
              </p>
              {paypalConfigLoading ? (
                <div className="mt-6 flex min-h-12 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  Connecting to secure PayPal checkout…
                </div>
              ) : paypalConfig ? (
                <PayPalButtons
                  clientId={paypalConfig.clientId}
                  createOrder={createPayPalOrder}
                  onApprove={capturePayPalOrder}
                  onCancel={handlePayPalCancel}
                  onError={handlePayPalError}
                />
              ) : (
                <Button
                  className="mt-6 w-full"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => {
                    setPaymentError('');
                    setPayPalConfigAttempt((attempt) => attempt + 1);
                  }}
                >
                  Retry PayPal connection
                </Button>
              )}
              {busy === 'capture' ? (
                <p className="mt-3 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                  <Spinner /> Confirming payment securely. Please keep this page open.
                </p>
              ) : null}
            </section>
          )}
        </div>

        <aside className="h-fit rounded-2xl border bg-card p-5 shadow-sm lg:sticky lg:top-24">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Order summary</h2>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{checkout.items.length} {checkout.items.length === 1 ? 'item' : 'items'}</span>
          </div>
          <div className="max-h-72 space-y-4 overflow-auto pr-1">
            {checkout.items.map((item) => (
              <div key={item.id} className="flex gap-3">
                <div className="relative size-16 shrink-0 overflow-hidden rounded-lg border bg-muted">
                  {item.imageSnapshot ? <CustomImage src={item.imageSnapshot} alt={item.productNameSnapshot} width={64} height={64} className="size-full" /> : null}
                  <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-foreground text-[10px] font-medium text-background">{item.quantity}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium">{item.productNameSnapshot}</p>
                  {item.variantLabelSnapshot ? <p className="mt-1 truncate text-xs text-muted-foreground">{item.variantLabelSnapshot}</p> : null}
                </div>
                <p className="shrink-0 text-sm font-semibold">{money(item.unitPriceSnapshot * item.quantity)}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 space-y-3 border-t pt-4 text-sm">
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Subtotal</span><span>{money(checkout.subtotal)}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Shipping</span><span>{money(Object.keys(quotes).length ? shippingTotal : checkout.shippingTotal)}</span></div>
            <div className="flex justify-between gap-3 border-t pt-4 text-base font-semibold"><span>Total</span><span>{money(Object.keys(quotes).length ? estimatedTotal : checkout.total)}</span></div>
          </div>
          <div className="mt-5 flex gap-2 rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <span>Protected checkout. Your order is only placed after PayPal confirms your payment.</span>
          </div>
          {busy === 'advance' ? (
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground"><Spinner /> Moving to secure payment…</div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
