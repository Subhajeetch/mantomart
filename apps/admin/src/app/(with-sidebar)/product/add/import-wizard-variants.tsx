'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Layers,
  List,
  Package,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ProxiedImg } from '@/app/(with-sidebar)/settings/proxied-image';
import { centsToDisplay, type SkuDraft } from './storage';
import {
  canUseGroupedVariants,
  computeDiscountPercent,
  formatDiscountPercent,
  getSecondaryOptionLabel,
  getSharedSkuField,
  getSkuGroupDimensions,
  groupSkusByProperty,
  MIN_VARIANT_DISCOUNT_PERCENT,
  pickDefaultGroupBy,
  shouldDefaultToGroupedView,
  type VariantViewMode,
} from './import-wizard-utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Matches API: $1.50 payment-processor / tax buffer (cents). */
const PAYMENT_PROCESSOR_FEE_CENTS = 150;

function parseDollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const dollars = Number.parseFloat(trimmed);
  if (!Number.isFinite(dollars)) return null;
  return Math.max(0, Math.round(dollars * 100));
}

function parseStock(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

function dollarsDisplay(cents: number | null | 'mixed'): string {
  if (cents === 'mixed' || cents == null) return '';
  return (cents / 100).toFixed(2);
}

function stockDisplay(stock: number | null | 'mixed'): string {
  if (stock === 'mixed' || stock == null) return '';
  return String(stock);
}

/**
 * Frontend mirror of server `computeEstProfit`:
 * our price − AE actual (sale → list) − $1.50.
 * Preview only — the API recomputes and stores the real value on save.
 */
function computeEstProfitCents(
  price: number,
  aeSalePrice: number | null,
  aePrice: number | null
): number | null {
  if (!Number.isFinite(price) || price < 0) return null;
  const aeCost =
    aeSalePrice !== null && Number.isFinite(aeSalePrice)
      ? aeSalePrice
      : aePrice !== null && Number.isFinite(aePrice)
        ? aePrice
        : null;
  if (aeCost === null || aeCost < 0) return null;
  return Math.round(price - aeCost - PAYMENT_PROCESSOR_FEE_CENTS);
}

function formatEstProfitCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${centsToDisplay(Math.abs(cents))}`;
}

function formatEstProfitRange(skus: SkuDraft[]): string | null {
  const profits = skus
    .map((sku) =>
      computeEstProfitCents(sku.price, sku.aeSalePrice, sku.aePrice)
    )
    .filter((n): n is number => n !== null);
  if (!profits.length) return null;
  const min = Math.min(...profits);
  const max = Math.max(...profits);
  if (min === max) return formatEstProfitCents(min);
  return `${formatEstProfitCents(min)} – ${formatEstProfitCents(max)}`;
}

function formatDiscountRange(skus: SkuDraft[]): string | null {
  const discounts = skus
    .map((sku) => computeDiscountPercent(sku.price, sku.compareAtPrice))
    .filter((n): n is number => n !== null);
  if (!discounts.length) return null;
  const min = Math.min(...discounts);
  const max = Math.max(...discounts);
  if (Math.abs(min - max) < 0.05) return formatDiscountPercent(min);
  const minLabel = formatDiscountPercent(min);
  const maxLabel = formatDiscountPercent(max);
  if (!minLabel || !maxLabel) return null;
  return `${minLabel.replace(' off', '')} – ${maxLabel}`;
}

/** Shown directly under the Our price ($) input. */
function EstProfitHint({
  cents,
  rangeLabel,
  className,
}: {
  cents?: number | null;
  /** Preformatted range for mixed groups, e.g. "$1.20 – $2.40". */
  rangeLabel?: string | null;
  className?: string;
}) {
  const display =
    rangeLabel ??
    (cents != null && Number.isFinite(cents)
      ? formatEstProfitCents(cents)
      : null);
  if (!display) return null;

  const isNegative =
    display.startsWith('-') || (cents != null && cents < 0);

  return (
    <p
      className={cn(
        'text-[11px] font-medium leading-tight tabular-nums',
        isNegative
          ? 'text-destructive'
          : 'text-emerald-700 dark:text-emerald-400',
        className
      )}
      title="Estimated profit = our price − AE cost − $1.50 (preview; saved on publish)"
    >
      Est. profit: {display}
    </p>
  );
}

/**
 * Shown directly under the Compare at ($) input.
 * Green when ≥ min discount, amber when below, muted when unset.
 */
function DiscountHint({
  percent,
  rangeLabel,
  className,
}: {
  percent?: number | null;
  /** Preformatted range for mixed groups. */
  rangeLabel?: string | null;
  className?: string;
}) {
  if (rangeLabel) {
    return (
      <p
        className={cn(
          'text-[11px] font-medium leading-tight tabular-nums text-muted-foreground',
          className
        )}
        title={`Discount vs Compare at. Selected variants need ≥${MIN_VARIANT_DISCOUNT_PERCENT}% off to continue.`}
      >
        {rangeLabel}
      </p>
    );
  }

  if (percent == null || !Number.isFinite(percent)) {
    return (
      <p
        className={cn(
          'text-[11px] leading-tight text-muted-foreground',
          className
        )}
        title={`Set Compare at above Our price. Minimum ${MIN_VARIANT_DISCOUNT_PERCENT}% off required to continue.`}
      >
        Set compare-at for % off
      </p>
    );
  }

  const label = formatDiscountPercent(percent);
  if (!label) return null;

  const meetsMin = percent + 1e-9 >= MIN_VARIANT_DISCOUNT_PERCENT;

  return (
    <p
      className={cn(
        'text-[11px] font-medium leading-tight tabular-nums',
        meetsMin
          ? 'text-emerald-700 dark:text-emerald-400'
          : percent > 0
            ? 'text-amber-600 dark:text-amber-500'
            : 'text-destructive',
        className
      )}
      title={
        meetsMin
          ? `Discount vs Compare at (${label})`
          : `Need at least ${MIN_VARIANT_DISCOUNT_PERCENT}% off to continue (currently ${label})`
      }
    >
      {label}
      {!meetsMin && percent > 0 ? (
        <span className="font-normal">
          {' '}
          · min {MIN_VARIANT_DISCOUNT_PERCENT}%
        </span>
      ) : null}
    </p>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

type ImportWizardVariantsProps = {
  skus: SkuDraft[];
  selectedSkuCount: number;
  onUpdateSkus: (updater: (skus: SkuDraft[]) => SkuDraft[]) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportWizardVariants({
  skus,
  selectedSkuCount,
  onUpdateSkus,
}: ImportWizardVariantsProps) {
  const dimensions = useMemo(() => getSkuGroupDimensions(skus), [skus]);
  const groupingAvailable = canUseGroupedVariants(skus);
  const defaultGroupBy = useMemo(() => pickDefaultGroupBy(skus), [skus]);

  const [viewMode, setViewMode] = useState<VariantViewMode>(() =>
    shouldDefaultToGroupedView(skus) ? 'grouped' : 'list'
  );
  const [groupBy, setGroupBy] = useState<string>(
    () => defaultGroupBy ?? dimensions[0]?.propertyName ?? ''
  );

  // Keep groupBy valid when SKUs change (e.g. draft resume)
  useEffect(() => {
    if (!groupingAvailable) {
      setViewMode('list');
      return;
    }
    if (!groupBy || !dimensions.some((d) => d.propertyName === groupBy)) {
      setGroupBy(defaultGroupBy ?? dimensions[0]?.propertyName ?? '');
    }
  }, [groupingAvailable, dimensions, groupBy, defaultGroupBy]);

  // Bulk-all toolbar draft fields
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkCompare, setBulkCompare] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set()
  );

  const groups = useMemo(() => {
    if (viewMode !== 'grouped' || !groupBy) return [];
    return groupSkusByProperty(skus, groupBy);
  }, [skus, viewMode, groupBy]);

  const toggleExpanded = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateSkuAt = (
    index: number,
    patch: Partial<SkuDraft> | ((sku: SkuDraft) => SkuDraft)
  ) => {
    onUpdateSkus((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        return typeof patch === 'function' ? patch(s) : { ...s, ...patch };
      })
    );
  };

  const updateSkusAtIndices = (
    indices: number[],
    patch: (sku: SkuDraft) => Partial<SkuDraft>
  ) => {
    const set = new Set(indices);
    onUpdateSkus((prev) =>
      prev.map((s, i) => (set.has(i) ? { ...s, ...patch(s) } : s))
    );
  };

  const selectAllInStock = (selected: boolean) => {
    onUpdateSkus((prev) =>
      prev.map((s) => ({
        ...s,
        selected: s.stock > 0 ? selected : false,
      }))
    );
  };

  const applyBulkToSelected = () => {
    const priceCents = parseDollarsToCents(bulkPrice);
    const compareCents =
      bulkCompare.trim() === ''
        ? undefined
        : parseDollarsToCents(bulkCompare);
    const stock = parseStock(bulkStock);

    if (priceCents == null && compareCents === undefined && stock == null) {
      return;
    }

    onUpdateSkus((prev) =>
      prev.map((s) => {
        if (!s.selected) return s;

        const next: SkuDraft = { ...s };
        if (priceCents != null) next.price = priceCents;
        if (compareCents !== undefined) {
          next.compareAtPrice = compareCents;
        }
        if (stock != null) {
          next.stock = stock;
          if (stock <= 0) next.selected = false;
        }
        return next;
      })
    );
  };

  const applyBulkToAll = () => {
    const priceCents = parseDollarsToCents(bulkPrice);
    const compareCents =
      bulkCompare.trim() === ''
        ? undefined
        : parseDollarsToCents(bulkCompare);
    const stock = parseStock(bulkStock);

    if (priceCents == null && compareCents === undefined && stock == null) {
      return;
    }

    onUpdateSkus((prev) =>
      prev.map((s) => {
        const next: SkuDraft = { ...s };
        if (priceCents != null) next.price = priceCents;
        if (compareCents !== undefined) {
          next.compareAtPrice = compareCents;
        }
        if (stock != null) {
          next.stock = stock;
          if (stock <= 0) next.selected = false;
        }
        return next;
      })
    );
  };

  const inStockCount = skus.filter((s) => s.stock > 0).length;

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">
            Variants ({selectedSkuCount} selected
            {skus.length > 0 ? ` of ${skus.length}` : ''})
          </h3>
          <p className="text-xs text-muted-foreground">
            {viewMode === 'grouped'
              ? 'Edit prices by group (e.g. all sizes of a color at once). Expand a group for per-size overrides.'
              : 'Prices are per variant. Out-of-stock variants (stock 0) stay unselected.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => selectAllInStock(true)}
            disabled={inStockCount === 0}
          >
            Select all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => selectAllInStock(false)}
            disabled={selectedSkuCount === 0}
          >
            Clear
          </Button>

          {groupingAvailable ? (
            <div className="flex rounded-md border p-0.5">
              <Button
                type="button"
                size="sm"
                variant={viewMode === 'grouped' ? 'secondary' : 'ghost'}
                className="h-8 gap-1.5 px-2.5"
                onClick={() => setViewMode('grouped')}
                aria-pressed={viewMode === 'grouped'}
              >
                <Layers className="h-3.5 w-3.5" />
                Grouped
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                className="h-8 gap-1.5 px-2.5"
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
              >
                <List className="h-3.5 w-3.5" />
                List
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Bulk apply bar — always useful with many variants */}
      {skus.length > 1 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="space-y-3 p-3 sm:p-4">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                Bulk edit
              </div>
              <p className="text-[11px] text-muted-foreground sm:text-xs">
                Fill any fields, then apply to selected variants or all.
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
              <div className="grid flex-1 grid-cols-1 gap-2 xs:grid-cols-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Our price ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={bulkPrice}
                    onChange={(e) => setBulkPrice(e.target.value)}
                    placeholder="e.g. 19.99"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Compare at ($)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={bulkCompare}
                    onChange={(e) => setBulkCompare(e.target.value)}
                    placeholder="e.g. 29.99"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1 xs:col-span-2 sm:col-span-1">
                  <Label className="text-xs">Stock</Label>
                  <Input
                    type="number"
                    min={0}
                    value={bulkStock}
                    onChange={(e) => setBulkStock(e.target.value)}
                    placeholder="Optional"
                    className="h-9"
                  />
                </div>
              </div>

              <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap lg:w-auto lg:shrink-0 lg:flex-col xl:flex-row">
                <Button
                  type="button"
                  size="sm"
                  className="h-9 w-full sm:w-auto lg:min-w-[11.5rem]"
                  onClick={applyBulkToSelected}
                  disabled={selectedSkuCount === 0}
                >
                  Apply to selected ({selectedSkuCount})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 w-full sm:w-auto lg:min-w-[11.5rem]"
                  onClick={applyBulkToAll}
                >
                  Apply to all ({skus.length})
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {viewMode === 'grouped' && groupingAvailable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs text-muted-foreground">Group by</Label>
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Property" />
            </SelectTrigger>
            <SelectContent>
              {dimensions.map((d) => (
                <SelectItem key={d.propertyName} value={d.propertyName}>
                  {d.propertyName} ({d.uniqueValueCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {groups.length} group{groups.length === 1 ? '' : 's'} · edit price
            once per group
          </span>
        </div>
      ) : null}

      {viewMode === 'grouped' && groupingAvailable && groupBy ? (
        <div className="space-y-3">
          {groups.map((group) => (
            <VariantGroupCard
              key={group.key}
              propertyName={group.propertyName}
              value={group.value}
              image={group.image}
              skuIndices={group.skuIndices}
              skus={skus}
              expanded={expandedGroups.has(group.key)}
              onToggleExpand={() => toggleExpanded(group.key)}
              onUpdateSkusAtIndices={updateSkusAtIndices}
              onUpdateSkuAt={updateSkuAt}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {skus.map((sku, skuIndex) => (
            <VariantListCard
              key={sku.aeSkuId + skuIndex}
              sku={sku}
              skuIndex={skuIndex}
              onUpdateSkuAt={updateSkuAt}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Grouped card ─────────────────────────────────────────────────────────────

function VariantGroupCard({
  propertyName,
  value,
  image,
  skuIndices,
  skus,
  expanded,
  onToggleExpand,
  onUpdateSkusAtIndices,
  onUpdateSkuAt,
}: {
  propertyName: string;
  value: string;
  image: string | null;
  skuIndices: number[];
  skus: SkuDraft[];
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdateSkusAtIndices: (
    indices: number[],
    patch: (sku: SkuDraft) => Partial<SkuDraft>
  ) => void;
  onUpdateSkuAt: (
    index: number,
    patch: Partial<SkuDraft> | ((sku: SkuDraft) => SkuDraft)
  ) => void;
}) {
  const groupSkus = skuIndices.map((i) => skus[i]).filter(Boolean) as SkuDraft[];
  const selectedInGroup = groupSkus.filter(
    (s) => s.selected && s.stock > 0
  ).length;
  const inStockInGroup = groupSkus.filter((s) => s.stock > 0).length;
  const allSelected =
    inStockInGroup > 0 &&
    groupSkus.every((s) => s.stock <= 0 || s.selected);
  const someSelected = groupSkus.some((s) => s.selected && s.stock > 0);

  const sharedPrice = getSharedSkuField(skus, skuIndices, 'price');
  const sharedCompare = getSharedSkuField(skus, skuIndices, 'compareAtPrice');
  const sharedStock = getSharedSkuField(skus, skuIndices, 'stock');

  // Local draft so mixed groups can accept a new value without fighting controlled display
  const [priceDraft, setPriceDraft] = useState(() =>
    dollarsDisplay(sharedPrice)
  );
  const [compareDraft, setCompareDraft] = useState(() =>
    dollarsDisplay(sharedCompare)
  );
  const [stockDraft, setStockDraft] = useState(() =>
    stockDisplay(sharedStock)
  );
  const [priceFocused, setPriceFocused] = useState(false);
  const [compareFocused, setCompareFocused] = useState(false);
  const [stockFocused, setStockFocused] = useState(false);

  // Sync drafts when external values change (and field not focused)
  useEffect(() => {
    if (!priceFocused) setPriceDraft(dollarsDisplay(sharedPrice));
  }, [sharedPrice, priceFocused]);
  useEffect(() => {
    if (!compareFocused) setCompareDraft(dollarsDisplay(sharedCompare));
  }, [sharedCompare, compareFocused]);
  useEffect(() => {
    if (!stockFocused) setStockDraft(stockDisplay(sharedStock));
  }, [sharedStock, stockFocused]);

  const aeSaleSample = groupSkus.find((s) => s.aeSalePrice != null)?.aeSalePrice;
  const totalStock = groupSkus.reduce((sum, s) => sum + s.stock, 0);
  const groupEstProfitLabel = formatEstProfitRange(groupSkus);
  const groupDiscountLabel = formatDiscountRange(groupSkus);
  const sharedDiscountPercent =
    sharedPrice !== 'mixed' &&
    sharedCompare !== 'mixed' &&
    typeof sharedPrice === 'number' &&
    (sharedCompare === null || typeof sharedCompare === 'number')
      ? computeDiscountPercent(sharedPrice, sharedCompare)
      : null;
  const discountIsMixed =
    sharedPrice === 'mixed' || sharedCompare === 'mixed';

  const toggleGroupSelected = () => {
    const next = !allSelected;
    onUpdateSkusAtIndices(skuIndices, (s) => ({
      selected: s.stock > 0 ? next : false,
    }));
  };

  const applyPrice = (raw: string) => {
    const cents = parseDollarsToCents(raw);
    if (cents == null) return;
    onUpdateSkusAtIndices(skuIndices, () => ({ price: cents }));
  };

  const applyCompare = (raw: string) => {
    if (!raw.trim()) {
      onUpdateSkusAtIndices(skuIndices, () => ({ compareAtPrice: null }));
      return;
    }
    const cents = parseDollarsToCents(raw);
    if (cents == null) return;
    onUpdateSkusAtIndices(skuIndices, () => ({ compareAtPrice: cents }));
  };

  const applyStock = (raw: string) => {
    const stock = parseStock(raw);
    if (stock == null) return;
    onUpdateSkusAtIndices(skuIndices, (s) => ({
      stock,
      // Keep selection when possible; force off when stock hits 0
      selected: stock > 0 ? s.selected : false,
    }));
  };

  const secondaryOptions = skuIndices.flatMap((index) => {
    const sku = skus[index];
    if (!sku) return [];
    return [
      {
        index,
        sku,
        label: getSecondaryOptionLabel(sku, propertyName),
      },
    ];
  });

  return (
    <Card
      className={cn(
        'transition',
        someSelected ? 'border-primary/50' : 'opacity-75'
      )}
    >
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <button
              type="button"
              disabled={inStockInGroup === 0}
              onClick={toggleGroupSelected}
              className={cn(
                'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                allSelected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : someSelected
                    ? 'border-primary bg-primary/20 text-primary'
                    : 'border-muted-foreground/40',
                inStockInGroup === 0 &&
                  'cursor-not-allowed bg-muted text-muted-foreground'
              )}
              aria-label={
                allSelected
                  ? `Unselect all ${value} variants`
                  : `Select all ${value} variants`
              }
            >
              {allSelected ? (
                <Check className="h-3 w-3" />
              ) : someSelected ? (
                <span className="h-1.5 w-1.5 rounded-sm bg-primary" />
              ) : null}
            </button>

            {image ? (
              <ProxiedImg
                src={image}
                alt=""
                className="h-14 w-14 shrink-0 rounded-md border object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-muted">
                <Package className="h-5 w-5 text-muted-foreground" />
              </div>
            )}

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold leading-snug">{value}</p>
                <Badge variant="secondary" className="text-[10px]">
                  {propertyName}
                </Badge>
                {inStockInGroup === 0 ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] text-destructive"
                  >
                    All out of stock
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedInGroup}/{skuIndices.length} selected · Stock sum:{' '}
                {totalStock}
                {aeSaleSample != null
                  ? ` · AE ~$${centsToDisplay(aeSaleSample)}`
                  : ''}
              </p>
            </div>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Our price ($)
                {sharedPrice === 'mixed' ? (
                  <span className="ml-1 font-normal text-amber-600">
                    mixed
                  </span>
                ) : null}
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={priceDraft}
                placeholder={
                  sharedPrice === 'mixed' ? 'Set all…' : undefined
                }
                onFocus={() => setPriceFocused(true)}
                onBlur={() => {
                  setPriceFocused(false);
                  if (!priceDraft.trim()) {
                    setPriceDraft(dollarsDisplay(sharedPrice));
                    return;
                  }
                  applyPrice(priceDraft);
                }}
                onChange={(e) => setPriceDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                className="h-8"
              />
              <EstProfitHint
                rangeLabel={groupEstProfitLabel}
                className="pt-0.5"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Compare at ($)
                {sharedCompare === 'mixed' ? (
                  <span className="ml-1 font-normal text-amber-600">
                    mixed
                  </span>
                ) : null}
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={compareDraft}
                placeholder={
                  sharedCompare === 'mixed' ? 'Set all…' : 'e.g. 29.99'
                }
                onFocus={() => setCompareFocused(true)}
                onBlur={() => {
                  setCompareFocused(false);
                  // Empty clears compare-at for the whole group
                  applyCompare(compareDraft);
                }}
                onChange={(e) => setCompareDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                className="h-8"
              />
              <DiscountHint
                percent={discountIsMixed ? null : sharedDiscountPercent}
                rangeLabel={discountIsMixed ? groupDiscountLabel : null}
                className="pt-0.5"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Stock each
                {sharedStock === 'mixed' ? (
                  <span className="ml-1 font-normal text-amber-600">
                    mixed
                  </span>
                ) : null}
              </Label>
              <Input
                type="number"
                min={0}
                value={stockDraft}
                placeholder={
                  sharedStock === 'mixed' ? 'Set all…' : undefined
                }
                onFocus={() => setStockFocused(true)}
                onBlur={() => {
                  setStockFocused(false);
                  if (!stockDraft.trim()) {
                    setStockDraft(stockDisplay(sharedStock));
                    return;
                  }
                  applyStock(stockDraft);
                }}
                onChange={(e) => setStockDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                className="h-8"
              />
            </div>
          </div>
        </div>

        {/* Secondary options as toggle chips (sizes etc.) */}
        {secondaryOptions.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                Options in this group
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs"
                onClick={onToggleExpand}
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {expanded ? 'Hide details' : 'Per-option prices'}
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {secondaryOptions.map(({ index, sku, label }) => {
                const isOut = sku.stock <= 0;
                const isOn = sku.selected && !isOut;
                const chipDiscount = computeDiscountPercent(
                  sku.price,
                  sku.compareAtPrice
                );
                const chipDiscountLabel = formatDiscountPercent(chipDiscount);
                return (
                  <button
                    key={sku.aeSkuId + index}
                    type="button"
                    disabled={isOut}
                    onClick={() =>
                      onUpdateSkuAt(index, {
                        selected: isOut ? false : !sku.selected,
                      })
                    }
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition',
                      isOn
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground',
                      isOut && 'cursor-not-allowed opacity-50 line-through'
                    )}
                    title={
                      isOut
                        ? `${label} — out of stock`
                        : chipDiscountLabel
                          ? `${label} · ${chipDiscountLabel}`
                          : isOn
                            ? `Unselect ${label}`
                            : `Select ${label}`
                    }
                  >
                    {isOn ? <Check className="h-3 w-3" /> : null}
                    {label}
                    <span className="text-[10px] opacity-70">
                      ${centsToDisplay(sku.price)}
                    </span>
                  </button>
                );
              })}
            </div>

            {expanded ? (
              <div className="space-y-2 pt-1">
                {secondaryOptions.map(({ index, sku, label }) => {
                  const rowEst = computeEstProfitCents(
                    sku.price,
                    sku.aeSalePrice,
                    sku.aePrice
                  );
                  const rowDiscount = computeDiscountPercent(
                    sku.price,
                    sku.compareAtPrice
                  );
                  return (
                    <div
                      key={`detail-${sku.aeSkuId}-${index}`}
                      className={cn(
                        'grid gap-2 rounded-md border bg-muted/15 p-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,6rem))] sm:items-start',
                        !(sku.selected && sku.stock > 0) && 'opacity-60'
                      )}
                    >
                      <div className="min-w-0 sm:pt-5">
                        <p className="truncate text-xs font-medium">{label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Stock: {sku.stock}
                          {sku.aeSalePrice != null
                            ? ` · AE $${centsToDisplay(sku.aeSalePrice)}`
                            : sku.aePrice != null
                              ? ` · AE $${centsToDisplay(sku.aePrice)}`
                              : ''}
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <Label className="text-[10px]">Price ($)</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={(sku.price / 100).toFixed(2)}
                          onChange={(e) => {
                            const cents = parseDollarsToCents(e.target.value);
                            if (cents == null) return;
                            onUpdateSkuAt(index, { price: cents });
                          }}
                          className="h-8"
                        />
                        <EstProfitHint
                          cents={rowEst}
                          className="text-[10px]"
                        />
                      </div>
                      <div className="space-y-0.5">
                        <Label className="text-[10px]">Compare ($)</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={
                            sku.compareAtPrice != null
                              ? (sku.compareAtPrice / 100).toFixed(2)
                              : ''
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (!raw) {
                              onUpdateSkuAt(index, { compareAtPrice: null });
                              return;
                            }
                            const cents = parseDollarsToCents(raw);
                            if (cents == null) return;
                            onUpdateSkuAt(index, { compareAtPrice: cents });
                          }}
                          className="h-8"
                          placeholder="—"
                        />
                        <DiscountHint
                          percent={rowDiscount}
                          className="text-[10px]"
                        />
                      </div>
                      <div className="space-y-0.5">
                        <Label className="text-[10px]">Stock</Label>
                        <Input
                          type="number"
                          min={0}
                          value={sku.stock}
                          onChange={(e) => {
                            const stock = parseStock(e.target.value) ?? 0;
                            onUpdateSkuAt(index, (s) => ({
                              ...s,
                              stock,
                              selected: stock > 0 ? s.selected : false,
                            }));
                          }}
                          className="h-8"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── List card (original per-variant UI) ──────────────────────────────────────

function VariantListCard({
  sku,
  skuIndex,
  onUpdateSkuAt,
}: {
  sku: SkuDraft;
  skuIndex: number;
  onUpdateSkuAt: (
    index: number,
    patch: Partial<SkuDraft> | ((sku: SkuDraft) => SkuDraft)
  ) => void;
}) {
  const skuSelected = sku.selected && sku.stock > 0;
  const isOutOfStock = sku.stock <= 0;
  const estProfit = computeEstProfitCents(
    sku.price,
    sku.aeSalePrice,
    sku.aePrice
  );
  const discountPercent = computeDiscountPercent(
    sku.price,
    sku.compareAtPrice
  );

  return (
    <Card
      className={cn(
        'transition',
        skuSelected ? 'border-primary/50' : 'opacity-60'
      )}
    >
      <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start">
        <div className="flex items-start gap-3 sm:w-1/3">
          <button
            type="button"
            disabled={isOutOfStock}
            onClick={() =>
              onUpdateSkuAt(skuIndex, (s) => ({
                ...s,
                selected: s.stock > 0 ? !s.selected : false,
              }))
            }
            className={cn(
              'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border',
              skuSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-muted-foreground/40',
              isOutOfStock &&
                'cursor-not-allowed bg-muted text-muted-foreground'
            )}
            aria-label={
              isOutOfStock
                ? 'Variant is out of stock'
                : skuSelected
                  ? 'Unselect variant'
                  : 'Select variant'
            }
          >
            {skuSelected ? <Check className="h-3 w-3" /> : null}
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium leading-snug">{sku.label}</p>
              {isOutOfStock ? (
                <Badge
                  variant="outline"
                  className="text-[10px] text-destructive"
                >
                  Out of stock
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Stock: {sku.stock}
              {sku.aeSalePrice != null
                ? ` · AE $${centsToDisplay(sku.aeSalePrice)}`
                : sku.aePrice != null
                  ? ` · AE $${centsToDisplay(sku.aePrice)}`
                  : ''}
            </p>
            {sku.images[0]?.url ? (
              <ProxiedImg
                src={sku.images[0].url}
                alt=""
                className="mt-2 h-14 w-14 rounded-md border object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : null}
          </div>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Our price ($)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={(sku.price / 100).toFixed(2)}
              onChange={(e) => {
                const cents = parseDollarsToCents(e.target.value);
                onUpdateSkuAt(skuIndex, {
                  price: cents != null ? cents : 0,
                });
              }}
              className="h-8"
            />
            <EstProfitHint cents={estProfit} className="pt-0.5" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Compare at ($)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={
                sku.compareAtPrice != null
                  ? (sku.compareAtPrice / 100).toFixed(2)
                  : ''
              }
              onChange={(e) => {
                const raw = e.target.value;
                if (!raw) {
                  onUpdateSkuAt(skuIndex, { compareAtPrice: null });
                  return;
                }
                const cents = parseDollarsToCents(raw);
                onUpdateSkuAt(skuIndex, {
                  compareAtPrice: cents,
                });
              }}
              className="h-8"
              placeholder="e.g. 29.99"
            />
            <DiscountHint percent={discountPercent} className="pt-0.5" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Stock</Label>
            <Input
              type="number"
              min={0}
              value={sku.stock}
              onChange={(e) => {
                const stock = parseStock(e.target.value) ?? 0;
                onUpdateSkuAt(skuIndex, (s) => ({
                  ...s,
                  stock,
                  selected: stock > 0 ? s.selected : false,
                }));
              }}
              className="h-8"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
