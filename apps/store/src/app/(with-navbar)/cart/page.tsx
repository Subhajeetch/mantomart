'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CustomImage from '@/components/custom-image';
import { useSession } from '@/lib/auth-client';
import { useNeedLogin } from '@/components/need-login-context';
import { useWishlist } from '@/components/wishlist-context';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPriceCents, percentOff } from '@/components/homepage/format';
import { startCartCheckout, type CartItem } from './api';
import { CartResponsiveDialog, SavingOverlay } from './cart-dialog';
import { useCart, type CartItemUpdate } from '@/components/cart-context';

const PENDING_CHECKOUT_KEY = 'ragimart.pending-checkout';
const readPendingCheckout = () => typeof window !== 'undefined' && window.sessionStorage.getItem(PENDING_CHECKOUT_KEY) === '1';
const setPendingCheckout = () => window.sessionStorage.setItem(PENDING_CHECKOUT_KEY, '1');
const clearPendingCheckout = () => window.sessionStorage.removeItem(PENDING_CHECKOUT_KEY);

function optionNames(item: CartItem) {
  const current = item.variants.find((variant) => variant.id === item.skuId);
  if (!current) return [];
  return Object.keys(current.options).filter((name) => {
    const values = new Set(
      item.variants
        .map((variant) => variant.options[name])
        .filter((value): value is string => Boolean(value)),
    );
    return values.size > 2;
  });
}

function chooseVariant(item: CartItem, skuId: string, name: string, value: string) {
  const current = item.variants.find((variant) => variant.id === skuId);
  const next = item.variants.find((variant) =>
    variant.options[name] === value &&
    Object.entries(current?.options ?? {}).every(
      ([key, currentValue]) => key === name || variant.options[key] === currentValue,
    ),
  );
  return next?.id ?? item.variants.find((variant) => variant.options[name] === value)?.id ?? skuId;
}

function mobileVariantName(name: string) {
  return name.length > 6 ? `${name.slice(0, 6)}…` : name;
}

function CartSkeleton() {
  return (
    <main className="mx-auto min-w-0 max-w-7xl px-3 py-8 sm:px-6" aria-busy="true" aria-label="Loading shopping bag">
      <div className="grid min-w-0 gap-6 pb-36 lg:grid-cols-[1fr_360px] lg:pb-0">
        <section className="min-w-0 space-y-3">
          <div className="flex min-w-0 items-center justify-between gap-2 border-b pb-4">
            <Skeleton className="h-4 w-20" />
            <div className="flex min-w-0 items-center gap-2">
              <Skeleton className="h-4 w-16 sm:w-20" />
              <Skeleton className="hidden h-4 w-28 sm:block" />
              <Skeleton className="hidden h-4 w-32 sm:block" />
              <Skeleton className="h-8 w-8 rounded-md sm:hidden" />
            </div>
          </div>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex min-w-0 w-full gap-2 overflow-hidden border p-2.5 sm:gap-4 sm:p-3">
              <Skeleton className="size-20 shrink-0 sm:size-32" />
              <div className="min-w-0 flex-1 space-y-3 py-0.5">
                <div className="flex items-start justify-between gap-2">
                  <Skeleton className="h-5 w-1/2 max-w-64" />
                  <Skeleton className="size-5 shrink-0 rounded-full" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="h-8 w-20 max-[374px]:w-16 sm:w-24" />
                  <Skeleton className="h-8 w-16 max-[374px]:w-14 sm:w-20" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-12" />
                </div>
              </div>
            </div>
          ))}
        </section>
        <CartSummarySkeleton />
      </div>
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 p-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-10 min-w-0 flex-1 rounded-none" />
        </div>
      </div>
    </main>
  );
}

function CartSummarySkeleton() {
  return (
    <aside className="hidden h-fit space-y-5 border p-5 sm:block">
      <Skeleton className="h-4 w-28" />
      <div className="space-y-3">
        <div className="flex justify-between"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-16" /></div>
        <div className="flex justify-between"><Skeleton className="h-4 w-28" /><Skeleton className="h-4 w-16" /></div>
        <div className="flex justify-between"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-12" /></div>
      </div>
      <div className="flex justify-between border-t pt-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="h-10 w-full rounded-none" />
    </aside>
  );
}

function VariantControls({
  item,
  onChange,
}: {
  item: CartItem;
  onChange: (skuId: string) => void;
}) {
  const current = item.variants.find((variant) => variant.id === item.skuId);
  if (!current) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {optionNames(item).map((name) => {
        const values = Array.from(new Set(item.variants.map((variant) => variant.options[name]).filter(Boolean)));
        const image = current.optionImages[name];
        return (
          <Select
            key={name}
            value={current.options[name] ?? ''}
            onValueChange={(value) => {
              if (value) onChange(chooseVariant(item, item.skuId, name, value));
            }}
          >
            <SelectTrigger size="sm" className="min-w-0 max-w-full">
              <SelectValue>
                {image ? <CustomImage src={image} alt="" width={20} height={20} className="size-5 rounded-full" /> : null}
                <span className="truncate">
                  <span className="text-muted-foreground">
                    <span className="sm:hidden" title={name}>{mobileVariantName(name)}</span>
                    <span className="hidden sm:inline">{name}</span>:
                  </span>{' '}
                  {current.options[name]}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {values.map((value) => {
                const match = item.variants.find((variant) => variant.options[name] === value);
                const valueImage = match?.optionImages[name];
                return (
                  <SelectItem key={value} value={value}>
                    {valueImage ? <CustomImage src={valueImage} alt="" width={20} height={20} className="size-5 rounded-full" /> : null}
                    {value}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        );
      })}
    </div>
  );
}

export default function CartPage() {
  const router = useRouter();
  const { data: session, isPending: authPending } = useSession();
  const { openNeedLogin } = useNeedLogin();
  const { openPicker } = useWishlist();
  const {
    items,
    cartLoading,
    error: cartError,
    refreshCart,
    updateItem,
    removeItem,
    isItemBusy,
  } = useCart();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [quantityItem, setQuantityItem] = useState<CartItem | null>(null);
  const [confirmItem, setConfirmItem] = useState<CartItem | null>(null);
  const [confirmRemoveSelected, setConfirmRemoveSelected] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const pendingCheckedRef = useRef(false);
  const isLoggedIn = Boolean(session?.user?.id);
  const selectedItems = items.filter((item) => item.selected);
  const allItemsSelected = items.length > 0 && selectedItems.length === items.length;

  const load = useCallback(async () => {
    try { await refreshCart(); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load your cart.'); }
  }, [refreshCart]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('cart-updated', refresh);
    return () => window.removeEventListener('cart-updated', refresh);
  }, [load]);

  const selectedTotal = useMemo(() => selectedItems.reduce((sum, item) => sum + item.unitPriceSnapshot * item.quantity, 0), [selectedItems]);
  const savings = useMemo(() => selectedItems.reduce((sum, item) => sum + Math.max(0, ((item.compareAtPriceSnapshot ?? item.unitPriceSnapshot) - item.unitPriceSnapshot) * item.quantity), 0), [selectedItems]);
  const mrpTotal = selectedTotal + savings;

  async function update(itemId: string, patch: CartItemUpdate) {
    try {
      await updateItem(itemId, patch);
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update the item.'); }
  }
  async function remove(itemId: string) {
    try { await removeItem(itemId); setError(''); setConfirmItem(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to remove the item.'); }
  }
  async function removeSelected() {
    if (!selectedItems.length) return;
    try {
      for (const item of selectedItems) {
        await removeItem(item.id);
      }
      setError('');
      setConfirmRemoveSelected(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to remove the selected items.');
    }
  }
  function moveToWishlist(item: CartItem) {
    openPicker({ id: item.productId, slug: item.productSlugSnapshot, name: item.productNameSnapshot, image: item.imageSnapshot, price: item.unitPriceSnapshot }, () => void remove(item.id));
    setConfirmItem(null);
  }
  async function checkout() {
    if (!selectedItems.length) { setError('Select at least one item to continue.'); return; }
    setBusyId('checkout');
    try { const { sessionId } = await startCartCheckout(); router.push(`/checkout/${encodeURIComponent(sessionId)}`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to start checkout.'); }
    finally { setBusyId(null); }
  }
  useEffect(() => {
    if (!isLoggedIn) return;
    if (readPendingCheckout() && !pendingCheckedRef.current && selectedItems.length) {
      clearPendingCheckout(); pendingCheckedRef.current = true; void checkout();
    }
  }, [isLoggedIn, selectedItems.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (authPending || cartLoading) return <CartSkeleton />;
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="sr-only">Shopping Bag</h1>
      {error || cartError ? <p className="mb-4 border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || cartError}</p> : null}
      {!items.length ? (
        <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
          <CustomImage src="/images/empty-cart-mantomart.webp" alt="An empty shopping bag" className="h-48 w-48" width={224} height={224} priority />
          <h2 className="mt-6 text-xl font-semibold">Looks like it&apos;s empty</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">Your bag is waiting for something special.</p>
        </div>
      ) : (
        <div className="grid gap-6 pb-48 lg:grid-cols-[1fr_360px] lg:pb-0">
          <section className="space-y-3">
            <div className="flex items-center justify-between border-b pb-4 text-sm font-semibold">
              <span>{items.length} ITEM{items.length === 1 ? '' : 'S'}</span>
              <div className="flex items-center gap-3">
                {!allItemsSelected ? <button type="button" className="text-primary" onClick={() => Promise.all(items.map((item) => update(item.id, { selected: true })))}>SELECT ALL</button> : null}
                {selectedItems.length ? (
                  <button
                    type="button"
                    className="text-destructive"
                    onClick={() => setConfirmRemoveSelected(true)}
                  >
                    <Trash2 className="mr-1 inline size-4" />REMOVE SELECTED
                  </button>
                ) : null}
              </div>
            </div>
            {items.map((item) => {
              const off = percentOff(item.unitPriceSnapshot, item.compareAtPriceSnapshot);
              const busy = isItemBusy(item.id);
              return (
                <article key={item.id} className="relative flex min-w-0 w-full gap-2 overflow-hidden border p-2.5 sm:gap-4 sm:p-3">
                  <Checkbox checked={item.selected} disabled={busy} onCheckedChange={(checked) => void update(item.id, { selected: checked === true })} aria-label={`Select ${item.productNameSnapshot}`} className="absolute left-2 top-2 z-10 bg-background text-foreground shadow-[2px_2px_0_0_currentColor]" />
                  <div className="size-20 shrink-0 bg-muted sm:size-32 outline">
                    {item.imageSnapshot ? <CustomImage src={item.imageSnapshot} alt={item.productNameSnapshot} className="size-full object-cover" width={128} height={128} /> : null}
                  </div>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h2 className="line-clamp-2 text-[14px] font-semibold"><Link href={item.href} className="hover:underline">{item.productNameSnapshot}</Link></h2>
                      </div>
                      <button type="button" className="shrink-0" aria-label="Item actions" disabled={busy} onClick={() => setConfirmItem(item)}><X className="size-5" /></button>
                    </div>
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                      {item.variants.length > 1 ? (
                        <VariantControls item={item} onChange={(skuId) => void update(item.id, { skuId })} />
                      ) : null}
                      <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={busy} onClick={() => setQuantityItem(item)}>Qty: {item.quantity} <ChevronDown /></Button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold">{formatPriceCents(item.unitPriceSnapshot)}</span>{item.compareAtPriceSnapshot && item.compareAtPriceSnapshot > item.unitPriceSnapshot ? <><span className="text-muted-foreground line-through">{formatPriceCents(item.compareAtPriceSnapshot)}</span><span className="bg-rose-100 px-1.5 text-xs text-rose-600">-{off}%</span></> : null}</div>
                  </div>
                  {busy ? <div className="absolute inset-0 flex items-center justify-center bg-background/60"><Loader2 className="animate-spin" /></div> : null}
                </article>
              );
            })}
          </section>
          <aside className="hidden h-fit border p-5 sm:block lg:hidden">
            <h2 className="text-sm font-semibold">PRICE DETAILS</h2>
            <div className="mt-5 flex justify-between text-sm"><span>Total (MRP)</span><span>{formatPriceCents(mrpTotal)}</span></div>
            <div className="mt-2 flex justify-between text-sm"><span>Item discount</span><span className="text-emerald-600">− {formatPriceCents(savings)}</span></div>
            <div className="mt-2 flex justify-between text-sm"><span>Shipping</span><span className="text-emerald-600">FREE</span></div>
            <div className="mt-4 flex justify-between border-t pt-4 font-semibold"><span>Total Amount</span><span>{formatPriceCents(selectedTotal)}</span></div>
            <Button className="mt-6 w-full rounded-none" disabled={busyId === 'checkout' || !selectedItems.length} onClick={() => {
              if (!isLoggedIn) { setPendingCheckout(); openNeedLogin({ title: 'Log in to continue', description: 'Log in to review your selected items and complete your purchase.', returnTo: window.location.href, onDismiss: clearPendingCheckout }); return; }
              void checkout();
            }}>{busyId === 'checkout' ? <Loader2 className="animate-spin" /> : 'CHECKOUT'}</Button>
          </aside>
          <aside className="hidden h-fit border p-5 lg:block">
            <h2 className="text-sm font-semibold">PRICE DETAILS</h2>
            <div className="mt-5 flex justify-between text-sm"><span>Total (MRP)</span><span>{formatPriceCents(mrpTotal)}</span></div>
            <div className="mt-2 flex justify-between text-sm"><span>Item discount</span><span className="text-emerald-600">− {formatPriceCents(savings)}</span></div>
            <div className="mt-2 flex justify-between text-sm"><span>Shipping</span><span className="text-emerald-600">FREE</span></div>
            <div className="mt-4 flex justify-between border-t pt-4 font-semibold"><span>Total Amount</span><span>{formatPriceCents(selectedTotal)}</span></div>
            <Button className="mt-6 w-full rounded-none" disabled={busyId === 'checkout' || !selectedItems.length} onClick={() => {
              if (!isLoggedIn) { setPendingCheckout(); openNeedLogin({ title: 'Log in to continue', description: 'Log in to review your selected items and complete your purchase.', returnTo: window.location.href, onDismiss: clearPendingCheckout }); return; }
              void checkout();
            }}>{busyId === 'checkout' ? <Loader2 className="animate-spin" /> : 'CHECKOUT'}</Button>
          </aside>
        </div>
      )}

      {items.length ? (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 p-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur sm:hidden">
          <div className="mx-auto max-w-6xl">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              aria-expanded={mobileDetailsOpen}
              onClick={() => setMobileDetailsOpen((open) => !open)}
            >
              <span>
                <span className="block text-xs text-muted-foreground">Total Amount</span>
                <strong className="text-lg tabular-nums">{formatPriceCents(selectedTotal)}</strong>
              </span>
              {mobileDetailsOpen ? <ChevronDown className="size-5" /> : <ChevronUp className="size-5" />}
            </button>
            <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${mobileDetailsOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="min-h-0 overflow-hidden">
                <div className="space-y-2 border-t py-3 text-sm">
                  <div className="flex justify-between"><span>Total (MRP)</span><span>{formatPriceCents(mrpTotal)}</span></div>
                  <div className="flex justify-between"><span>Item discount</span><span className="text-emerald-600">− {formatPriceCents(savings)}</span></div>
                  <div className="flex justify-between"><span>Shipping</span><span className="text-emerald-600">FREE</span></div>
                  <div className="flex justify-between border-t pt-2 font-semibold"><span>Total Amount</span><span>{formatPriceCents(selectedTotal)}</span></div>
                </div>
              </div>
            </div>
            <Button className="mt-2 w-full rounded-none" disabled={busyId === 'checkout' || !selectedItems.length} onClick={() => {
              if (!isLoggedIn) {
                setPendingCheckout();
                openNeedLogin({ title: 'Log in to continue', description: 'Log in to review your selected items and complete your purchase.', returnTo: window.location.href, onDismiss: clearPendingCheckout });
                return;
              }
              void checkout();
            }}>
              {busyId === 'checkout' ? <Loader2 className="animate-spin" /> : 'CHECKOUT'}
            </Button>
          </div>
        </div>
      ) : null}

      <CartResponsiveDialog open={Boolean(quantityItem)} onOpenChange={(open) => !open && setQuantityItem(null)} title="Choose quantity" description="Select a quantity from 1 to 10.">
        {quantityItem ? <div className="relative grid grid-cols-5 gap-2"><SavingOverlay saving={isItemBusy(quantityItem.id)} />{Array.from({ length: 10 }, (_, index) => index + 1).map((quantity) => <Button key={quantity} type="button" variant={quantityItem.quantity === quantity ? 'default' : 'outline'} disabled={isItemBusy(quantityItem.id)} onClick={async () => { await update(quantityItem.id, { quantity }); setQuantityItem(null); }}>{quantity}{quantityItem.quantity === quantity ? <Check /> : null}</Button>)}</div> : null}
      </CartResponsiveDialog>
      <CartResponsiveDialog
        open={Boolean(confirmItem)}
        onOpenChange={(open) => !open && setConfirmItem(null)}
        title="Move from Bag"
        description="Are you sure you want to move this item from bag?"
        footer={
          confirmItem ? (
            <div className="grid grid-cols-2 gap-0 border-t -m-4">
              <Button
                type="button"
                variant="ghost"
                className="h-12 rounded-none border-r text-xs font-semibold text-muted-foreground"
                disabled={isItemBusy(confirmItem.id)}
                onClick={() => void remove(confirmItem.id)}
              >
                REMOVE
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-12 rounded-none text-xs font-semibold text-primary hover:text-primary/80"
                disabled={isItemBusy(confirmItem.id)}
                onClick={() => moveToWishlist(confirmItem)}
              >
                MOVE TO WISHLIST
              </Button>
            </div>
          ) : null
        }
      >
        {confirmItem ? (
          <div className="relative flex items-center gap-3">
            <SavingOverlay saving={isItemBusy(confirmItem.id)} />
            <div className="size-16 shrink-0 overflow-hidden bg-muted sm:size-20">
              {confirmItem.imageSnapshot ? (
                <CustomImage
                  src={confirmItem.imageSnapshot}
                  alt={confirmItem.productNameSnapshot}
                  width={80}
                  height={80}
                  className="size-full"
                />
              ) : null}
            </div>
            <p className="line-clamp-2 text-sm font-semibold">{confirmItem.productNameSnapshot}</p>
          </div>
        ) : null}
      </CartResponsiveDialog>
      <CartResponsiveDialog
        open={confirmRemoveSelected}
        onOpenChange={setConfirmRemoveSelected}
        title="Are you sure?"
        description={
          <>
            Are you sure you want to remove{' '}
            <strong>{selectedItems.length} Products</strong> from your cart?
          </>
        }
        footer={
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              disabled={selectedItems.some((item) => isItemBusy(item.id))}
              onClick={() => setConfirmRemoveSelected(false)}
            >
              CANCEL
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-none"
              disabled={selectedItems.some((item) => isItemBusy(item.id))}
              onClick={() => void removeSelected()}
            >
              REMOVE SELECTED
            </Button>
          </div>
        }
      >
        <div className="relative min-h-2">
          {selectedItems.some((item) => isItemBusy(item.id)) ? <SavingOverlay saving /> : null}
        </div>
      </CartResponsiveDialog>
    </main>
  );
}
