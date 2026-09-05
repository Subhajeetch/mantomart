'use client';

import CustomImage from '@/components/custom-image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Edit,
  Filter,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

import {
  composeProductImageAlt,
  flattenCategories,
  formatCentsRange,
  formatEstProfitRange,
  formatPriceRange,
  requestCategories,
  requestJson,
  type CategoryNode,
  type ProductListMeta,
  type ProductSummary,
} from './utils';

const PAGE_SIZE = 24;

function getInitials(name: string | null | undefined) {
  return (name || 'Admin')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function ProductSkeleton() {
  return (
    <Card className="overflow-hidden p-0">
      <div className="bg-muted aspect-square animate-pulse" />
      <CardContent className="space-y-2 p-3">
        <div className="bg-muted h-4 w-4/5 animate-pulse rounded" />
        <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
        <div className="bg-muted h-5 w-16 animate-pulse rounded" />
      </CardContent>
    </Card>
  );
}

function ProductCard({
  product,
  canUpdate,
}: {
  product: ProductSummary;
  canUpdate: boolean;
}) {
  const image = product.images?.[0]?.url;
  const compareAtLabel = formatCentsRange(
    product.defaultPrice?.comparedPrice.from,
    product.defaultPrice?.comparedPrice.to
  );
  const estProfitLabel = formatEstProfitRange(product);

  return (
    <Card className="group relative overflow-hidden p-0 transition-colors hover:border-primary/40">
      {canUpdate && (
        <Button
          asChild
          variant="secondary"
          size="icon"
          className="absolute top-2 right-2 z-10 size-8 shadow-sm"
        >
          <Link
            href={`/product/edit/${product.id}`}
            aria-label={`Edit ${product.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <Edit className="size-3.5" />
          </Link>
        </Button>
      )}

      <Link href={`/product/view/${product.id}`} className="block">
        <div className="relative aspect-square bg-muted">
          {image ? (
            <CustomImage
              src={image}
              width={400}
              height={400}
              alt={composeProductImageAlt(product.name, product.images[0])}
              className="h-full w-full transition duration-200 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <PackageSearch className="text-muted-foreground size-8" />
            </div>
          )}
          {estProfitLabel && (
            <span
              className="absolute bottom-2 left-2 z-1 max-w-[calc(100%-1rem)] truncate rounded-md border border-emerald-500/20 bg-background/90 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-emerald-700 shadow-sm backdrop-blur-sm dark:text-emerald-400"
              title={`Estimated profit: ${estProfitLabel}`}
            >
              Est. Profit: {estProfitLabel}
            </span>
          )}
        </div>

        <CardContent className="space-y-2 p-3">
          <h3
            className="truncate text-sm font-medium leading-snug"
            title={product.name}
          >
            {product.name}
          </h3>
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 truncate text-sm font-semibold tabular-nums">
              <span>{formatPriceRange(product.defaultPrice?.normalPrice)}</span>
              {compareAtLabel && (
                <span
                  className="text-muted-foreground text-xs font-normal line-through"
                  title={`Compare at: ${compareAtLabel}`}
                >
                  {compareAtLabel}
                </span>
              )}
            </p>
            <Badge
              variant={product.published ? 'default' : 'secondary'}
              className="shrink-0 text-[10px]"
            >
              {product.published ? 'Published' : 'Draft'}
            </Badge>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}

export default function ManageProductsPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [meta, setMeta] = useState<ProductListMeta | null>(null);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'published' | 'draft'>('all');
  const [source, setSource] = useState<'all' | 'ae' | 'manual'>('all');
  const [categoryId, setCategoryId] = useState('all');
  const [addedBy, setAddedBy] = useState('all');
  const [featured, setFeatured] = useState<'all' | 'true' | 'false'>('all');
  const [sortBy, setSortBy] = useState('updatedAt');
  const [page, setPage] = useState(1);

  const flatCategories = useMemo(
    () => flattenCategories(categories),
    [categories]
  );
  const canUpdate = meta?.canUpdate ?? false;
  const canCreate = meta?.canCreate ?? false;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [status, source, categoryId, addedBy, featured, sortBy]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await requestCategories<{
        success: true;
        data: CategoryNode[];
      }>('/tree');
      setCategories(res.data);
    } catch (err) {
      console.error('Failed to load product filter categories:', err);
    }
  }, []);

  const loadProducts = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('pageSize', String(PAGE_SIZE));
        if (page > 1) params.set('page', String(page));
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (status !== 'all') params.set('status', status);
        if (source !== 'all') params.set('source', source);
        if (categoryId !== 'all') params.set('categoryId', categoryId);
        if (addedBy !== 'all') params.set('addedBy', addedBy);
        if (featured !== 'all') params.set('featured', featured);
        params.set('sortBy', sortBy);
        params.set('sortOrder', 'desc');

        const res = await requestJson<{
          success: true;
          data: ProductSummary[];
          meta: ProductListMeta;
        }>(`?${params.toString()}`);
        setProducts(res.data);
        setMeta(res.meta);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load products.';
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      addedBy,
      categoryId,
      debouncedSearch,
      featured,
      page,
      sortBy,
      source,
      status,
    ]
  );

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const hasFilters =
    debouncedSearch ||
    status !== 'all' ||
    source !== 'all' ||
    categoryId !== 'all' ||
    addedBy !== 'all' ||
    featured !== 'all';

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
                <BreadcrumbPage>Manage Products</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="sr-only text-2xl font-semibold tracking-tight">
              Manage Products
            </h1>
            <p className="text-muted-foreground max-w-2xl text-sm">
              Search products, narrow by publishing state or category, and open
              any product for a detailed review before editing.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadProducts(true)}
              disabled={loading || refreshing}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn('size-3.5', refreshing && 'animate-spin')}
              />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setUpdatingPrices(true);
                try {
                  let cursor: string | null = null;
                  let processed = 0;
                  do {
                    const params = new URLSearchParams({ batchSize: '50' });
                    if (cursor) params.set('cursor', cursor);
                    const result = await requestJson<{
                      success: true;
                      processed: number;
                      nextCursor: string | null;
                      done: boolean;
                    }>(`recalculate-prices?${params.toString()}`, {
                      method: 'POST',
                    });
                    processed += result.processed;
                    if (result.done) {
                      cursor = null;
                    } else if (
                      result.nextCursor &&
                      result.nextCursor !== cursor
                    ) {
                      cursor = result.nextCursor;
                    } else {
                      throw new Error(
                        'Price update stopped because the server returned an invalid cursor.'
                      );
                    }
                  } while (cursor);
                  toast.success(
                    processed === 1
                      ? 'Updated prices for 1 product.'
                      : `Updated prices for ${processed} products.`
                  );
                  await loadProducts(true);
                } catch (err) {
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : 'Failed to update product prices.'
                  );
                } finally {
                  setUpdatingPrices(false);
                }
              }}
              disabled={loading || refreshing || updatingPrices || !canUpdate}
              className="gap-1.5"
            >
              <RefreshCw className="size-3.5" />
              Update prices
            </Button>
            <Button asChild size="sm" disabled={!canCreate} className="gap-1.5">
              <Link href="/product/add">
                <Plus className="size-3.5" />
                Add product
              </Link>
            </Button>
          </div>
        </div>

        {meta && !meta.canUpdate && !meta.canDelete && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>Your access is read-only for product management actions.</p>
          </div>
        )}

        <Card>
          <CardContent className="space-y-4 py-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Filter className="size-4" />
              Filters
              {meta && (
                <span className="text-muted-foreground ml-auto text-xs font-normal tabular-nums">
                  {meta.total} product{meta.total === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(220px,1.4fr)_repeat(6,minmax(130px,1fr))]">
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search title, slug, AE id..."
                  className="pl-9"
                />
              </div>

              <Select
                value={status}
                onValueChange={(value) => setStatus(value as typeof status)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={source}
                onValueChange={(value) => setSource(value as typeof source)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="ae">AliExpress</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>

              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {flatCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={featured}
                onValueChange={(value) => setFeatured(value as typeof featured)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Featured" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Featured: all</SelectItem>
                  <SelectItem value="true">Featured only</SelectItem>
                  <SelectItem value="false">Not featured</SelectItem>
                </SelectContent>
              </Select>

              <Select value={addedBy} onValueChange={setAddedBy}>
                <SelectTrigger>
                  <SelectValue placeholder="Added by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Added by: all</SelectItem>
                  {meta?.addedByOptions.map((admin) => (
                    <SelectItem key={admin.id} value={admin.id}>
                      <span className="flex items-center gap-2">
                        <Avatar size="sm" className="size-5">
                          <AvatarImage src={admin.image ?? undefined} />
                          <AvatarFallback>
                            {getInitials(admin.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span>{admin.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger>
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updatedAt">Recently updated</SelectItem>
                  <SelectItem value="createdAt">Recently created</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="orderCount">Orders</SelectItem>
                  <SelectItem value="totalRevenue">Revenue</SelectItem>
                  <SelectItem value="addedBy">Added by</SelectItem>
                  <SelectItem value="position">Position</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, index) => (
              <ProductSkeleton key={index} />
            ))}
          </div>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <ShieldAlert className="text-destructive size-8" />
              <div>
                <p className="font-medium">Could not load products</p>
                <p className="text-muted-foreground mt-1 text-sm">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadProducts()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : products.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="bg-muted flex size-12 items-center justify-center rounded-full">
                <PackageSearch className="text-muted-foreground size-6" />
              </div>
              <div>
                <p className="font-medium">No products found</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {hasFilters
                    ? 'Try changing or clearing the current filters.'
                    : 'Create or import a product to start managing inventory.'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  canUpdate={canUpdate}
                />
              ))}
            </div>

            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={loading || meta.page <= 1}
                >
                  Previous
                </Button>
                <span className="text-muted-foreground text-sm tabular-nums">
                  Page {meta.page} of {meta.totalPages}
                  <span className="ml-2 opacity-70">({meta.total} total)</span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPage((value) => Math.min(meta.totalPages, value + 1))
                  }
                  disabled={loading || meta.page >= meta.totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
