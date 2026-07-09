"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  Check,
  ImageOff,
  Loader2,
  PackagePlus,
  RefreshCw,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AliExpressSearchProduct = {
  itemId: string;
  title: string;
  targetSalePrice: string;
  targetOriginalPrice: string;
  salePriceFormat: string;
  discount: string;
  itemMainPic: string;
  orders: string;
  evaluateRate: string;
  score: string;
  itemUrl: string;
  [key: string]: unknown;
};

export type AliExpressProductDetailResponse = {
  aliexpress_ds_product_get_response?: {
    result?: Record<string, unknown>;
    rsp_code?: number;
    rsp_msg?: string;
    request_id?: string;
    _trace_id_?: string;
  };
  [key: string]: unknown;
};

type FetchProductDetailOptions = {
  shipToCountry?: string;
  currency?: string;
  lang?: string;
  signal?: AbortSignal;
};

type ProductDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: AliExpressSearchProduct | null;
  detail: AliExpressProductDetailResponse | null;
  loading: boolean;
  error: string | null;
  isSaved: boolean;
  saving: boolean;
  onRetry: () => void;
  onAddToList: () => void;
};

type ParsedDetail = {
  title: string;
  productId: string;
  baseInfo: Record<string, unknown>;
  storeInfo: Record<string, unknown>;
  packageInfo: Record<string, unknown>;
  logisticsInfo: Record<string, unknown>;
  multimediaInfo: Record<string, unknown>;
  skus: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  videos: Record<string, unknown>[];
  galleryImages: string[];
  detailImages: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return fallback;
}

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "Unavailable";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeUrl(value: unknown): string | null {
  const raw = getString(value).trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) {
    return raw;
  }
  return `https://${raw}`;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return [value];
  return [];
}

function uniqueUrls(values: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const url = normalizeUrl(value);
    if (!url || seen.has(url)) return;
    seen.add(url);
    result.push(url);
  });

  return result;
}

function getApiErrorMessage(payload: unknown, status: number) {
  if (isRecord(payload)) {
    const directMessage =
      getString(payload.error) ||
      getString(payload.message) ||
      getString(payload.msg) ||
      getString(payload.sub_msg);

    if (directMessage) return directMessage;

    const response = payload.aliexpress_ds_product_get_response;
    if (isRecord(response)) {
      const responseMessage = getString(response.rsp_msg);
      if (responseMessage && responseMessage !== "Call succeeds") {
        return responseMessage;
      }
    }

    const aliExpressError = payload.error_response;
    if (isRecord(aliExpressError)) {
      const aliMessage =
        getString(aliExpressError.msg) ||
        getString(aliExpressError.sub_msg) ||
        getString(aliExpressError.message);

      if (aliMessage) return aliMessage;
    }
  }

  if (status === 400) return "The product detail request is invalid.";
  if (status === 401) return "AliExpress is not connected. Connect it before loading product details.";
  if (status === 403) return "AliExpress denied permission for this product detail request.";
  if (status === 404) return "This AliExpress product could not be found.";
  if (status === 429) return "Too many AliExpress requests. Please try again later.";
  if (status >= 500) return "AliExpress product details are temporarily unavailable.";

  return `Product detail request failed with status ${status}.`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export async function fetchAliExpressProductDetail(
  productId: string,
  options: FetchProductDetailOptions = {}
): Promise<AliExpressProductDetailResponse> {
  const trimmedId = productId.trim();

  if (!trimmedId) {
    throw new Error("Product id is required to load details.");
  }

  const params = new URLSearchParams({
    shipToCountry: options.shipToCountry ?? "US",
    currency: options.currency ?? "USD",
    lang: options.lang ?? "en",
  });

  let response: Response;

  try {
    response = await fetch(
      `/api/ae/product/${encodeURIComponent(trimmedId)}?${params.toString()}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: options.signal,
      }
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error("Unable to reach the product detail server. Please try again.");
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new Error(
      response.ok
        ? "The product detail server returned an invalid response."
        : `Product detail request failed with status ${response.status}.`
    );
  }

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, response.status));
  }

  if (isRecord(payload) && payload.success === false) {
    throw new Error(getApiErrorMessage(payload, response.status));
  }

  if (isRecord(payload) && isRecord(payload.error_response)) {
    throw new Error(getApiErrorMessage(payload, response.status));
  }

  const aliResponse = isRecord(payload)
    ? payload.aliexpress_ds_product_get_response
    : undefined;

  if (isRecord(aliResponse)) {
    const rspCode = Number(aliResponse.rsp_code);
    const rspMsg = getString(aliResponse.rsp_msg);

    if (Number.isFinite(rspCode) && rspCode !== 200) {
      throw new Error(rspMsg || "AliExpress rejected the product detail request.");
    }
  }

  const result = isRecord(aliResponse) ? aliResponse.result : undefined;
  if (!isRecord(result)) {
    throw new Error("AliExpress returned an unexpected product detail response.");
  }

  return payload as AliExpressProductDetailResponse;
}

function splitImageUrls(value: unknown) {
  return getString(value)
    .split(";")
    .map((url) => url.trim())
    .filter(Boolean);
}

function getHtmlImageUrls(html: unknown) {
  const raw = getString(html);
  if (!raw) return [];

  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    return Array.from(doc.querySelectorAll("img"))
      .map((img) => img.getAttribute("src"))
      .filter(Boolean);
  }

  return Array.from(raw.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)).map(
    (match) => match[1]
  );
}

function getMobileDetailImages(value: unknown) {
  const raw = getString(value);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.moduleList)) return [];

    return parsed.moduleList
      .filter(isRecord)
      .map((module) => (isRecord(module.data) ? module.data.url : null))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getSkuProperties(sku: Record<string, unknown>) {
  const propertyWrapper = sku.ae_sku_property_dtos;
  const rawProperties = isRecord(propertyWrapper)
    ? propertyWrapper.ae_sku_property_d_t_o
    : undefined;

  return toRecordArray(rawProperties);
}

function parseDetail(
  product: AliExpressSearchProduct | null,
  detail: AliExpressProductDetailResponse | null
): ParsedDetail {
  const response = detail?.aliexpress_ds_product_get_response;
  const rawResult = response?.result;
  const result = isRecord(rawResult) ? rawResult : {};

  const baseInfo = isRecord(result.ae_item_base_info_dto)
    ? result.ae_item_base_info_dto
    : {};
  const storeInfo = isRecord(result.ae_store_info) ? result.ae_store_info : {};
  const packageInfo = isRecord(result.package_info_dto)
    ? result.package_info_dto
    : {};
  const logisticsInfo = isRecord(result.logistics_info_dto)
    ? result.logistics_info_dto
    : {};
  const multimediaInfo = isRecord(result.ae_multimedia_info_dto)
    ? result.ae_multimedia_info_dto
    : {};
  const skuWrapper = isRecord(result.ae_item_sku_info_dtos)
    ? result.ae_item_sku_info_dtos
    : {};
  const propertyWrapper = isRecord(result.ae_item_properties)
    ? result.ae_item_properties
    : {};
  const videoWrapper = isRecord(multimediaInfo.ae_video_dtos)
    ? multimediaInfo.ae_video_dtos
    : {};

  const skus = toRecordArray(skuWrapper.ae_item_sku_info_d_t_o);
  const properties = toRecordArray(propertyWrapper.ae_item_property);
  const videos = toRecordArray(videoWrapper.ae_video_d_t_o);
  const skuImages = skus.flatMap((sku) =>
    getSkuProperties(sku).map((property) => property.sku_image)
  );
  const videoPosters = videos.map((video) => video.poster_url);

  const galleryImages = uniqueUrls([
    product?.itemMainPic,
    ...splitImageUrls(multimediaInfo.image_urls),
    ...skuImages,
    ...videoPosters,
  ]);

  const detailImages = uniqueUrls([
    ...getMobileDetailImages(baseInfo.mobile_detail),
    ...getHtmlImageUrls(baseInfo.detail),
  ]);

  return {
    title:
      getString(baseInfo.subject) ||
      getString(product?.title) ||
      "AliExpress product",
    productId:
      getString(baseInfo.product_id) || getString(product?.itemId) || "Unavailable",
    baseInfo,
    storeInfo,
    packageInfo,
    logisticsInfo,
    multimediaInfo,
    skus,
    properties,
    videos,
    galleryImages,
    detailImages,
  };
}

function InfoRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border bg-background p-3 shadow-sm">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-medium text-foreground">
        {formatValue(value)}
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-muted/20 p-3 sm:p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ProductDetailDialog({
  open,
  onOpenChange,
  product,
  detail,
  loading,
  error,
  isSaved,
  saving,
  onRetry,
  onAddToList,
}: ProductDetailDialogProps) {
  const parsed = useMemo(() => parseDetail(product, detail), [product, detail]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    setSelectedImage(parsed.galleryImages[0] ?? parsed.detailImages[0] ?? null);
  }, [parsed.galleryImages, parsed.detailImages]);

  const selectedImageUrl =
    selectedImage ?? parsed.galleryImages[0] ?? parsed.detailImages[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[94dvh] overflow-hidden rounded-lg p-0"
        style={{ width: "min(96vw, 1120px)", maxWidth: "none" }}
      >
        <DialogHeader className="border-b bg-background px-4 py-3 sm:px-5 sm:py-4">
          <DialogTitle className="line-clamp-2 pr-7 text-sm leading-5 sm:text-base sm:leading-6">
            {parsed.title}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Product ID: {parsed.productId}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(94dvh-88px)] overflow-y-auto px-3 py-3 sm:px-5 sm:py-5">
          {loading ? (
            <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading full product information...
            </div>
          ) : null}

          {error && !loading ? (
            <Alert variant="destructive" className="mb-5">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Could not load product details</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{error}</p>
                <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {!loading ? (
            <div className="space-y-4 sm:space-y-5">
              <div className="flex min-w-0 flex-col gap-4 xl:flex-row">
                <div className="w-full shrink-0 space-y-3 xl:w-[420px]">
                  <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border bg-muted sm:aspect-square">
                    {selectedImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedImageUrl}
                        alt={parsed.title}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                        <ImageOff className="h-8 w-8" />
                        No image available
                      </div>
                    )}
                  </div>

                  {parsed.galleryImages.length > 1 ? (
                    <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:max-h-40 sm:grid-cols-5 sm:overflow-y-auto sm:pr-1">
                      {parsed.galleryImages.map((image) => (
                        <button
                          type="button"
                          key={image}
                          onClick={() => setSelectedImage(image)}
                          className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-muted sm:h-auto sm:w-auto sm:aspect-square ${
                            image === selectedImageUrl
                              ? "border-primary ring-2 ring-primary/20"
                              : "hover:border-primary/50"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={image}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      Status: {formatValue(parsed.baseInfo.product_status_type)}
                    </Badge>
                    <Badge variant="secondary">
                      Category: {formatValue(parsed.baseInfo.category_id)}
                    </Badge>
                    <Badge variant="secondary">
                      Currency: {formatValue(parsed.baseInfo.currency_code)}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    <InfoRow label="Sales" value={parsed.baseInfo.sales_count} />
                    <InfoRow
                      label="Evaluations"
                      value={parsed.baseInfo.evaluation_count}
                    />
                    <InfoRow
                      label="Rating"
                      value={`⭐ ${parsed.baseInfo.avg_evaluation_rating}`}
                    />
                    <InfoRow
                      label="Wholesale"
                      value={detail?.aliexpress_ds_product_get_response?.result?.has_whole_sale}
                    />
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
                    <InfoRow
                      label="Store"
                      value={parsed.storeInfo.store_name}
                    />
                    <InfoRow
                      label="Store Country"
                      value={parsed.storeInfo.store_country_code}
                    />
                    <InfoRow
                      label="Delivery Time (US)"
                      value={
                        parsed.logisticsInfo.delivery_time
                          ? `${formatValue(parsed.logisticsInfo.delivery_time)} days`
                          : "Unavailable"
                      }
                    />
                  </div>

                  <Button
                    type="button"
                    className="h-10 w-full sm:w-auto"
                    disabled={isSaved || saving}
                    onClick={onAddToList}
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : isSaved ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <PackagePlus className="mr-2 h-4 w-4" />
                    )}
                    {saving ? "Saving..." : isSaved ? "Added to list" : "Add to list"}
                  </Button>
                </div>
              </div>

              {parsed.videos.length > 0 ? (
                <Section title="Videos">
                  <div className="grid gap-3 md:grid-cols-2">
                    {parsed.videos.map((video) => {
                      const mediaUrl = normalizeUrl(video.media_url);
                      const posterUrl = normalizeUrl(video.poster_url);
                      if (!mediaUrl) return null;

                      return (
                        <video
                          key={mediaUrl}
                          controls
                          preload="metadata"
                          poster={posterUrl ?? undefined}
                          className="max-h-80 w-full rounded-lg border bg-muted"
                        >
                          <source src={mediaUrl} />
                        </video>
                      );
                    })}
                  </div>
                </Section>
              ) : null}

              <Section title="⭐ Store Ratings">
                <div className="grid gap-3 sm:grid-cols-3">
                  <InfoRow
                    label="Item as described"
                    value={parsed.storeInfo.item_as_described_rating}
                  />
                  <InfoRow
                    label="Communication"
                    value={parsed.storeInfo.communication_rating}
                  />
                  <InfoRow
                    label="Shipping speed"
                    value={parsed.storeInfo.shipping_speed_rating}
                  />
                </div>
              </Section>

              <Section title="Shipping and Package">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <InfoRow
                    label="Ship To"
                    value={parsed.logisticsInfo.ship_to_country}
                  />
                  <InfoRow
                    label="Weight"
                    value={
                      parsed.packageInfo.gross_weight
                        ? `${formatValue(parsed.packageInfo.gross_weight)} kg`
                        : "Unavailable"
                    }
                  />
                  <InfoRow
                    label="Dimensions"
                    value={`${formatValue(parsed.packageInfo.package_length)} x ${formatValue(
                      parsed.packageInfo.package_width
                    )} x ${formatValue(parsed.packageInfo.package_height)}`}
                  />
                  <InfoRow
                    label="Package Type"
                    value={parsed.packageInfo.package_type}
                  />
                </div>
              </Section>

              {parsed.skus.length > 0 ? (
                <Section title={`SKUs (${parsed.skus.length})`}>
                  <div className="max-h-80 overflow-auto rounded-lg border">
                    <table className="w-full min-w-[760px] text-left text-xs">
                      <thead className="sticky top-0 bg-muted text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">SKU ID</th>
                          <th className="px-3 py-2 font-medium">Options</th>
                          <th className="px-3 py-2 font-medium">Sale Price</th>
                          <th className="px-3 py-2 font-medium">SKU Price</th>
                          <th className="px-3 py-2 font-medium">Stock</th>
                          <th className="px-3 py-2 font-medium">Tax</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.skus.map((sku, index) => {
                          const properties = getSkuProperties(sku)
                            .map(
                              (property) =>
                                `${formatValue(property.sku_property_name)}: ${formatValue(
                                  property.sku_property_value
                                )}`
                            )
                            .join(", ");

                          return (
                            <tr key={`${getString(sku.sku_id)}-${index}`} className="border-t">
                              <td className="px-3 py-2">{formatValue(sku.sku_id)}</td>
                              <td className="px-3 py-2">{properties || "Unavailable"}</td>
                              <td className="px-3 py-2">
                                {formatValue(sku.currency_code)}{" "}
                                {formatValue(sku.offer_sale_price)}
                              </td>
                              <td className="px-3 py-2">
                                {formatValue(sku.currency_code)} {formatValue(sku.sku_price)}
                              </td>
                              <td className="px-3 py-2">
                                {formatValue(sku.sku_available_stock)}
                              </td>
                              <td className="px-3 py-2">
                                {formatValue(sku.price_include_tax)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Section>
              ) : null}

              {parsed.properties.length > 0 ? (
                <Section title={`Product Properties (${parsed.properties.length})`}>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {parsed.properties.map((property, index) => (
                      <InfoRow
                        key={`${getString(property.attr_name)}-${index}`}
                        label={getString(property.attr_name, "Property")}
                        value={property.attr_value}
                      />
                    ))}
                  </div>
                </Section>
              ) : null}

              {parsed.detailImages.length > 0 ? (
                <Section title={`Detail Images (${parsed.detailImages.length})`}>
                  <div className="grid gap-3 md:grid-cols-2">
                    {parsed.detailImages.map((image) => (
                      <div key={image} className="overflow-hidden rounded-lg border bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image}
                          alt=""
                          className="h-auto w-full"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ProductDetailDialog;
