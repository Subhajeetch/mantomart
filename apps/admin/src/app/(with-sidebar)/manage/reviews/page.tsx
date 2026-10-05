'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  CalendarDays,
  Filter,
  Image as ImageIcon,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { ProxiedImg } from '@/util/proxied-image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/use-media-query';

const PAGE_SIZE = 24;
const FRONTEND_CACHE_TTL_MS = 15_000;
const API_BASE = `${(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}/api/admin/reviews`;
type CachedResponse = { expiresAt: number; value: unknown };

type Review = {
  id: string;
  productId: string;
  reviewerId: string | null;
  reviewerName: string;
  rating: number;
  comment: string;
  imageUrls: string[];
  isAe: boolean;
  sourceReviewId: string | null;
  reviewDate: string;
  createdAt: string;
  accountName: string | null;
};

type ReviewDetail = Review & {
  product: {
    id: string;
    slug: string;
    name: string;
    images: {
      url: string;
      forVariant?: string;
      alt?: string;
      isOp?: boolean;
    }[];
    defaultPrice: {
      normalPrice: { from: number | null; to: number | null };
      comparedPrice: { from: number | null; to: number | null };
    } | null;
    defaultEstProfit: { from: number | null; to: number | null } | null;
  };
};

type ReviewProduct = {
  id: string;
  name: string;
  slug: string;
  reviewCount: number;
  averageReview: number | null;
};

type ReviewMeta = {
  totalReviews: number;
  filteredTotal: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type ReviewFilters = {
  search: string;
  rating: string;
  source: string;
  productId: string;
  hasImages: string;
  startDate: string;
  endDate: string;
  sortBy: string;
  sortOrder: string;
  page: number;
};

const INITIAL_FILTERS: ReviewFilters = {
  search: '',
  rating: 'all',
  source: 'all',
  productId: '',
  hasImages: 'all',
  startDate: '',
  endDate: '',
  sortBy: 'reviewDate',
  sortOrder: 'desc',
  page: 1,
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    date
  );
}

function formatCentsRange(
  from: number | null | undefined,
  to: number | null | undefined
) {
  if (from === null || from === undefined) return 'Not set';
  const format = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
    }).format(value / 100);
  return to === null || to === undefined || from === to
    ? format(from)
    : `${format(from)}–${format(to)}`;
}

async function requestApi<T>(
  path: string,
  init?: RequestInit,
  cache?: Map<string, CachedResponse>,
  reload = false
): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const cacheKey = `${method}:${path}`;
  if (method === 'GET' && cache) {
    const cached = cache.get(cacheKey);
    if (reload) {
      cache.delete(cacheKey);
    } else if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    } else if (cached) {
      cache.delete(cacheKey);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(
      'Unable to reach the server. Check your connection and retry.'
    );
  }

  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    error?: string;
    message?: string;
    code?: string;
  } | null;
  if (!response.ok || body?.success === false) {
    throw new Error(
      body?.error ||
        body?.message ||
        `The request failed with status ${response.status}.`
    );
  }
  if (!body) throw new Error('The server returned an invalid response.');
  if (method === 'GET' && cache) {
    cache.set(cacheKey, {
      value: body,
      expiresAt: Date.now() + FRONTEND_CACHE_TTL_MS,
    });
  }
  return body as T;
}

function ReviewSkeleton() {
  return (
    <Card className="animate-pulse">
      <CardContent className="space-y-3 p-4">
        <div className="h-4 w-1/3 rounded bg-muted" />
        <div className="h-3 w-1/2 rounded bg-muted" />
        <div className="h-16 rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

function ReviewCard({
  review,
  onDelete,
  onOpen,
  deleting,
}: {
  review: Review;
  onDelete: (event: MouseEvent<HTMLButtonElement>) => void;
  onOpen: () => void;
  deleting: boolean;
}) {
  return (
    <Card
      className="cursor-pointer overflow-hidden transition-colors hover:border-primary/50"
      role="button"
      tabIndex={0}
      aria-label={`Open review by ${review.reviewerName}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <CardContent className="space-y-4 px-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{review.reviewerName}</h2>
              <Badge variant="outline" className="gap-1 tabular-nums">
                <Star className="size-3 fill-amber-400 text-amber-500" />
                {review.rating} / 5
              </Badge>
              <Badge variant={review.isAe ? 'secondary' : 'outline'}>
                {review.isAe ? 'AliExpress' : 'Store review'}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" />
                {formatDate(review.reviewDate)}
              </span>
              {review.accountName ? (
                <span>Account: {review.accountName}</span>
              ) : null}

              <span className="inline-flex items-center gap-1">
                <ImageIcon className="size-3.5" />
                {review.imageUrls.length} image
                {review.imageUrls.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={onDelete}
            className="gap-1.5"
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>

        {review.comment ? (
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed">
            {review.comment}
          </p>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            This review has no written comment.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ManageReviewsPage() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [reviews, setReviews] = useState<Review[]>([]);
  const [meta, setMeta] = useState<ReviewMeta | null>(null);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productOptions, setProductOptions] = useState<ReviewProduct[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ReviewProduct | null>(
    null
  );
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewToDelete, setReviewToDelete] = useState<Review | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [reviewDetail, setReviewDetail] = useState<ReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const responseCache = useRef(new Map<string, CachedResponse>());
  const listRequestId = useRef(0);

  const setFilter = useCallback(
    <K extends keyof ReviewFilters>(key: K, value: ReviewFilters[K]) => {
      setFilters((current) => ({ ...current, [key]: value, page: 1 }));
    },
    []
  );

  useEffect(() => {
    const timer = setTimeout(
      () => setFilter('search', searchInput.trim()),
      300
    );
    return () => clearTimeout(timer);
  }, [searchInput, setFilter]);

  useEffect(() => {
    if (!productMenuOpen) return;
    const search = productSearch.trim();
    if (!search) {
      setProductOptions([]);
      setSearchingProducts(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchingProducts(true);
      const params = new URLSearchParams();
      params.set('search', search);
      void requestApi<{ success: true; data: ReviewProduct[] }>(
        `/products?${params.toString()}`,
        { signal: controller.signal },
        responseCache.current
      )
        .then((result) => setProductOptions(result.data))
        .catch((err) => {
          if (controller.signal.aborted) return;
          toast.error(
            err instanceof Error ? err.message : 'Unable to search products.'
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchingProducts(false);
        });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [productMenuOpen, productSearch]);

  useEffect(() => {
    if (!selectedReviewId) {
      setReviewDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setReviewDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    void requestApi<{ success: true; data: ReviewDetail }>(
      `/${encodeURIComponent(selectedReviewId)}`,
      { signal: controller.signal },
      responseCache.current
    )
      .then((response) => setReviewDetail(response.data))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setDetailError(
          err instanceof Error ? err.message : 'Unable to load review details.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedReviewId, detailRetry]);

  const loadReviews = useCallback(
    async (silent = false) => {
      const requestId = ++listRequestId.current;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('page', String(filters.page));
        params.set('pageSize', String(PAGE_SIZE));
        params.set('sortBy', filters.sortBy);
        params.set('sortOrder', filters.sortOrder);
        if (filters.search) params.set('search', filters.search);
        if (filters.rating !== 'all') params.set('rating', filters.rating);
        if (filters.source !== 'all') params.set('isAe', filters.source);
        if (filters.productId) params.set('productId', filters.productId);
        if (filters.hasImages !== 'all')
          params.set('hasImages', filters.hasImages);
        if (filters.startDate) params.set('startDate', filters.startDate);
        if (filters.endDate) params.set('endDate', filters.endDate);

        const result = await requestApi<{
          success: true;
          data: Review[];
          meta: ReviewMeta;
        }>(`?${params.toString()}`, undefined, responseCache.current, silent);
        if (requestId !== listRequestId.current) return;
        setReviews(result.data);
        setMeta(result.meta);
      } catch (err) {
        if (requestId !== listRequestId.current) return;
        const message =
          err instanceof Error ? err.message : 'Unable to load reviews.';
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        if (requestId === listRequestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [filters]
  );

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const hasFilters = useMemo(
    () =>
      Boolean(
        filters.search ||
        filters.rating !== 'all' ||
        filters.source !== 'all' ||
        filters.productId ||
        filters.hasImages !== 'all' ||
        filters.startDate ||
        filters.endDate
      ),
    [filters]
  );

  const clearFilters = () => {
    setSearchInput('');
    setSelectedProduct(null);
    setProductSearch('');
    setFilters(INITIAL_FILTERS);
  };

  const confirmDelete = async () => {
    if (!reviewToDelete) return;
    setDeleting(true);
    try {
      await requestApi<{ success: true; message: string }>(
        `/${encodeURIComponent(reviewToDelete.id)}`,
        { method: 'DELETE' },
        responseCache.current
      );
      responseCache.current.clear();
      toast.success('Review deleted.');
      const deletedId = reviewToDelete.id;
      setReviewToDelete(null);
      setSelectedReviewId(null);
      setReviews((current) =>
        current.filter((review) => review.id !== deletedId)
      );
      setMeta((current) =>
        current
          ? {
              ...current,
              totalReviews: Math.max(0, current.totalReviews - 1),
              filteredTotal: Math.max(0, current.filteredTotal - 1),
            }
          : current
      );
      if (reviews.length === 1 && filters.page > 1) {
        setFilters((current) => ({ ...current, page: current.page - 1 }));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Unable to delete this review.'
      );
    } finally {
      setDeleting(false);
    }
  };

  const filterFields = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <Filter className="size-4" />
        Review filters
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="ml-auto h-8 gap-1 px-2"
          >
            <X className="size-3.5" />
            Clear filters
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search reviews or reviewers..."
            className="pl-9"
          />
        </div>

        <div className="relative">
          <Input
            value={
              productMenuOpen ? productSearch : (selectedProduct?.name ?? '')
            }
            onFocus={() => {
              setProductMenuOpen(true);
              setProductOptions([]);
            }}
            onChange={(event) => {
              setProductSearch(event.target.value);
              setProductOptions([]);
              setSearchingProducts(false);
              setProductMenuOpen(true);
            }}
            onBlur={(event) => {
              const target = event.relatedTarget;
              if (
                !(target instanceof Node) ||
                !event.currentTarget.parentElement?.contains(target)
              ) {
                setProductMenuOpen(false);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setProductMenuOpen(false);
            }}
            placeholder="Filter by product..."
            aria-label="Search products to filter reviews"
            role="combobox"
            aria-expanded={productMenuOpen}
            aria-controls="review-product-filter-options"
            aria-autocomplete="list"
          />
          {productMenuOpen ? (
            <div
              id="review-product-filter-options"
              role="listbox"
              className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              onMouseDown={(event) => event.preventDefault()}
            >
              <button
                type="button"
                role="option"
                aria-selected={!filters.productId}
                className="w-full rounded-sm px-2 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  setSelectedProduct(null);
                  setProductSearch('');
                  setProductMenuOpen(false);
                  setFilter('productId', '');
                }}
              >
                All products
              </button>
              {productOptions.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  role="option"
                  aria-selected={product.id === filters.productId}
                  className="w-full rounded-sm px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    setSelectedProduct(product);
                    setProductSearch('');
                    setProductMenuOpen(false);
                    setFilter('productId', product.id);
                  }}
                >
                  <span className="block truncate text-sm">{product.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {product.reviewCount} reviews
                  </span>
                </button>
              ))}
              {!productSearch.trim() ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  Type to search products.
                </p>
              ) : searchingProducts ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  Searching products…
                </p>
              ) : productOptions.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  No matching products.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <Select
          value={filters.rating}
          onValueChange={(value) => setFilter('rating', value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Rating" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All star ratings</SelectItem>
            {[5, 4, 3, 2, 1].map((rating) => (
              <SelectItem key={rating} value={String(rating)}>
                {rating} star{rating === 1 ? '' : 's'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.source}
          onValueChange={(value) => setFilter('source', value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Review source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="true">AliExpress reviews</SelectItem>
            <SelectItem value="false">Store reviews</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.hasImages}
          onValueChange={(value) => setFilter('hasImages', value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Images" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">With or without images</SelectItem>
            <SelectItem value="true">Has images</SelectItem>
            <SelectItem value="false">No images</SelectItem>
          </SelectContent>
        </Select>

        <Input
          aria-label="Reviews from date"
          type="date"
          value={filters.startDate}
          onChange={(event) => setFilter('startDate', event.target.value)}
          title="Review date from"
        />
        <Input
          aria-label="Reviews through date"
          type="date"
          value={filters.endDate}
          onChange={(event) => setFilter('endDate', event.target.value)}
          title="Review date through"
        />

        <Select
          value={filters.sortBy}
          onValueChange={(value) => setFilter('sortBy', value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="reviewDate">Review date</SelectItem>
            <SelectItem value="createdAt">Added to store</SelectItem>
            <SelectItem value="rating">Star rating</SelectItem>
            <SelectItem value="reviewerName">Reviewer name</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.sortOrder}
          onValueChange={(value) => setFilter('sortOrder', value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Sort direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Descending</SelectItem>
            <SelectItem value="asc">Ascending</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const reviewDetailContent = reviewDetail ? (
    <div className="space-y-4 overflow-y-auto px-1 pb-1">
      <Card>
        <a
          href={`/product/view/${reviewDetail.product.id}`}
          className="flex gap-3 p-3 transition-colors hover:bg-muted/50"
        >
          <div className="size-20 shrink-0 overflow-hidden rounded-md border bg-muted">
            {reviewDetail.product.images[0]?.url ? (
              <ProxiedImg
                src={reviewDetail.product.images[0].url}
                alt={reviewDetail.product.name}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center">
                <ImageIcon className="size-6 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-medium">
              {reviewDetail.product.name}
            </p>
            <p className="mt-1 text-xs text-primary">Open product page</p>
            <p className="mt-2 text-sm font-semibold tabular-nums">
              {formatCentsRange(
                reviewDetail.product.defaultPrice?.normalPrice.from,
                reviewDetail.product.defaultPrice?.normalPrice.to
              )}
            </p>
            {reviewDetail.product.defaultEstProfit ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Est. profit:{' '}
                {formatCentsRange(
                  reviewDetail.product.defaultEstProfit.from,
                  reviewDetail.product.defaultEstProfit.to
                )}
              </p>
            ) : null}
          </div>
        </a>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{reviewDetail.reviewerName}</h2>
        <Badge variant="outline" className="gap-1 tabular-nums">
          <Star className="size-3 fill-amber-400 text-amber-500" />
          {reviewDetail.rating} / 5
        </Badge>
        <Badge variant={reviewDetail.isAe ? 'secondary' : 'outline'}>
          {reviewDetail.isAe ? 'AliExpress' : 'Store review'}
        </Badge>
      </div>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>Review date: {formatDate(reviewDetail.reviewDate)}</p>
        <p>Added: {formatDate(reviewDetail.createdAt)}</p>
        {reviewDetail.accountName ? (
          <p>Customer account: {reviewDetail.accountName}</p>
        ) : null}
        {reviewDetail.sourceReviewId ? (
          <p className="break-all">
            Source review ID: {reviewDetail.sourceReviewId}
          </p>
        ) : null}
      </div>
      {reviewDetail.comment ? (
        <p className="whitespace-pre-wrap break-words rounded-md border p-3 text-sm leading-relaxed">
          {reviewDetail.comment}
        </p>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-sm italic text-muted-foreground">
          This review has no written comment.
        </p>
      )}
      {reviewDetail.imageUrls.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Review images ({reviewDetail.imageUrls.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {reviewDetail.imageUrls.map((url, index) => (
              <a
                key={`${reviewDetail.id}-${index}`}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="size-20 overflow-hidden rounded-md border bg-muted sm:size-24"
                aria-label={`Open review image ${index + 1}`}
              >
                <ProxiedImg
                  src={url}
                  alt={`Review image ${index + 1}`}
                  className="size-full object-cover"
                />
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  ) : detailLoading ? (
    <div className="space-y-3 py-6">
      <ReviewSkeleton />
      <ReviewSkeleton />
    </div>
  ) : detailError ? (
    <div className="space-y-3 rounded-lg border border-destructive/30 p-4 text-sm">
      <p className="text-destructive">{detailError}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setDetailRetry((value) => value + 1)}
      >
        Try again
      </Button>
    </div>
  ) : null;

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-7"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Manage Reviews</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 p-4 pt-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Review management
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Total: {meta?.totalReviews ?? (loading ? '—' : 0)}
              <span className="mx-2">·</span>
              With current filters: {meta?.filteredTotal ?? (loading ? '—' : 0)}
            </p>
          </div>
          <div className="flex gap-2 self-start sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFiltersOpen(true)}
              className="gap-1.5"
            >
              <Filter className="size-3.5" />
              Filters
              {hasFilters ? (
                <Badge variant="secondary" className="ml-0.5 px-1.5">
                  Active
                </Badge>
              ) : null}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadReviews(true)}
              disabled={loading || refreshing}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn('size-3.5', refreshing && 'animate-spin')}
              />
              Refresh
            </Button>
          </div>
        </div>

        {isDesktop ? (
          <Dialog
            open={filtersOpen}
            onOpenChange={(open) => {
              setFiltersOpen(open);
              if (!open) setProductMenuOpen(false);
            }}
          >
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Filter reviews</DialogTitle>
                <DialogDescription>
                  Narrow reviews by source, product, rating, date, or images.
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-y-auto py-1">{filterFields}</div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFiltersOpen(false)}
                >
                  Done
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Drawer
            open={filtersOpen}
            onOpenChange={(open) => {
              setFiltersOpen(open);
              if (!open) setProductMenuOpen(false);
            }}
          >
            <DrawerContent className="max-h-[92vh]">
              <DrawerHeader className="text-left">
                <DrawerTitle>Filter reviews</DrawerTitle>
                <DrawerDescription>
                  Narrow reviews by source, product, rating, date, or images.
                </DrawerDescription>
              </DrawerHeader>
              <div className="overflow-y-auto px-4 pb-4">{filterFields}</div>
              <DrawerFooter className="border-t">
                <Button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="w-full"
                >
                  Done
                </Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        )}

        {loading ? (
          <div className="grid gap-3 lg:grid-cols-4">
            {Array.from({ length: 5 }, (_, index) => (
              <ReviewSkeleton key={index} />
            ))}
          </div>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <ShieldAlert className="size-8 text-destructive" />
              <div>
                <p className="font-medium">Could not load reviews</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadReviews()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : reviews.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <MessageSquareText className="size-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No reviews found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {hasFilters
                    ? 'Try changing or clearing the current filters.'
                    : 'Reviews will appear here when customers submit them or they are imported.'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Showing {(filters.page - 1) * PAGE_SIZE + 1}–
                {Math.min(filters.page * PAGE_SIZE, meta?.filteredTotal ?? 0)}{' '}
                of {meta?.filteredTotal ?? reviews.length}
              </span>
            </div>
            <div className="grid gap-3">
              {reviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  deleting={deleting}
                  onOpen={() => setSelectedReviewId(review.id)}
                  onDelete={(event) => {
                    event.stopPropagation();
                    setReviewToDelete(review);
                  }}
                />
              ))}
            </div>
            {meta && meta.totalPages > 1 ? (
              <div className="flex items-center justify-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || meta.page <= 1}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      page: Math.max(1, current.page - 1),
                    }))
                  }
                >
                  Previous
                </Button>
                <span className="text-sm tabular-nums text-muted-foreground">
                  Page {meta.page} of {meta.totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || meta.page >= meta.totalPages}
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      page: Math.min(meta.totalPages, current.page + 1),
                    }))
                  }
                >
                  Next
                </Button>
              </div>
            ) : null}
          </>
        )}
      </main>

      {isDesktop ? (
        <Dialog
          open={selectedReviewId !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedReviewId(null);
          }}
        >
          <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Review details</DialogTitle>
              <DialogDescription>
                Review and product information.
              </DialogDescription>
            </DialogHeader>
            {reviewDetailContent}
            {reviewDetail ? (
              <DialogFooter>
                <Button
                  type="button"
                  variant="destructive"
                  className="gap-1.5"
                  onClick={() => setReviewToDelete(reviewDetail)}
                >
                  <Trash2 className="size-3.5" />
                  Delete review
                </Button>
              </DialogFooter>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer
          open={selectedReviewId !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedReviewId(null);
          }}
        >
          <DrawerContent className="max-h-[92vh]">
            <DrawerHeader className="text-left">
              <DrawerTitle>Review details</DrawerTitle>
              <DrawerDescription>
                Review and product information.
              </DrawerDescription>
            </DrawerHeader>
            <div className="overflow-y-auto px-4">{reviewDetailContent}</div>
            {reviewDetail ? (
              <DrawerFooter className="border-t">
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full gap-1.5"
                  onClick={() => setReviewToDelete(reviewDetail)}
                >
                  <Trash2 className="size-3.5" />
                  Delete review
                </Button>
              </DrawerFooter>
            ) : null}
          </DrawerContent>
        </Drawer>
      )}

      <Dialog
        open={reviewToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setReviewToDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this review?</DialogTitle>
            <DialogDescription>
              This permanently deletes the review by{' '}
              <strong>{reviewToDelete?.reviewerName}</strong>. Its product
              review count and average rating will also be recalculated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setReviewToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
              className="gap-1.5"
            >
              {deleting ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
