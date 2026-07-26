'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  DollarSign,
  ExternalLink,
  Eye,
  ImageOff,
  Loader2,
  Package,
  RefreshCw,
  ShoppingCart,
  Star,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { SavedAliExpressProduct } from './storage';
import {
  fetchAliExpressProductDetail,
  type AliExpressProductDetailResponse,
} from './product-dialog';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type PropertyEntry = { name: string; value: string };

type ParsedPreview = {
  title: string;
  productId: string;
  galleryImages: string[];
  detailImages: string[];
  detailHtml: string | null;
  properties: PropertyEntry[];
  baseInfo: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function normalizeUrl(value: unknown): string | null {
  const raw = getString(value).trim();
  if (!raw) return null;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return null;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return [value];
  return [];
}

function splitImageUrls(value: unknown) {
  return getString(value)
    .split(';')
    .map((url) => url.trim())
    .filter(Boolean);
}

function getHtmlImageUrls(html: unknown): string[] {
  const raw = getString(html);
  if (!raw) return [];

  try {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    return Array.from(doc.querySelectorAll('img'))
      .map((img) => img.getAttribute('src'))
      .filter((v): v is string => Boolean(v));
  } catch {
    return [];
  }
}

function getMobileDetailImages(value: unknown): string[] {
  const raw = getString(value);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.moduleList)) return [];
    return parsed.moduleList
      .filter(isRecord)
      .map((m) => (isRecord(m.data) ? m.data.url : null))
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

function parseDetail(
  listItem: SavedAliExpressProduct | null,
  detail: AliExpressProductDetailResponse | null,
): ParsedPreview {
  const response = detail?.aliexpress_ds_product_get_response;
  const rawResult = response?.result;
  const result = isRecord(rawResult) ? rawResult : {};

  const baseInfo = isRecord(result.ae_item_base_info_dto)
    ? result.ae_item_base_info_dto
    : {};
  const multimediaInfo = isRecord(result.ae_multimedia_info_dto)
    ? result.ae_multimedia_info_dto
    : {};
  const propertyWrapper = isRecord(result.ae_item_properties)
    ? result.ae_item_properties
    : {};

  // Gallery images
  const galleryImages = (() => {
    const seen = new Set<string>();
    const urls: string[] = [];
    const add = (u: string | null) => {
      if (u && !seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    };

    // Main pic
    add(
      normalizeUrl(
        listItem?.product.itemMainPic || listItem?.normalized.imageUrl
      )
    );
    // Multimedia image URLs
    for (const u of splitImageUrls(multimediaInfo.image_urls)) {
      add(normalizeUrl(u));
    }
    return urls;
  })();

  // Detail images
  const detailImages = (() => {
    const seen = new Set<string>();
    const urls: string[] = [];
    const add = (url: string | null) => {
      if (url && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    };
    for (const u of getMobileDetailImages(baseInfo.mobile_detail)) {
      add(normalizeUrl(u));
    }
    for (const u of getHtmlImageUrls(baseInfo.detail)) {
      add(normalizeUrl(u));
    }
    return urls;
  })();

  // Properties
  const properties = toRecordArray(
    isRecord(propertyWrapper)
      ? propertyWrapper.ae_item_property
      : undefined
  ).map((p) => ({
    name: getString(p.attr_name, 'Unknown'),
    value: getString(p.attr_value, '—'),
  }));

  // Raw HTML from AliExpress detail — keep as-is for the iframe
  const detailHtml = getString(baseInfo.detail) || null;

  return {
    title:
      getString(baseInfo.subject) ||
      listItem?.normalized.title ||
      'AliExpress product',
    productId:
      getString(baseInfo.product_id) ||
      listItem?.normalized.itemId ||
      listItem?.id ||
      'unknown',
    galleryImages,
    detailImages,
    detailHtml,
    properties,
    baseInfo,
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

export type ProductPreviewSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listItem: SavedAliExpressProduct | null;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductPreviewSheet({
  open,
  onOpenChange,
  listItem,
}: ProductPreviewSheetProps) {
  const [detail, setDetail] = useState<AliExpressProductDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showHtml, setShowHtml] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const parsed = useMemo(
    () => parseDetail(listItem, detail),
    [listItem, detail]
  );

  // Keep selected image in sync when data changes
  useEffect(() => {
    setSelectedImage(
      parsed.galleryImages[0] ?? parsed.detailImages[0] ?? null
    );
  }, [parsed.galleryImages, parsed.detailImages]);

  const allThumbnails = useMemo(
    () =>
      [...parsed.galleryImages, ...parsed.detailImages].filter(
        (url, i, arr) => arr.indexOf(url) === i
      ),
    [parsed.galleryImages, parsed.detailImages]
  );

  const loadDetail = useCallback(async () => {
    if (!listItem) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const productId = listItem.normalized.itemId || listItem.id;
      const data = await fetchAliExpressProductDetail(productId, {
        signal: controller.signal,
      });
      setDetail(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(
        err instanceof Error ? err.message : 'Failed to load product details.'
      );
    } finally {
      setLoading(false);
    }
  }, [listItem]);

  useEffect(() => {
    if (open && listItem) {
      setDetail(null);
      setError(null);
      setShowHtml(true);
      void loadDetail();
    } else {
      abortRef.current?.abort();
    }
  }, [open, listItem, loadDetail]);

  // Stats from listItem (always available)
  const aePrice =
    listItem?.normalized.displayPrice ||
    (listItem?.normalized.targetSalePrice
      ? `$${listItem.normalized.targetSalePrice}`
      : null);
  const aeRating = listItem?.normalized.rating ?? null;
  const aeSales = listItem?.normalized.orders ?? null;
  const aeDiscount = listItem?.normalized.discount ?? null;

  const mainImageDisplay =
    selectedImage ?? parsed.galleryImages[0] ?? parsed.detailImages[0] ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="z-[60] flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
        showCloseButton
      >
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            AliExpress product preview
          </SheetTitle>
          <SheetDescription className="sr-only">
            Original AliExpress product — title, images, properties, and the
            raw description HTML.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {/* ── Loading ── */}
          {loading ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Loading product details…</span>
            </div>
          ) : null}

          {/* ── Error ── */}
          {error && !loading ? (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Could not load full detail</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{error}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void loadDetail()}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
              {/* Still show basic card data */}
            </div>
          ) : null}

          {/* ── Title & quick stats ── */}
          {listItem && !loading ? (
            <div className="space-y-5">
              {/* Title */}
              <h2 className="text-base font-semibold leading-snug">
                {parsed.title || listItem.normalized.title}
              </h2>

              {/* Quick stat chips */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                {aePrice ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-primary">
                    <DollarSign className="h-4 w-4" />
                    {aePrice}
                  </span>
                ) : null}
                {aeRating != null && aeRating > 0 ? (
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
                    {aeRating.toFixed(1)}
                  </span>
                ) : null}
                {aeSales ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <ShoppingCart className="h-4 w-4" />
                    {aeSales} sold
                  </span>
                ) : null}
                {aeDiscount ? (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    {aeDiscount}
                  </span>
                ) : null}
                <Badge variant="outline" className="font-mono text-[10px]">
                  ID: {listItem.normalized.itemId || listItem.id}
                </Badge>
              </div>

              {/* Product link */}
              {listItem.normalized.itemUrl ? (
                <a
                  href={listItem.normalized.itemUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                  View on AliExpress
                </a>
              ) : null}
            </div>
          ) : null}

          {/* ── Main image + thumbnail strip ── */}
          <div className="mt-4 space-y-3">
            {/* Main image */}
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border bg-muted sm:aspect-[4/3]">
              {mainImageDisplay ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mainImageDisplay}
                  alt={parsed.title}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <ImageOff className="h-8 w-8" />
                  No image available
                </div>
              )}
            </div>

            {/* Thumbnails */}
            {allThumbnails.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {allThumbnails.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setSelectedImage(url)}
                    className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-muted transition ${
                      url === mainImageDisplay
                        ? 'border-primary ring-2 ring-primary/30'
                        : 'hover:border-primary/40'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* ── Properties ── */}
          {parsed.properties.length > 0 ? (
            <div className="mt-5 space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Package className="mr-1 inline h-3.5 w-3.5" />
                Product properties
              </h4>
              <div className="grid gap-1.5 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
                {parsed.properties.map((prop, i) => (
                  <div
                    key={`${prop.name}-${i}`}
                    className="flex min-w-0 items-baseline gap-1.5 text-xs"
                  >
                    <span className="shrink-0 font-medium text-foreground">
                      {prop.name}:
                    </span>
                    <span className="truncate text-muted-foreground">
                      {prop.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ── Detail images ── */}
          {parsed.detailImages.length > 0 ? (
            <div className="mt-5 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Detail images ({parsed.detailImages.length})
              </h4>
              <div className="space-y-1">
                {parsed.detailImages.map((url) => (
                  <div
                    key={url}
                    className="overflow-hidden rounded-lg border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      className="h-auto w-full"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ── HTML description ── */}
          {parsed.detailHtml ? (
            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Original description (HTML)
                </h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHtml((v) => !v)}
                >
                  {showHtml ? 'Hide' : 'Show'}
                </Button>
              </div>

              {showHtml ? (
                <div className="overflow-hidden rounded-lg border">
                  <iframe
                    srcDoc={parsed.detailHtml}
                    title="AliExpress product description"
                    sandbox="allow-same-origin"
                    className="w-full border-0"
                    style={{ height: 600 }}
                    onLoad={(e) => {
                      // Auto-resize iframe to content height
                      try {
                        const iframe = e.currentTarget;
                        const doc =
                          iframe.contentDocument ||
                          iframe.contentWindow?.document;
                        if (doc?.body) {
                          const h = doc.body.scrollHeight;
                          if (h > 0) iframe.style.height = `${h}px`;
                        }
                      } catch {
                        // cross-origin guard — keep default height
                      }
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : loading ? null : (
            <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
              No HTML description available for this product.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}