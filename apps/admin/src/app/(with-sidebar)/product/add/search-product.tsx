"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ImageOff,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  ShoppingCart,
  Star,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import ProductDetailDialog, {
  fetchAliExpressProductDetail,
  type AliExpressProductDetailResponse,
} from "./product-dialog";
import {
  SAVED_PRODUCTS_KEY,
  readSavedProducts,
  writeSavedProducts,
  type SavedAliExpressProduct,
} from "./storage";

type Step = "search" | "results";
type Phase = "idle" | "exit" | "enter-init" | "enter";
type NoticeType = "success" | "error" | "info";

type Product = {
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

type PaginationMeta = {
  pageIndex: number;
  pageSize: number;
  totalCount: number;
};

type Notice = {
  type: NoticeType;
  title: string;
  message: string;
};

const PLACEHOLDER_QUERIES = [
  "Search products...",
  "T-Shirts",
  "Electronics",
  "Running Shoes",
  "Phone Cases",
  "LED Strip Lights",
  "Mechanical Keyboards",
  "Yoga Mats",
  "Wireless Earbuds",
];

const TYPING_SPEED = 60;
const DELETING_SPEED = 35;
const PAUSE_AFTER_TYPE = 1600;
const PAUSE_AFTER_DELETE = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function toSafeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseNumberish(value: unknown): number | null {
  const text = getString(value).replace(/[,%]/g, "").trim();
  if (!text) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeExternalUrl(value: unknown): string | null {
  const raw = getString(value).trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/")) return `https://www.aliexpress.com${raw}`;
  return `https://${raw}`;
}

function normalizeImageUrl(value: unknown): string | null {
  const raw = getString(value).trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) {
    return raw;
  }
  return `https://${raw}`;
}

function getDiscountText(value: unknown): string | null {
  const text = getString(value).trim();
  if (!text || text === "0" || text === "0%") return null;
  return text.startsWith("-") ? text : `-${text}`;
}

function getDisplayPrice(product: Product) {
  const formatted = getString(product.salePriceFormat).trim();
  if (formatted) return formatted;

  const targetSalePrice = getString(product.targetSalePrice).trim();
  return targetSalePrice ? `$${targetSalePrice}` : "Price unavailable";
}

function getOriginalPrice(product: Product) {
  const value = getString(product.targetOriginalPrice).trim();
  if (!value) return null;
  if (/[$€£¥₹]|usd|eur|gbp|inr/i.test(value)) return value;
  return `$${value}`;
}

function getProductId(product: Product) {
  const id = getString(product.itemId).trim();
  if (id) return id;

  const url = normalizeExternalUrl(product.itemUrl);
  if (url) return url;

  return [getString(product.title), getString(product.itemMainPic)]
    .filter(Boolean)
    .join(":");
}

function normalizeProduct(product: Product): SavedAliExpressProduct["normalized"] {
  return {
    itemId: getString(product.itemId),
    title: getString(product.title, "Untitled AliExpress product"),
    imageUrl: normalizeImageUrl(product.itemMainPic),
    itemUrl: normalizeExternalUrl(product.itemUrl),
    displayPrice: getDisplayPrice(product),
    targetSalePrice: getString(product.targetSalePrice) || null,
    targetOriginalPrice: getString(product.targetOriginalPrice) || null,
    discount: getDiscountText(product.discount),
    orders: getString(product.orders) || null,
    rating: parseNumberish(product.score),
    positiveRate: parseNumberish(product.evaluateRate),
  };
}

function buildSavedProduct(
  product: Product,
  searchQuery: string,
  pageIndex: number
): SavedAliExpressProduct {
  const now = new Date();
  const normalized = normalizeProduct(product);

  return {
    schemaVersion: 3,
    id: getProductId(product),
    source: "aliexpress",
    status: "pending_review",
    addedAt: now.toISOString(),
    addedAtMs: now.getTime(),
    searchContext: {
      query: searchQuery,
      pageIndex,
      url: typeof window === "undefined" ? null : window.location.href,
    },
    product: { ...product },
    normalized,
  };
}

function getApiErrorMessage(payload: unknown, status: number) {
  if (isRecord(payload)) {
    const directMessage =
      getString(payload.error) ||
      getString(payload.message) ||
      getString(payload.msg) ||
      getString(payload.sub_msg);

    if (directMessage) return directMessage;

    const aliExpressError = payload.error_response;
    if (isRecord(aliExpressError)) {
      const aliMessage =
        getString(aliExpressError.msg) ||
        getString(aliExpressError.sub_msg) ||
        getString(aliExpressError.message);

      if (aliMessage) return aliMessage;
    }
  }

  if (status === 400) return "The search request is invalid.";
  if (status === 401) return "AliExpress is not connected. Connect it before searching.";
  if (status === 403) return "AliExpress denied permission for this request.";
  if (status === 429) return "Too many AliExpress requests. Please try again later.";
  if (status >= 500) return "AliExpress search is temporarily unavailable.";

  return `Search failed with status ${status}.`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function fetchProducts(
  query: string,
  pageIndex = 1,
  signal?: AbortSignal
): Promise<{ products: Product[]; pagination: PaginationMeta }> {
  const params = new URLSearchParams({
    q: query,
    itemnum: "30",
    page: String(pageIndex),
  });

  let res: Response;

  try {
    res = await fetch(`/api/ae/product/search?${params.toString()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error("Unable to reach the search server. Please try again.");
  }

  let json: unknown;

  try {
    json = await res.json();
  } catch {
    throw new Error(
      res.ok
        ? "The search server returned an invalid response."
        : `Search failed with status ${res.status}.`
    );
  }

  if (!res.ok) {
    throw new Error(getApiErrorMessage(json, res.status));
  }

  if (isRecord(json) && json.success === false) {
    throw new Error(getApiErrorMessage(json, res.status));
  }

  if (isRecord(json) && isRecord(json.error_response)) {
    throw new Error(getApiErrorMessage(json, res.status));
  }

  const response = isRecord(json)
    ? json.aliexpress_ds_text_search_response
    : undefined;
  const data = isRecord(response) ? response.data : undefined;

  if (!isRecord(data)) {
    throw new Error("AliExpress returned an unexpected search response.");
  }

  const productsWrapper = isRecord(data.products) ? data.products : undefined;
  const rawProducts = productsWrapper?.selection_search_product;

  const products = Array.isArray(rawProducts)
    ? rawProducts.filter(isRecord).map((product) => product as Product)
    : isRecord(rawProducts)
      ? [rawProducts as Product]
      : [];

  return {
    products,
    pagination: {
      pageIndex: toSafeInteger(data.pageIndex, pageIndex),
      pageSize: toSafeInteger(data.pageSize, 30),
      totalCount: toNonNegativeInteger(data.totalCount, products.length),
    },
  };
}

function useTypingPlaceholder(queries: string[], active: boolean) {
  const [displayed, setDisplayed] = useState(queries[0]);
  const [queryIndex, setQueryIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(queries[0]?.length ?? 0);
  const [isDeleting, setIsDeleting] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;

    const current = queries[queryIndex];
    if (!current) return;

    const tick = () => {
      if (!isDeleting) {
        if (charIndex < current.length) {
          setCharIndex((c) => c + 1);
          setDisplayed(current.slice(0, charIndex + 1));
          timeoutRef.current = setTimeout(tick, TYPING_SPEED);
        } else {
          timeoutRef.current = setTimeout(
            () => setIsDeleting(true),
            PAUSE_AFTER_TYPE
          );
        }
      } else if (charIndex > 0) {
        setCharIndex((c) => c - 1);
        setDisplayed(current.slice(0, charIndex - 1));
        timeoutRef.current = setTimeout(tick, DELETING_SPEED);
      } else {
        timeoutRef.current = setTimeout(() => {
          const next = (queryIndex + 1) % queries.length;
          setQueryIndex(next);
          setIsDeleting(false);
        }, PAUSE_AFTER_DELETE);
      }
    };

    timeoutRef.current = setTimeout(tick, TYPING_SPEED);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [active, charIndex, isDeleting, queryIndex, queries]);

  useEffect(() => {
    setCharIndex(0);
    setDisplayed("");
  }, [queryIndex]);

  return displayed;
}

function ProductCard({
  product,
  isSaved,
  onAddToList,
  onOpenDetails,
  saving,
}: {
  product: Product;
  isSaved: boolean;
  onAddToList: (product: Product) => void;
  onOpenDetails: (product: Product) => void;
  saving: boolean;
}) {
  const normalized = normalizeProduct(product);
  const title = normalized.title;
  const imageUrl = normalized.imageUrl;
  const originalPrice = getOriginalPrice(product);
  const hasRating = normalized.rating !== null && normalized.rating > 0;
  const hasPositiveRate =
    normalized.positiveRate !== null && normalized.positiveRate > 0;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetails(product)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetails(product);
        }
      }}
      className="group cursor-pointer overflow-hidden rounded-lg border bg-card shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className="object-cover transition duration-300 group-hover:scale-[1.03]"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-8 w-8" />
          </div>
        )}

        {normalized.discount ? (
          <Badge variant="destructive" className="absolute left-2 top-2">
            {normalized.discount}
          </Badge>
        ) : null}

        {isSaved ? (
          <Badge className="absolute right-2 top-2 gap-1">
            <Check className="h-3 w-3" />
            Saved
          </Badge>
        ) : null}
      </div>

      <CardContent className="flex min-h-[188px] flex-col gap-3 p-3">
        <div className="space-y-2">
          <p className="line-clamp-2 min-h-[40px] text-sm font-medium leading-5 text-foreground">
            {title}
          </p>

          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-base font-semibold text-primary">
              {normalized.displayPrice}
            </span>
            {originalPrice && normalized.discount ? (
              <span className="text-xs text-muted-foreground line-through">
                {originalPrice}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {hasRating ? (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
              {normalized.rating?.toFixed(1)}
            </span>
          ) : null}

          {hasPositiveRate ? (
            <span>{normalized.positiveRate?.toFixed(0)}% positive</span>
          ) : null}

          {normalized.orders ? (
            <span className="ml-auto inline-flex items-center gap-1">
              <ShoppingCart className="h-3.5 w-3.5" />
              {normalized.orders} sold
            </span>
          ) : null}
        </div>

        <div className="mt-auto">
          <Button
            type="button"
            size="sm"
            variant={isSaved ? "secondary" : "default"}
            disabled={isSaved || saving}
            onClick={(event) => {
              event.stopPropagation();
              onAddToList(product);
            }}
            className="w-full"
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
      </CardContent>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-card">
      <div className="aspect-square animate-pulse bg-muted" />
      <div className="flex min-h-[188px] flex-col gap-3 p-3">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
        <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
        <div className="mt-auto">
          <div className="h-8 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

function ProductPagination({
  pagination,
  onPageChange,
  disabled,
}: {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
  disabled: boolean;
}) {
  const { pageIndex, pageSize, totalCount } = pagination;
  const totalPages = Math.ceil(totalCount / pageSize);

  if (totalPages <= 1) return null;

  const getPageNumbers = () => {
    const pages: (number | "ellipsis-start" | "ellipsis-end")[] = [];

    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    pages.push(1);

    if (pageIndex > 3) pages.push("ellipsis-start");

    const start = Math.max(2, pageIndex - 1);
    const end = Math.min(totalPages - 1, pageIndex + 1);

    for (let i = start; i <= end; i += 1) {
      pages.push(i);
    }

    if (pageIndex < totalPages - 2) pages.push("ellipsis-end");

    pages.push(totalPages);
    return pages;
  };

  const pages = getPageNumbers();

  return (
    <div className="flex flex-col items-center gap-2 pb-2 pt-4">
      <p className="text-xs text-muted-foreground">
        Page {pageIndex} of {totalPages.toLocaleString()} -{" "}
        {totalCount.toLocaleString()} total results
      </p>

      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (pageIndex > 1 && !disabled) onPageChange(pageIndex - 1);
              }}
              aria-disabled={pageIndex === 1 || disabled}
              className={
                pageIndex === 1 || disabled
                  ? "pointer-events-none opacity-50"
                  : "cursor-pointer"
              }
            />
          </PaginationItem>

          {pages.map((page, i) =>
            page === "ellipsis-start" || page === "ellipsis-end" ? (
              <PaginationItem key={`${page}-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={page}>
                <PaginationLink
                  href="#"
                  isActive={page === pageIndex}
                  onClick={(e) => {
                    e.preventDefault();
                    if (!disabled && page !== pageIndex) onPageChange(page);
                  }}
                  className={
                    disabled ? "pointer-events-none opacity-50" : "cursor-pointer"
                  }
                >
                  {page}
                </PaginationLink>
              </PaginationItem>
            )
          )}

          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (pageIndex < totalPages && !disabled) {
                  onPageChange(pageIndex + 1);
                }
              }}
              aria-disabled={pageIndex === totalPages || disabled}
              className={
                pageIndex === totalPages || disabled
                  ? "pointer-events-none opacity-50"
                  : "cursor-pointer"
              }
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

const SearchProduct = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const queryParam = searchParams.get("q") ?? "";
  const rawPageParam = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const pageParam =
    Number.isFinite(rawPageParam) && rawPageParam > 0 ? rawPageParam : 1;

  const [step, setStep] = useState<Step>(queryParam ? "results" : "search");
  const [inputValue, setInputValue] = useState(queryParam);
  const [searchQuery, setSearchQuery] = useState(queryParam);
  const [products, setProducts] = useState<Product[]>([]);
  const [savedProducts, setSavedProducts] = useState<SavedAliExpressProduct[]>(
    []
  );
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedProductDetail, setSelectedProductDetail] =
    useState<AliExpressProductDetailResponse | null>(null);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [productDetailError, setProductDetailError] = useState<string | null>(
    null
  );
  const [savingProductId, setSavingProductId] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta>({
    pageIndex: pageParam,
    pageSize: 30,
    totalCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  const inputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const activeRequestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const detailRequestRef = useRef(0);
  const resultsTopRef = useRef<HTMLDivElement>(null);

  const animatedPlaceholder = useTypingPlaceholder(
    PLACEHOLDER_QUERIES,
    step === "search" && !isFocused && inputValue === ""
  );

  const savedProductIds = useMemo(
    () => new Set(savedProducts.map((product) => product.id)),
    [savedProducts]
  );

  const clearTransitionTimers = () => {
    timeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
    timeoutsRef.current = [];

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const transitionTo = (
    nextStep: Step,
    dir: "forward" | "back",
    onMidpoint?: () => void
  ) => {
    clearTransitionTimers();
    setDirection(dir);
    setPhase("exit");

    const exitTimeout = window.setTimeout(() => {
      setStep(nextStep);
      onMidpoint?.();
      setPhase("enter-init");

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          setPhase("enter");

          const enterTimeout = window.setTimeout(() => {
            setPhase("idle");
            if (nextStep === "search") inputRef.current?.focus();
          }, 350);

          timeoutsRef.current.push(enterTimeout);
        });
      });
    }, 300);

    timeoutsRef.current.push(exitTimeout);
  };

  const runSearch = async (query: string, page = 1, animate = true) => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setError("Enter a search term before searching.");
      return;
    }

    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setNotice(null);

    const doFetch = async () => {
      try {
        const { products: results, pagination: meta } = await fetchProducts(
          trimmedQuery,
          page,
          controller.signal
        );

        if (activeRequestRef.current !== requestId) return;

        setProducts(results);
        setPagination(meta);
        resultsTopRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err) {
        if (isAbortError(err) || activeRequestRef.current !== requestId) return;

        setError(
          err instanceof Error
            ? err.message
            : "An unknown error occurred while searching."
        );
        setProducts([]);
      } finally {
        if (activeRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    };

    if (animate) {
      transitionTo("results", "forward", () => {
        void doFetch();
      });
    } else {
      await doFetch();
    }
  };

  const fetchFullProductDetail = async (
    product: Product,
    signal?: AbortSignal
  ) => {
    const productId = getString(product.itemId).trim();

    if (!productId) {
      throw new Error("AliExpress did not return a product id for this item.");
    }

    return fetchAliExpressProductDetail(productId, { signal });
  };

  const openProductDetails = (product: Product) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    detailAbortRef.current?.abort();

    const controller = new AbortController();
    detailAbortRef.current = controller;

    setSelectedProduct(product);
    setSelectedProductDetail(null);
    setProductDetailError(null);
    setProductDetailLoading(true);

    void fetchFullProductDetail(product, controller.signal)
      .then((detail) => {
        if (detailRequestRef.current !== requestId) return;
        setSelectedProductDetail(detail);
      })
      .catch((err) => {
        if (isAbortError(err) || detailRequestRef.current !== requestId) return;

        setProductDetailError(
          err instanceof Error
            ? err.message
            : "Failed to load product details."
        );
      })
      .finally(() => {
        if (detailRequestRef.current === requestId) {
          setProductDetailLoading(false);
        }
      });
  };

  const closeProductDetails = () => {
    detailAbortRef.current?.abort();
    detailRequestRef.current += 1;
    setSelectedProduct(null);
    setSelectedProductDetail(null);
    setProductDetailError(null);
    setProductDetailLoading(false);
  };

  const retryProductDetails = () => {
    if (!selectedProduct) return;
    openProductDetails(selectedProduct);
  };

  const handleAddToList = async (product: Product) => {
    const id = getProductId(product);

    if (!id) {
      setNotice({
        type: "error",
        title: "Product not saved",
        message:
          "AliExpress did not return enough product information to save this item.",
      });
      return;
    }

    if (savedProductIds.has(id)) {
      setNotice({
        type: "info",
        title: "Already in list",
        message: "This product is already saved in the admin product list.",
      });
      return;
    }

    setSavingProductId(id);
    setNotice(null);

    try {
      const latestSavedProducts = readSavedProducts();

      if (latestSavedProducts.some((savedProduct) => savedProduct.id === id)) {
        setSavedProducts(latestSavedProducts);
        setNotice({
          type: "info",
          title: "Already in list",
          message: "This product is already saved in the admin product list.",
        });
        return;
      }

      const savedProduct = buildSavedProduct(
        product,
        searchQuery,
        pagination.pageIndex
      );
      const nextSavedProducts = [savedProduct, ...latestSavedProducts];

      writeSavedProducts(nextSavedProducts);
      setSavedProducts(nextSavedProducts);
      setNotice({
        type: "success",
        title: "Added to list",
        message:
          "The AliExpress product card was saved locally for admin review.",
      });
    } catch (err) {
      setNotice({
        type: "error",
        title: "Product not saved",
        message:
          err instanceof Error
            ? err.message
            : "The browser could not save this product.",
      });
    } finally {
      setSavingProductId((current) => (current === id ? null : current));
    }
  };

  useEffect(() => {
    try {
      setSavedProducts(readSavedProducts());
    } catch {
      setNotice({
        type: "error",
        title: "Saved list unavailable",
        message:
          "The saved product list could not be loaded from this browser.",
      });
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SAVED_PRODUCTS_KEY) return;

      try {
        setSavedProducts(readSavedProducts());
      } catch {
        setSavedProducts([]);
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (queryParam) {
      void runSearch(queryParam, pageParam, false);
    }

    return () => {
      abortRef.current?.abort();
      detailAbortRef.current?.abort();
      clearTransitionTimers();
    };
    // Run once on mount so browser URL params can hydrate the initial search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getStyle = (): CSSProperties => {
    const exitX = direction === "forward" ? "-60px" : "60px";
    const enterFromX = direction === "forward" ? "60px" : "-60px";

    switch (phase) {
      case "exit":
        return {
          opacity: 0,
          transform: `translateX(${exitX})`,
          transition:
            "opacity 280ms ease, transform 280ms cubic-bezier(0.4,0,0.2,1)",
        };
      case "enter-init":
        return {
          opacity: 0,
          transform: `translateX(${enterFromX})`,
          transition: "none",
        };
      case "enter":
        return {
          opacity: 1,
          transform: "translateX(0)",
          transition:
            "opacity 320ms ease, transform 320ms cubic-bezier(0.2,0,0,1)",
        };
      default:
        return {
          opacity: 1,
          transform: "translateX(0)",
          transition: "none",
        };
    }
  };

  const handleSearch = () => {
    if (phase !== "idle" || loading) return;

    const query = inputValue.trim();
    if (!query) {
      setError("Enter a search term before searching.");
      return;
    }

    setSearchQuery(query);

    const params = new URLSearchParams(searchParams.toString());
    params.set("q", query);
    params.set("page", "1");

    router.push(`?${params.toString()}`);
    void runSearch(query, 1);
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));

    router.push(`?${params.toString()}`);
    void runSearch(searchQuery, page, false);
  };

  const handleBack = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("page");

    setError(null);
    setNotice(null);
    router.push(params.toString() ? `?${params.toString()}` : "?");
    transitionTo("search", "back");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  const selectedProductId = selectedProduct ? getProductId(selectedProduct) : "";

  return (
    <>
    <div className="relative h-[calc(100vh-120px)] overflow-hidden">
      <div className="h-full" style={getStyle()}>
        {step === "search" ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 pb-24">
            <Image
              src="/icons/aliexpress_logo_long.png"
              alt="AliExpress"
              width={280}
              height={100}
              className="object-contain"
            />

            <div className="w-full max-w-xl space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder=""
                    className="h-11 w-full rounded-full border border-input bg-background px-5 text-sm shadow-sm outline-none transition-shadow focus:border-ring focus:ring-2 focus:ring-ring"
                  />

                  {inputValue === "" ? (
                    <span className="pointer-events-none absolute left-5 top-1/2 flex -translate-y-1/2 items-center gap-px text-sm text-muted-foreground/60">
                      {animatedPlaceholder}
                      {!isFocused ? (
                        <span
                          className="ml-px inline-block h-3.5 w-[1.5px] bg-muted-foreground/40"
                          style={{
                            animation: "blink 1s step-start infinite",
                          }}
                        />
                      ) : null}
                    </span>
                  ) : null}
                </div>

                <Button
                  type="button"
                  onClick={handleSearch}
                  disabled={!inputValue.trim() || phase !== "idle" || loading}
                  className="h-11 rounded-full px-5"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  Search
                </Button>
              </div>

              {error ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Search error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </div>

            <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
          </div>
        ) : null}

        {step === "results" ? (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-3 border-b border-border py-3">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={handleBack}
                disabled={phase !== "idle"}
                aria-label="Go back to search"
                className="h-8 w-8 rounded-full"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>

              <div className="flex max-w-md flex-1 gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`"${searchQuery}"`}
                  className="h-8 w-full rounded-full border border-input bg-background px-4 text-xs shadow-sm outline-none transition-shadow focus:border-ring focus:ring-2 focus:ring-ring"
                />

                <Button
                  type="button"
                  onClick={handleSearch}
                  disabled={!inputValue.trim() || phase !== "idle" || loading}
                  size="sm"
                  className="h-8 rounded-full"
                >
                  {loading ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Search
                </Button>
              </div>

              <div className="ml-auto hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                {!loading && products.length > 0 ? (
                  <span>{pagination.totalCount.toLocaleString()} results</span>
                ) : null}
                <Badge variant="secondary">{savedProducts.length} saved</Badge>
              </div>
            </div>

            <div ref={resultsTopRef} className="flex-1 overflow-y-auto py-4">
              {notice ? (
                <Alert
                  variant={notice.type === "error" ? "destructive" : "default"}
                  className="mb-4"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{notice.title}</AlertTitle>
                  <AlertDescription>{notice.message}</AlertDescription>
                </Alert>
              ) : null}

              {error && !loading ? (
                <div className="flex h-44 flex-col items-center justify-center gap-3 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-destructive">
                      {error}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Check the AliExpress connection and try again.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void runSearch(searchQuery, pagination.pageIndex)}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Try again
                  </Button>
                </div>
              ) : null}

              {loading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <SkeletonCard key={i} />
                  ))}
                </div>
              ) : null}

              {!loading && !error && products.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    No products found for &ldquo;{searchQuery}&rdquo;
                  </p>
                </div>
              ) : null}

              {!loading && !error && products.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {products.map((product, index) => {
                      const productId = getProductId(product) || String(index);

                      return (
                        <ProductCard
                          key={productId}
                          product={product}
                          isSaved={savedProductIds.has(productId)}
                          saving={savingProductId === productId}
                          onAddToList={handleAddToList}
                          onOpenDetails={openProductDetails}
                        />
                      );
                    })}
                  </div>

                  <ProductPagination
                    pagination={pagination}
                    onPageChange={handlePageChange}
                    disabled={loading || phase !== "idle"}
                  />
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>

    <ProductDetailDialog
      open={selectedProduct !== null}
      onOpenChange={(open) => {
        if (!open) closeProductDetails();
      }}
      product={selectedProduct}
      detail={selectedProductDetail}
      loading={productDetailLoading}
      error={productDetailError}
      isSaved={Boolean(selectedProductId && savedProductIds.has(selectedProductId))}
      saving={Boolean(selectedProductId && savingProductId === selectedProductId)}
      onRetry={retryProductDetails}
      onAddToList={() => {
        if (!selectedProduct) return;
        void handleAddToList(selectedProduct);
      }}
    />
    </>
  );
};

export default SearchProduct;
