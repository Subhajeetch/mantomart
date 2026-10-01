'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CreditCard,
  LockKeyhole,
  MapPin,
  PackageCheck,
  ArrowRight,
  ShieldCheck,
  Truck,
  Plus,
  ShoppingBag,
} from 'lucide-react';
import { getCountries, getCountryCallingCode } from 'libphonenumber-js';
import { Button, buttonVariants } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
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
  constructor(
    message: string,
    readonly code?: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
  }
}
type PayPalConfig = {
  clientId: string;
  environment: 'sandbox' | 'live';
  currency: 'USD';
};
type PayPalCaptureResult = {
  orderId: string;
  status: string;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
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
      response.status,
    );
  }
  return result.data;
}

const money = (cents: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
}).format(cents / 100);

function isRetryableShippingError(reason: unknown) {
  if (reason instanceof ApiRequestError) {
    if (reason.code === 'CHECKOUT_SECURITY_UNAVAILABLE') return false;
    return reason.retryable || reason.status === 429 || (reason.status !== undefined && reason.status >= 500);
  }
  return reason instanceof TypeError;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

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

function StepMarker({ number, label, icon, active, complete }: {
  number: number;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-full border text-sm font-semibold ${
        complete ? 'border-emerald-600 bg-emerald-600 text-white' :
          active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground'
      }`}>
        <span className="sr-only">{number}</span>
        {icon}
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
  const [addressLoadError, setAddressLoadError] = useState('');
  const [addressForm, setAddressForm] = useState<AddressForm>(emptyAddress);
  const [useNewAddress, setUseNewAddress] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote[]>>({});
  const [quotesLoaded, setQuotesLoaded] = useState(false);
  const [shippingErrors, setShippingErrors] = useState<Record<string, string>>({});
  const [retryableShippingErrors, setRetryableShippingErrors] = useState<Record<string, boolean>>({});
  const [loadingShippingItemIds, setLoadingShippingItemIds] = useState<string[]>([]);
  const [shippingRequestError, setShippingRequestError] = useState('');
  const [selectedQuotes, setSelectedQuotes] = useState<Record<string, string>>({});
  const [openAccordion, setOpenAccordion] = useState('address');
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState<BusyAction>('load');
  const [pageError, setPageError] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [paymentCancelled, setPaymentCancelled] = useState(false);
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);
  const [paypalConfig, setPayPalConfig] = useState<PayPalConfig | null>(null);
  const [paypalConfigLoading, setPayPalConfigLoading] = useState(false);
  const [paypalConfigAttempt, setPayPalConfigAttempt] = useState(0);
  const [successScreenVisible, setSuccessScreenVisible] = useState(false);
  const paymentOperationInProgress = useRef(false);
  const captureInProgress = useRef(false);
  const paypalFailureHandled = useRef(false);
  const pendingPayPalCapture = useRef<PayPalCaptureResult | null>(null);
  const quoteRequestSequence = useRef(0);
  const checkoutItemsRef = useRef<CheckoutItem[]>([]);

  useEffect(() => {
    checkoutItemsRef.current = checkout?.items ?? [];
  }, [checkout?.items]);

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

  const fetchShippingOptions = useCallback(async (
    addressId: string,
    options?: { showLoading?: boolean; preferredQuotes?: Record<string, string>; itemIds?: string[] },
  ) => {
    const sequence = ++quoteRequestSequence.current;
    const showLoading = options?.showLoading ?? true;
    const itemIds = options?.itemIds ?? checkoutItemsRef.current.map((item) => item.id);
    const maxAttempts = 4;
    const loadedQuotes: Record<string, Quote[]> = {};
    const selectedQuoteIds: Record<string, string> = {};
    const itemErrors: Record<string, string> = {};
    const retryableItemErrors: Record<string, boolean> = {};
    let pendingItemIds = itemIds;
    let requestErrorOccurred = false;
    if (showLoading) setBusy('quotes');
    setPageError('');
    setShippingRequestError('');
    setQuotes({});
    setQuotesLoaded(false);
    setShippingErrors({});
    setRetryableShippingErrors({});
    setLoadingShippingItemIds(itemIds);
    setSelectedQuotes({});
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (sequence !== quoteRequestSequence.current) return;
      if (attempt > 1) {
        setLoadingShippingItemIds(pendingItemIds.length ? pendingItemIds : itemIds);
        await wait(Math.min(300 * 2 ** (attempt - 2), 1200));
        if (sequence !== quoteRequestSequence.current) return;
      }
      try {
        const attemptItemIds = attempt === 1 ? itemIds : pendingItemIds;
        const result = await request<{
          items: Array<{ itemId: string; options: Quote[]; error?: string; retryable?: boolean }>;
        }>(
          `/api/store/shipping/${encodeURIComponent(sessionId)}/quotes`,
          {
            method: 'POST',
            body: JSON.stringify({
              addressId,
              ...(attempt > 1 ? { itemIds: attemptItemIds } : {}),
            }),
          },
        );
        if (sequence !== quoteRequestSequence.current) return;
        if (!Array.isArray(result.items)) {
          throw new ApiRequestError('Shipping options could not be loaded. Please try again.', undefined, true);
        }

        const nextPendingItemIds: string[] = [];
        for (const itemId of attemptItemIds) {
          const itemResult = result.items.find((entry) => entry.itemId === itemId);
          if (!itemResult) {
            nextPendingItemIds.push(itemId);
            continue;
          }
          const firstOption = itemResult.options[0];
          if (firstOption) {
            loadedQuotes[itemId] = itemResult.options;
            const preferredId = options?.preferredQuotes?.[itemId] ?? selectedQuoteIds[itemId];
            selectedQuoteIds[itemId] = itemResult.options.find((quote) => quote.quoteId === preferredId)?.quoteId
              ?? firstOption.quoteId;
            delete itemErrors[itemId];
            delete retryableItemErrors[itemId];
          } else if (itemResult.retryable) {
            nextPendingItemIds.push(itemId);
            if (itemResult.error) itemErrors[itemId] = itemResult.error;
            retryableItemErrors[itemId] = true;
          } else {
            itemErrors[itemId] = itemResult.error ?? 'No shipping options are currently available for this item.';
            retryableItemErrors[itemId] = false;
          }
        }
        pendingItemIds = nextPendingItemIds;
        setQuotes({ ...loadedQuotes });
        setSelectedQuotes({ ...selectedQuoteIds });
        setShippingErrors({ ...itemErrors });
        setRetryableShippingErrors({ ...retryableItemErrors });
        setLoadingShippingItemIds(pendingItemIds);
        if (pendingItemIds.length === 0) break;
        if (attempt === maxAttempts) {
          for (const itemId of pendingItemIds) {
            itemErrors[itemId] ??= 'Shipping options could not be loaded. Please try again.';
            retryableItemErrors[itemId] = true;
          }
          setShippingErrors({ ...itemErrors });
          setRetryableShippingErrors({ ...retryableItemErrors });
          break;
        }
      } catch (reason) {
        if (sequence !== quoteRequestSequence.current) return;
        if (!isRetryableShippingError(reason) || attempt === maxAttempts) {
          const message = reason instanceof Error ? reason.message : 'Unable to calculate shipping.';
          requestErrorOccurred = true;
          setShippingRequestError(message);
          toast.add({ title: 'Could not calculate shipping', description: message, type: 'error' });
          break;
        }
        setLoadingShippingItemIds(pendingItemIds);
      }
    }
    if (sequence === quoteRequestSequence.current) {
      setQuotesLoaded(!requestErrorOccurred);
      setLoadingShippingItemIds([]);
      if (Object.keys(itemErrors).length) {
        toast.add({
          title: 'Some items need another delivery option',
          description: `${Object.keys(itemErrors).length} item${Object.keys(itemErrors).length === 1 ? '' : 's'} could not be quoted. See the message under each item.`,
          type: 'warning',
        });
      }
      if (showLoading) setBusy(null);
    }
  }, [sessionId]);

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
        if (!Array.isArray(addressResponse.addresses)) throw new Error('Saved addresses could not be loaded.');
        setAddresses(addressResponse.addresses);
        setAddressLoadError('');
        const savedCheckoutAddress = addressResponse.addresses.find((address) => address.id === data.addressId);
        const selected = (data.shipping?.length ? savedCheckoutAddress : null)
          ?? addressResponse.addresses.find((address) => address.isDefault)
          ?? null;
        setSelectedAddressId(selected?.id ?? '');
        setUseNewAddress(addressResponse.addresses.length === 0);
        setOpenAccordion(selected ? 'shipping' : 'address');
        if (selected && data.status !== 'completed' && !data.orderId) {
          await fetchShippingOptions(selected.id, {
            showLoading: false,
            preferredQuotes: Object.fromEntries((data.shipping ?? []).map((quote) => [quote.itemId, quote.quoteId])),
            itemIds: data.items.map((item) => item.id),
          });
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Unable to load saved addresses.';
        setAddresses([]);
        setSelectedAddressId('');
        setOpenAccordion('address');
        setAddressLoadError(message);
        setUseNewAddress(true);
        toast.add({ title: 'Saved addresses unavailable', description: `${message} You can still add a new address.`, type: 'warning' });
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to load checkout.';
      setPageError(message);
      toast.add({ title: 'Checkout unavailable', description: message, type: 'error' });
    } finally {
      setBusy(null);
    }
  }, [fetchShippingOptions, sessionId]);

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

  async function saveNewAddressAndGetQuotes() {
    setBusy('quotes');
    setPageError('');
    try {
      const created = await request<{ address: Address }>('/api/store/addresses', {
        method: 'POST',
        body: JSON.stringify({ ...addressForm, isDefault: false }),
      });
      setAddresses((current) => [created.address, ...current]);
      setSelectedAddressId(created.address.id);
      setUseNewAddress(false);
      setOpenAccordion('shipping');
      setPageError('');
      toast.add({ title: 'Address saved', description: 'Your delivery address is ready.', type: 'success' });
      await fetchShippingOptions(created.address.id);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to calculate shipping.';
      setPageError(message);
      toast.add({ title: 'Could not save address', description: message, type: 'error' });
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
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to continue to payment.';
      setPageError(message);
      toast.add({ title: 'Could not continue', description: message, type: 'error' });
      if (message.toLowerCase().includes('shipping')) {
        setStep(1);
        setOpenAccordion('shipping');
        setQuotes({});
        setQuotesLoaded(false);
        setShippingErrors({});
        setRetryableShippingErrors({});
        setSelectedQuotes({});
        setShippingRequestError(message);
      }
    } finally {
      setBusy(null);
    }
  }

  async function createPayPalOrder() {
    if (paymentOperationInProgress.current) throw new Error('Payment is already being prepared.');
    paymentOperationInProgress.current = true;
    pendingPayPalCapture.current = null;
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
        setOpenAccordion('shipping');
        setQuotes({});
        setQuotesLoaded(false);
        setShippingErrors({});
        setRetryableShippingErrors({});
        setSelectedQuotes({});
        setShippingRequestError(message);
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
    pendingPayPalCapture.current = null;
    setBusy('capture');
    setPaymentError('');
    setPaymentCancelled(false);
    try {
      const captureAttemptId = crypto.randomUUID();
      const result = await request<PayPalCaptureResult>(
        `/api/store/checkout/${encodeURIComponent(sessionId)}/paypal/capture`,
        { method: 'POST', body: JSON.stringify({ paypalOrderId, captureAttemptId }) },
      );
      pendingPayPalCapture.current = result;
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

  function completePayPalApproval() {
    const result = pendingPayPalCapture.current;
    if (!result) return;
    pendingPayPalCapture.current = null;
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
  }

  function handlePayPalCancel() {
    pendingPayPalCapture.current = null;
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
    <main className={`mx-auto min-w-0 max-w-7xl px-4 pb-[calc(12rem+env(safe-area-inset-bottom))] pt-8 transition-opacity duration-300 sm:px-6 sm:pb-16 lg:pt-12 ${isPaid ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>

      {!isFinalized ? (
        <>
          <div className="mb-8 flex items-center gap-3 rounded-xl border bg-card p-4 sm:gap-5 sm:px-6 lg:hidden">
            <StepMarker number={1} label="Address & shipping" icon={<MapPin className="size-4" />} active={step === 1} complete={step === 2} />
            <div className="h-px min-w-5 flex-1 bg-border" />
            <StepMarker number={2} label="Payment" icon={<CreditCard className="size-4" />} active={step === 2} complete={false} />
          </div>
          <div className="mb-8 hidden items-center gap-5 rounded-xl border bg-card p-4 lg:flex lg:px-6">
            <StepMarker number={1} label="Your Bag" icon={<ShoppingBag className="size-4" />} active={false} complete />
            <div className="h-px min-w-5 flex-1 bg-border" />
            <StepMarker number={2} label="Address & shipping" icon={<MapPin className="size-4" />} active={step === 1} complete={step === 2} />
            <div className="h-px min-w-5 flex-1 bg-border" />
            <StepMarker number={3} label="Payment" icon={<CreditCard className="size-4" />} active={step === 2} complete={false} />
          </div>
        </>
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
            <Accordion
              value={openAccordion ? [openAccordion] : []}
              multiple={false}
              onValueChange={(value) => setOpenAccordion(value[0] === 'address' || value[0] === 'shipping' ? value[0] : '')}
              className="gap-4"
            >
              <AccordionItem value="address" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                <AccordionTrigger className="items-center px-5 py-5 hover:no-underline sm:px-7">
                  <span className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><MapPin className="size-5" /></span>
                    <span className="w-0 min-w-0 flex-1">
                      <span className="block text-base font-semibold">Delivery address</span>
                      {selectedAddress && !useNewAddress ? (
                        <span className="mt-1 block w-full truncate text-sm font-normal text-muted-foreground">
                          {formatAddress(selectedAddress).slice(2).join(', ')}
                        </span>
                      ) : (
                        <span className="mt-1 block text-sm font-normal text-muted-foreground">Choose where we should send your order.</span>
                      )}
                    </span>
                  </span>
                  <span className="mr-3 shrink-0 text-xs font-medium text-primary">
                    {openAccordion === 'address' ? 'Choose' : selectedAddress ? 'Edit' : ''}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-5 transition-[height] duration-300 ease-in-out sm:px-7">
                  {addressLoadError ? (
                    <p role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-900">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" />
                      <span>{addressLoadError} You can still add a new delivery address below.</span>
                    </p>
                  ) : null}
                  {!addresses.length && !addressLoadError ? (
                    <p className="mb-5 rounded-xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                      You have no delivery address saved. Add one below to get shipping options.
                    </p>
                  ) : null}
                  {addresses.length ? (
                    <div className="mb-5 grid gap-3 sm:grid-cols-2">
                      {addresses.map((address) => {
                        const isSelected = selectedAddressId === address.id && !useNewAddress;
                        return (
                          <button
                            key={address.id}
                            type="button"
                            onClick={() => {
                              setSelectedAddressId(address.id);
                              setUseNewAddress(false);
                              setPageError('');
                              setOpenAccordion('shipping');
                              if (!isSelected || !quotesLoaded) {
                                void fetchShippingOptions(address.id);
                              }
                            }}
                            className={`relative rounded-xl border p-4 text-left transition-colors ${
                              isSelected
                                ? 'border-primary bg-primary/[0.035] ring-1 ring-primary'
                                : 'hover:border-foreground/30'
                            }`}
                          >
                            {isSelected ? <Check className="absolute right-3 top-3 size-4 text-primary" /> : null}
                            <span className="block pr-5 text-sm font-semibold">{address.firstName} {address.lastName}</span>
                            {address.isDefault ? <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Default</span> : null}
                            <span className="mt-2 block space-y-0.5 text-xs leading-5 text-muted-foreground">
                              {formatAddress(address).slice(2).map((line, index) => <span key={`${index}-${line}`} className="block">{line}</span>)}
                              <span className="block">{address.phone}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {addresses.length ? (
                    <button
                      type="button"
                      onClick={() => {
                        quoteRequestSequence.current += 1;
                        setBusy(null);
                        setUseNewAddress(true);
                        setSelectedAddressId('');
                        setQuotes({});
                        setQuotesLoaded(false);
                        setShippingErrors({});
                        setRetryableShippingErrors({});
                        setLoadingShippingItemIds([]);
                        setShippingRequestError('');
                        setSelectedQuotes({});
                        setPageError('');
                      }}
                      className={`mb-5 flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                        useNewAddress ? 'border-primary bg-primary/[0.035] ring-1 ring-primary' : 'hover:border-foreground/30'
                      }`}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground"><Plus className="size-4" /></span>
                      <span>
                        <span className="block text-sm font-semibold">Add a new address</span>
                        <span className="mt-1 block text-xs text-muted-foreground">Your address is securely saved to your account.</span>
                      </span>
                    </button>
                  ) : null}
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
                  {pageError ? <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-destructive"><CircleAlert className="size-4 shrink-0" />{pageError}</p> : null}
                  {useNewAddress || addresses.length === 0 ? (
                    <Button className="mt-6 w-full" disabled={busy !== null} onClick={() => void saveNewAddressAndGetQuotes()}>
                      {busy === 'quotes'
                        ? <><Spinner className="mr-2" />Saving address & finding options…</>
                        : <>Save address & find shipping options <ChevronRight className="ml-2 size-4" /></>}
                    </Button>
                  ) : null}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="shipping" disabled={!selectedAddressId} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                <AccordionTrigger className="items-center px-5 py-5 hover:no-underline sm:px-7">
                  <span className="flex min-w-0 items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Truck className="size-5" /></span>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold">Shipping method</span>
                      <span className="mt-1 block text-sm font-normal text-muted-foreground">
                        {selectedAddress ? `Delivery options for ${selectedAddress.city}, ${selectedAddress.countryName}` : 'Choose a delivery address to see available options.'}
                      </span>
                    </span>
                  </span>
                  {busy === 'quotes' && openAccordion === 'shipping' ? <Spinner className="mr-3 size-4 shrink-0" /> : null}
                </AccordionTrigger>
                <AccordionContent className="px-5 transition-[height] duration-300 ease-in-out sm:px-7">
                  {shippingRequestError ? (
                    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{shippingRequestError}</p>
                      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void fetchShippingOptions(selectedAddressId)}>
                        Try again
                      </Button>
                    </div>
                  ) : null}
                  <>
                      <p className="mb-5 text-sm text-muted-foreground">Choose a delivery service for each item in your order.</p>
                      <div className="space-y-5">
                        {checkout.items.map((item) => (
                          <div key={item.id} className="border-t pt-4 first:border-0 first:pt-0">
                            <div className="mb-3 flex min-w-0 items-center gap-3">
                              <div className="size-12 shrink-0 overflow-hidden rounded-lg border bg-muted">
                                {item.imageSnapshot ? (
                                  <CustomImage
                                    src={item.imageSnapshot}
                                    alt={item.productNameSnapshot}
                                    width={48}
                                    height={48}
                                    className="size-full"
                                  />
                                ) : (
                                  <div aria-hidden="true" className="size-full bg-gradient-to-br from-muted to-muted-foreground/10" />
                                )}
                              </div>
                              <h3 title={item.productNameSnapshot} className="line-clamp-2 min-w-0 text-sm font-medium leading-5">
                                {item.productNameSnapshot}
                              </h3>
                            </div>
                            <div className="grid gap-2">
                              {loadingShippingItemIds.includes(item.id) ? (
                                <div role="status" aria-label={`Loading shipping methods for ${item.productNameSnapshot}`} className="space-y-2">
                                  <div className="h-[4.5rem] animate-pulse rounded-xl border bg-muted/50" />
                                  <div className="h-[4.5rem] animate-pulse rounded-xl border bg-muted/50" />
                                  <span className="sr-only">Finding delivery options…</span>
                                </div>
                              ) : null}
                              {(quotes[item.id] ?? []).map((option) => (
                                <label key={option.quoteId} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
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
                              {!loadingShippingItemIds.includes(item.id) && shippingErrors[item.id] ? (
                                <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-900">
                                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                  <span>{shippingErrors[item.id]}</span>
                                </p>
                              ) : !shippingRequestError && !loadingShippingItemIds.includes(item.id) && quotesLoaded && !(quotes[item.id]?.length) ? (
                                <p role="status" className="text-sm text-muted-foreground">No shipping options are currently available for this item.</p>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                      {Object.values(retryableShippingErrors).some(Boolean) ? (
                        <Button className="mt-5" variant="outline" size="sm" disabled={busy !== null} onClick={() => void fetchShippingOptions(selectedAddressId)}>
                          Try shipping options again
                        </Button>
                      ) : null}
                      {quotesLoaded ? (
                        <>
                          <div className="mt-5 flex items-center justify-between border-t pt-4 text-sm">
                            <span className="text-muted-foreground">Shipping total</span><span className="font-semibold">{money(shippingTotal)}</span>
                          </div>
                          <Button
                            className="mt-5 hidden h-11 w-full font-bold lg:flex"
                            disabled={busy !== null || checkout.items.some((item) => !selectedQuotes[item.id])}
                            onClick={() => void continueToPayment()}
                          >
                            {busy === 'advance' ? <><Spinner className="mr-2" />Securing delivery details…</> : <>Continue to payment <ChevronRight className="ml-2 size-4" /></>}
                          </Button>
                        </>
                      ) : null}
                  </>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : isFinalized ? null : (
            <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
              <div className="mb-6 flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><CreditCard className="size-5" /></span>
                <div>
                  <h2 className="text-lg font-semibold">Payment</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Pay securely with PayPal without leaving checkout.</p>
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
                  onApprovalComplete={completePayPalApproval}
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

        <aside className="hidden h-fit rounded-2xl border bg-card p-5 shadow-sm lg:sticky lg:top-24 lg:block">
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
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Shipping</span><span>{money(step === 1 ? (quotesLoaded ? shippingTotal : 0) : checkout.shippingTotal)}</span></div>
            <div className="flex justify-between gap-3 border-t pt-4 text-base font-semibold"><span>Total</span><span>{money(step === 1 ? (quotesLoaded ? estimatedTotal : checkout.subtotal) : checkout.total)}</span></div>
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
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 p-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden">
        <div className="mx-auto max-w-6xl">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left mb-1"
            aria-expanded={mobileSummaryOpen}
            aria-controls="mobile-checkout-summary"
            onClick={() => setMobileSummaryOpen((open) => !open)}
          >
            <span className="text-[18px] font-bold">Order Total</span>
            <span className="flex items-center gap-2">
              <span className="text-right">
                <strong className="text-[18px] tabular-nums text-foreground">
                  {money(step === 1 ? (quotesLoaded ? estimatedTotal : checkout.subtotal) : checkout.total)}
                </strong>
              </span>
              {mobileSummaryOpen ? <ChevronDown className="size-5" /> : <ChevronUp className="size-5" />}
            </span>
          </button>
          <div
            id="mobile-checkout-summary"
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
              mobileSummaryOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="max-h-[40svh] space-y-4 overflow-y-auto border-t mt-2 py-3">
                {checkout.items.map((item) => (
                  <div key={item.id} className="flex min-w-0 items-center gap-3">
                    <div className="relative size-12 shrink-0 overflow-hidden rounded-lg border bg-muted">
                      {item.imageSnapshot ? (
                        <CustomImage
                          src={item.imageSnapshot}
                          alt={item.productNameSnapshot}
                          width={48}
                          height={48}
                          className="size-full"
                        />
                      ) : null}
                      <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-foreground text-[10px] font-medium text-background">
                        {item.quantity}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium">{item.productNameSnapshot}</p>
                      {item.variantLabelSnapshot ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.variantLabelSnapshot}</p>
                      ) : null}
                    </div>
                    <p className="shrink-0 text-sm font-medium">{money(item.unitPriceSnapshot * item.quantity)}</p>
                  </div>
                ))}
                <div className="space-y-2 border-t pt-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{money(checkout.subtotal)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Shipping</span>
                    <span>{money(step === 1 ? (quotesLoaded ? shippingTotal : 0) : checkout.shippingTotal)}</span>
                  </div>
                  <div className="flex justify-between gap-3 border-t pt-2 font-semibold">
                    <span>Total</span>
                    <span>{money(step === 1 ? (quotesLoaded ? estimatedTotal : checkout.subtotal) : checkout.total)}</span>
                  </div>
                </div>
                <div className="flex gap-2 rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                  <span>Protected checkout. Your order is only placed after PayPal confirms your payment.</span>
                </div>
              </div>
            </div>
          </div>
          {step === 1 ? (
            <Button
              className="mt-2 h-11 w-full font-bold"
              disabled={
                busy !== null ||
                !quotesLoaded ||
                !selectedAddressId ||
                checkout.items.some((item) => !selectedQuotes[item.id])
              }
              onClick={() => void continueToPayment()}
            >
              {busy === 'advance'
                ? <><Spinner className="mr-2" />Securing delivery details…</>
                : <>Continue to payment <ChevronRight className="ml-2 size-4" /></>}
            </Button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
