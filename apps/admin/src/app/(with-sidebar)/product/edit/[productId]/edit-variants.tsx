'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Layers,
  List,
  Package,
  Plus,
  Trash2,
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
import { ProxiedImg } from '@/util/proxied-image';

import type { ProductSku } from '../../manage/utils';
import {
  computeDiscountPercent,
  formatDiscountPercent,
  MIN_VARIANT_DISCOUNT_PERCENT,
} from '../../add/import-wizard-utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsDisplay(cents: number | null | 'mixed'): string {
  if (cents === 'mixed' || cents == null) return '';
  return (cents / 100).toFixed(2);
}

function stockDisplay(stock: number | null | 'mixed'): string {
  if (stock === 'mixed' || stock == null) return '';
  return String(stock);
}

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

function formatEstProfitRange(skus: ProductSku[]): string | null {
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

function formatDiscountRange(skus: ProductSku[]): string | null {
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

function getSkuLabel(sku: ProductSku, index: number): string {
  const parts = sku.properties
    .map((p) => {
      const value = p.valueDefinitionName?.trim() || p.value.trim();
      if (!value) return null;
      return p.propertyName.trim()
        ? `${p.propertyName.trim()}: ${value}`
        : value;
    })
    .filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return sku.sku?.trim() || `Variant ${index + 1}`;
}

type SkuGroupDimension = {
  propertyName: string;
  uniqueValueCount: number;
};

function getSkuDimensions(skus: ProductSku[]): SkuGroupDimension[] {
  const map = new Map<string, { values: Set<string>; displayName: string }>();

  for (const sku of skus) {
    for (const prop of sku.properties) {
      const name = prop.propertyName.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const value = prop.valueDefinitionName?.trim() || prop.value.trim();
      if (!value) continue;
      let entry = map.get(key);
      if (!entry) {
        entry = { values: new Set(), displayName: name };
        map.set(key, entry);
      }
      entry.values.add(value);
    }
  }

  return Array.from(map.values())
    .filter((e) => e.values.size >= 2)
    .map((e) => ({
      propertyName: e.displayName,
      uniqueValueCount: e.values.size,
    }))
    .sort(
      (a, b) =>
        b.uniqueValueCount - a.uniqueValueCount ||
        a.propertyName.localeCompare(b.propertyName)
    );
}

function canGroup(skus: ProductSku[]): boolean {
  if (skus.length <= 1) return false;
  return getSkuDimensions(skus).some((d) => d.uniqueValueCount < skus.length);
}

type SkuVariantGroup = {
  key: string;
  propertyName: string;
  value: string;
  image: string | null;
  skuIndices: number[];
};

function groupSkusByProperty(
  skus: ProductSku[],
  propertyName: string
): SkuVariantGroup[] {
  const groups = new Map<string, SkuVariantGroup>();
  const order: string[] = [];

  skus.forEach((sku, index) => {
    let value = 'Other';
    let image: string | null = null;
    for (const prop of sku.properties) {
      if (prop.propertyName.toLowerCase() === propertyName.toLowerCase()) {
        value =
          prop.valueDefinitionName?.trim() || prop.value.trim() || 'Other';
        image = prop.image;
        break;
      }
    }
    const key = `${propertyName.toLowerCase()}\u0000${value.toLowerCase()}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        propertyName,
        value,
        image: image ?? sku.images[0]?.url ?? null,
        skuIndices: [],
      };
      groups.set(key, group);
      order.push(key);
    } else if (!group.image) {
      group.image = image ?? sku.images[0]?.url ?? null;
    }
    group.skuIndices.push(index);
  });

  return order.map((k) => groups.get(k)!);
}

function getSharedField(
  skus: ProductSku[],
  indices: number[],
  field: 'price' | 'compareAtPrice' | 'stock'
): number | null | 'mixed' {
  if (indices.length === 0) return null;
  const firstIdx = indices[0];
  if (firstIdx === undefined) return null;
  const first = skus[firstIdx]?.[field] ?? null;
  for (let i = 1; i < indices.length; i++) {
    const idx = indices[i];
    if (idx === undefined) continue;
    if ((skus[idx]?.[field] ?? null) !== first) return 'mixed';
  }
  return first;
}

function getSecondaryLabel(sku: ProductSku, groupPropertyName: string): string {
  const others = sku.properties
    .filter(
      (p) => p.propertyName.toLowerCase() !== groupPropertyName.toLowerCase()
    )
    .map((p) => p.valueDefinitionName?.trim() || p.value.trim())
    .filter(Boolean);
  if (others.length > 0) return others.join(' · ');
  return sku.sku?.trim() || 'Variant';
}

function EstProfitHint({
  cents,
  rangeLabel,
  className,
}: {
  cents?: number | null;
  rangeLabel?: string | null;
  className?: string;
}) {
  const display =
    rangeLabel ??
    (cents != null && Number.isFinite(cents)
      ? formatEstProfitCents(cents)
      : null);
  if (!display) return null;
  const isNegative = display.startsWith('-') || (cents != null && cents < 0);
  return (
    <p
      className={cn(
        'text-[11px] font-medium leading-tight tabular-nums',
        isNegative
          ? 'text-destructive'
          : 'text-emerald-700 dark:text-emerald-400',
        className
      )}
      title="Estimated profit = our price − AE cost − $1.50 (preview; saved on update)"
    >
      Est. profit: {display}
    </p>
  );
}

function DiscountHint({
  percent,
  rangeLabel,
  className,
}: {
  percent?: number | null;
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

// ─── Main ─────────────────────────────────────────────────────────────────────

type EditVariantsProps = {
  skus: ProductSku[];
  onUpdateSkus: (updater: (skus: ProductSku[]) => ProductSku[]) => void;
};

export function EditVariantsSection({
  skus,
  onUpdateSkus,
}: EditVariantsProps) {
  const dimensions = useMemo(() => getSkuDimensions(skus), [skus]);
  const groupingAvailable = canGroup(skus);
  const defaultGroupBy = dimensions[0]?.propertyName ?? '';

  const [viewMode, setViewMode] = useState<'grouped' | 'list'>(() =>
    skus.length > 10 && canGroup(skus) ? 'grouped' : 'list'
  );
  const [groupBy, setGroupBy] = useState(defaultGroupBy);
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkCompare, setBulkCompare] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    if (!groupingAvailable) {
      setViewMode('list');
      return;
    }
    if (!groupBy || !dimensions.some((d) => d.propertyName === groupBy)) {
      setGroupBy(dimensions[0]?.propertyName ?? '');
    }
  }, [groupingAvailable, dimensions, groupBy]);

  const groups = useMemo(() => {
    if (viewMode !== 'grouped' || !groupBy) return [];
    return groupSkusByProperty(skus, groupBy);
  }, [skus, viewMode, groupBy]);

  const updateSkuAt = (index: number, patch: Partial<ProductSku>) => {
    onUpdateSkus((prev) =>
      prev.map((sku, i) => (i === index ? { ...sku, ...patch } : sku))
    );
  };

  const updateSkusAtIndices = (
    indices: number[],
    patch: (sku: ProductSku) => Partial<ProductSku>
  ) => {
    const set = new Set(indices);
    onUpdateSkus((prev) =>
      prev.map((sku, i) => (set.has(i) ? { ...sku, ...patch(sku) } : sku))
    );
  };

  const applyBulkToAll = () => {
    const priceCents = parseDollarsToCents(bulkPrice);
    const compareCents =
      bulkCompare.trim() === '' ? undefined : parseDollarsToCents(bulkCompare);
    const stock = parseStock(bulkStock);
    if (priceCents == null && compareCents === undefined && stock == null) {
      return;
    }
    onUpdateSkus((prev) =>
      prev.map((sku) => {
        const next = { ...sku };
        if (priceCents != null) next.price = priceCents;
        if (compareCents !== undefined) next.compareAtPrice = compareCents;
        if (stock != null) next.stock = stock;
        return next;
      })
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Variants ({skus.length})</h3>
          <p className="text-xs text-muted-foreground">
            {viewMode === 'grouped'
              ? 'Edit prices by group. Expand a group for per-option overrides.'
              : 'Set our price, compare-at, and stock. Est. profit and % off update live.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {groupingAvailable ? (
            <div className="flex rounded-md border p-0.5">
              <Button
                type="button"
                size="sm"
                variant={viewMode === 'grouped' ? 'secondary' : 'ghost'}
                className="h-8 gap-1.5 px-2.5"
                onClick={() => setViewMode('grouped')}
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
              >
                <List className="h-3.5 w-3.5" />
                List
              </Button>
            </div>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              onUpdateSkus((prev) => [
                ...prev,
                {
                  aeSkuId: null,
                  aeSkuAttr: null,
                  price: 0,
                  compareAtPrice: null,
                  aePrice: null,
                  aeSalePrice: null,
                  stock: 0,
                  sku: `SKU-${Date.now()}`,
                  priceIncludesTax: false,
                  images: [],
                  properties: [],
                },
              ]);
            }}
          >
            <Plus className="size-3.5" />
            Add variant
          </Button>
        </div>
      </div>

      {skus.length > 1 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="space-y-3 p-3 sm:p-4">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Package className="h-3.5 w-3.5 text-muted-foreground" />
              Bulk edit
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
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
                <div className="space-y-1">
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
              <Button
                type="button"
                size="sm"
                className="h-9"
                onClick={applyBulkToAll}
                disabled={!bulkPrice && !bulkCompare && !bulkStock}
              >
                Apply to all ({skus.length})
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {viewMode === 'grouped' && groupingAvailable && dimensions.length > 0 ? (
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
        </div>
      ) : null}

      {viewMode === 'grouped' && groupingAvailable && groupBy ? (
        <div className="space-y-3">
          {groups.map((group) => (
            <VariantGroupCard
              key={group.key}
              group={group}
              skus={skus}
              expanded={expandedGroups.has(group.key)}
              onToggleExpand={() => {
                setExpandedGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.key)) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                });
              }}
              onUpdateSkusAtIndices={updateSkusAtIndices}
              onUpdateSkuAt={updateSkuAt}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {skus.map((sku, skuIndex) => (
            <VariantListCard
              key={sku.id ?? sku.aeSkuId ?? skuIndex}
              sku={sku}
              skuIndex={skuIndex}
              label={getSkuLabel(sku, skuIndex)}
              canRemove={skus.length > 1}
              onUpdateSku={updateSkuAt}
              onRemove={() =>
                onUpdateSkus((prev) => prev.filter((_, i) => i !== skuIndex))
              }
            />
          ))}
        </div>
      )}

      {skus.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No variants yet. Add a variant to continue.
        </p>
      ) : null}
    </div>
  );
}

// ─── Group card ───────────────────────────────────────────────────────────────

function VariantGroupCard({
  group,
  skus,
  expanded,
  onToggleExpand,
  onUpdateSkusAtIndices,
  onUpdateSkuAt,
}: {
  group: SkuVariantGroup;
  skus: ProductSku[];
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdateSkusAtIndices: (
    indices: number[],
    patch: (sku: ProductSku) => Partial<ProductSku>
  ) => void;
  onUpdateSkuAt: (index: number, patch: Partial<ProductSku>) => void;
}) {
  const groupSkus = group.skuIndices
    .map((i) => skus[i])
    .filter(Boolean) as ProductSku[];
  const sharedPrice = getSharedField(skus, group.skuIndices, 'price');
  const sharedCompare = getSharedField(skus, group.skuIndices, 'compareAtPrice');
  const sharedStock = getSharedField(skus, group.skuIndices, 'stock');

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

  const secondaryOptions = group.skuIndices.flatMap((index) => {
    const sku = skus[index];
    if (!sku) return [];
    return [
      {
        index,
        sku,
        label: getSecondaryLabel(sku, group.propertyName),
      },
    ];
  });

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {group.image ? (
              <ProxiedImg
                src={group.image}
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
                <p className="text-sm font-semibold leading-snug">
                  {group.value}
                </p>
                <Badge variant="secondary" className="text-[10px]">
                  {group.propertyName}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {group.skuIndices.length} variant
                {group.skuIndices.length === 1 ? '' : 's'} · Stock sum:{' '}
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
                  <span className="ml-1 font-normal text-amber-600">mixed</span>
                ) : null}
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={priceDraft}
                placeholder={sharedPrice === 'mixed' ? 'Set all…' : undefined}
                onFocus={() => setPriceFocused(true)}
                onBlur={() => {
                  setPriceFocused(false);
                  const cents = parseDollarsToCents(priceDraft);
                  if (cents == null) {
                    setPriceDraft(dollarsDisplay(sharedPrice));
                    return;
                  }
                  onUpdateSkusAtIndices(group.skuIndices, () => ({
                    price: cents,
                  }));
                }}
                onChange={(e) => setPriceDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className="h-8"
              />
              <EstProfitHint rangeLabel={groupEstProfitLabel} className="pt-0.5" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Compare at ($)
                {sharedCompare === 'mixed' ? (
                  <span className="ml-1 font-normal text-amber-600">mixed</span>
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
                  if (!compareDraft.trim()) {
                    onUpdateSkusAtIndices(group.skuIndices, () => ({
                      compareAtPrice: null,
                    }));
                    return;
                  }
                  const cents = parseDollarsToCents(compareDraft);
                  if (cents == null) return;
                  onUpdateSkusAtIndices(group.skuIndices, () => ({
                    compareAtPrice: cents,
                  }));
                }}
                onChange={(e) => setCompareDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
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
                  <span className="ml-1 font-normal text-amber-600">mixed</span>
                ) : null}
              </Label>
              <Input
                type="number"
                min={0}
                value={stockDraft}
                placeholder={sharedStock === 'mixed' ? 'Set all…' : undefined}
                onFocus={() => setStockFocused(true)}
                onBlur={() => {
                  setStockFocused(false);
                  const stock = parseStock(stockDraft);
                  if (stock == null) {
                    setStockDraft(stockDisplay(sharedStock));
                    return;
                  }
                  onUpdateSkusAtIndices(group.skuIndices, () => ({ stock }));
                }}
                onChange={(e) => setStockDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className="h-8"
              />
            </div>
          </div>
        </div>

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
                const chipDiscount = computeDiscountPercent(
                  sku.price,
                  sku.compareAtPrice
                );
                const chipDiscountLabel = formatDiscountPercent(chipDiscount);
                return (
                  <span
                    key={`${sku.aeSkuId ?? index}-${label}`}
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
                    title={
                      chipDiscountLabel
                        ? `${label} · ${chipDiscountLabel}`
                        : label
                    }
                  >
                    {label}
                    <span className="text-[10px] opacity-70">
                      ${centsToDisplay(sku.price)}
                    </span>
                  </span>
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
                      key={`detail-${sku.aeSkuId ?? index}`}
                      className="grid gap-2 rounded-md border bg-muted/15 p-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,6rem))] sm:items-start"
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
                        <EstProfitHint cents={rowEst} className="text-[10px]" />
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
                            onUpdateSkuAt(index, { stock });
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

// ─── List card ────────────────────────────────────────────────────────────────

function VariantListCard({
  sku,
  skuIndex,
  label,
  canRemove,
  onUpdateSku,
  onRemove,
}: {
  sku: ProductSku;
  skuIndex: number;
  label: string;
  canRemove: boolean;
  onUpdateSku: (index: number, patch: Partial<ProductSku>) => void;
  onRemove: () => void;
}) {
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
  const thumb = sku.images[0]?.url ?? sku.properties.find((p) => p.image)?.image;

  return (
    <Card className={cn(isOutOfStock && 'opacity-75')}>
      <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 items-start gap-3 sm:w-1/3">
          {thumb ? (
            <ProxiedImg
              src={thumb}
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
              <p className="text-sm font-medium leading-snug">{label}</p>
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
            {sku.sku ? (
              <p className="text-[11px] text-muted-foreground">SKU: {sku.sku}</p>
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
                onUpdateSku(skuIndex, { price: cents != null ? cents : 0 });
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
                  onUpdateSku(skuIndex, { compareAtPrice: null });
                  return;
                }
                const cents = parseDollarsToCents(raw);
                onUpdateSku(skuIndex, { compareAtPrice: cents });
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
                onUpdateSku(skuIndex, { stock });
              }}
              className="h-8"
            />
          </div>
        </div>

        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 self-start"
            onClick={onRemove}
            aria-label="Remove variant"
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
