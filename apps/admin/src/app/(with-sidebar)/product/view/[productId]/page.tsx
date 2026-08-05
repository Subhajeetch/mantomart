'use client';

import CustomImage from '@/components/custom-image';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  DollarSign,
  Edit,
  ExternalLink,
  ImageIcon,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  ShoppingBag,
  ShoppingCart,
  Tags,
  TrendingUp,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import {
  formatCentsRange,
  formatDateTime,
  formatMoney,
  requestJson,
  type ProductDetail,
  type ProductDetailMeta,
  type ProductSku,
} from '../../manage/utils';
import Image from 'next/image';

function getInitials(name: string | null | undefined) {
  return (name || 'Admin')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function InfoTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1 truncate font-medium tabular-nums">{value}</p>
    </div>
  );
}

/** Resolve the best image URL for a variant (SKU images → property image). */
function getVariantImageUrl(sku: ProductSku): string | null {
  const fromImages = sku.images?.find((img) => img?.url)?.url;
  if (fromImages) return fromImages;
  const fromProp = sku.properties?.find((prop) => prop.image)?.image;
  return fromProp || null;
}

function rangeFromValues(values: number[]): {
  min: number | null;
  max: number | null;
  label: string | null;
} {
  if (!values.length) return { min: null, max: null, label: null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, label: formatCentsRange(min, max) };
}

function PriceOverview({ skus }: { skus: ProductSku[] }) {
  const sell = rangeFromValues(skus.map((sku) => sku.price).filter((n) => Number.isFinite(n)));
  const compare = rangeFromValues(
    skus
      .map((sku) => sku.compareAtPrice)
      .filter((n): n is number => n !== null && n !== undefined && Number.isFinite(n))
  );
  const aeActual = rangeFromValues(
    skus
      .map((sku) =>
        sku.aeSalePrice !== null && sku.aeSalePrice !== undefined
          ? sku.aeSalePrice
          : sku.aePrice
      )
      .filter((n): n is number => n !== null && n !== undefined && Number.isFinite(n))
  );
  const aeCompare = rangeFromValues(
    skus
      .map((sku) => sku.aePrice)
      .filter((n): n is number => n !== null && n !== undefined && Number.isFinite(n))
  );

  return (
    <div className="rounded-lg border p-3">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <DollarSign className="size-3.5" />
        Price
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="text-base font-semibold tabular-nums tracking-tight">
          {sell.label ?? 'No price'}
        </p>
        {compare.label && (
          <p
            className="text-muted-foreground text-sm tabular-nums line-through"
            title={`Compare at: ${compare.label}`}
          >
            {compare.label}
          </p>
        )}
      </div>
      {(aeActual.label || aeCompare.label) && (
        <div className="text-xs flex gap-2">
          <Image
                src="/icons/aliexpress_logo.webp"
                alt="Search Icon"
                width={16}
                height={14}
              />
          {aeActual.label && (
              <span className="font-medium tabular-nums">{aeActual.label}</span>
          )}
          {aeCompare.label &&
            aeCompare.label !== aeActual.label && (
                <span className="text-muted-foreground tabular-nums line-through">
                  {aeCompare.label}
                </span>
            )}
        </div>
      )}
    </div>
  );
}

function DeleteDialog({
  product,
  open,
  loading,
  onOpenChange,
  onConfirm,
}: {
  product: ProductDetail | null;
  open: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete product</DialogTitle>
          <DialogDescription>
            This action permanently removes product data and requires a second
            confirmation.
          </DialogDescription>
        </DialogHeader>
        {product && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="font-medium">{product.name}</p>
              <p className="text-muted-foreground text-xs">
                {product.skus.length} SKU{product.skus.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delete-confirm-name">Type product name</Label>
              <Input
                id="delete-confirm-name"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={product.name}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={!product || typed.trim() !== product.name || loading}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type VariantRow = ProductSku & {
  index: number;
};

function SortableHead({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="-ml-2 h-8 gap-1 px-2 text-xs font-medium"
    >
      {label}
      <ArrowUpDown className="size-3" />
    </Button>
  );
}

function VariantsDialog({
  product,
  open,
  onOpenChange,
}: {
  product: ProductDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [query, setQuery] = useState('');

  const rows = useMemo<VariantRow[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const skus =
      product?.skus.map((sku, index) => ({
        ...sku,
        index,
      })) ?? [];

    if (!normalizedQuery) return skus;

    return skus.filter((sku) => {
      const optionText = sku.properties
        .map((prop) => `${prop.propertyName} ${prop.value}`)
        .join(' ');
      return [
        sku.sku,
        sku.aeSkuId,
        sku.aeSkuAttr,
        formatMoney(sku.price),
        String(sku.stock),
        optionText,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [product?.skus, query]);

  const totalStock = rows.reduce((sum, sku) => sum + sku.stock, 0);
  const prices = rows.map((sku) => sku.price);
  const priceRange =
    prices.length === 0
      ? 'No price'
      : Math.min(...prices) === Math.max(...prices)
        ? formatMoney(Math.min(...prices))
        : `${formatMoney(Math.min(...prices))} - ${formatMoney(Math.max(...prices))}`;

  const columns = useMemo<ColumnDef<VariantRow>[]>(
    () => [
      {
        id: 'image',
        header: 'Image',
        enableSorting: false,
        cell: ({ row }) => {
          const url = getVariantImageUrl(row.original);
          return (
            <div className="bg-muted relative size-11 overflow-hidden rounded-md border">
              {url ? (
                <CustomImage
                  src={url}
                  alt={
                    row.original.images?.[0]?.alt ||
                    row.original.sku ||
                    `Variant ${row.original.index + 1}`
                  }
                  width={44}
                  height={44}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <ImageIcon className="text-muted-foreground size-3.5" />
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: 'options',
        accessorFn: (row) =>
          row.properties
            .map((prop) => `${prop.propertyName}:${prop.value}`)
            .join(' '),
        header: 'Options',
        cell: ({ row }) => (
          <div className="flex min-w-48 max-w-[420px] flex-wrap gap-1.5">
            {row.original.properties.length ? (
              row.original.properties.map((prop, propIndex) => (
                <Badge
                  key={`${row.original.id ?? row.original.index}-${propIndex}-${prop.propertyName}-${prop.value}`}
                  variant="secondary"
                  className="max-w-full"
                >
                  <span className="truncate">
                    {prop.propertyName}: {prop.value}
                  </span>
                </Badge>
              ))
            ) : (
              <Badge variant="outline">Default</Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'price',
        header: ({ column }) => (
          <SortableHead
            label="Price"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          />
        ),
        cell: ({ row }) => (
          <div className="min-w-20">
            <span className="font-medium tabular-nums">
              {formatMoney(row.original.price)}
            </span>
            {row.original.compareAtPrice != null && (
              <p className="text-muted-foreground text-xs tabular-nums line-through">
                {formatMoney(row.original.compareAtPrice)}
              </p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'estProfit',
        header: ({ column }) => (
          <SortableHead
            label="Est. Profit"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          />
        ),
        cell: ({ row }) => (
          <span
            className={cn(
              'font-medium tabular-nums',
              row.original.estProfit != null &&
                row.original.estProfit < 0 &&
                'text-destructive'
            )}
          >
            {formatMoney(row.original.estProfit)}
          </span>
        ),
      },
      {
        accessorKey: 'stock',
        header: ({ column }) => (
          <SortableHead
            label="Stock"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          />
        ),
        cell: ({ row }) => (
          <Badge
            variant={row.original.stock > 0 ? 'outline' : 'destructive'}
            className="tabular-nums"
          >
            {row.original.stock}
          </Badge>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden"
      style={{ width: "min(96vw, 1120px)", maxWidth: "none" }}
      >
        <DialogHeader>
          <DialogTitle>Product variants</DialogTitle>
          <DialogDescription>
            Variant images, prices, estimated profit, stock, and option combinations.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs">Variants</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {product?.skus.length ?? 0}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs">Visible stock</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{totalStock}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs">Visible price range</p>
            <p className="mt-1 truncate text-lg font-semibold">{priceRange}</p>
          </div>
        </div>

        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search variants by option, price, or stock..."
            className="pl-9"
          />
        </div>

        <div className="min-h-0 overflow-auto rounded-lg border">
          <Table className="min-w-[880px]">
            <TableHeader className="sticky top-0 z-10 bg-background">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    <div className="text-muted-foreground text-sm">
                      No variants match the current search.
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductViewPage() {
  const params = useParams<{ productId: string }>();
  const router = useRouter();
  const productId = params.productId;
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [meta, setMeta] = useState<ProductDetailMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadProduct = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await requestJson<{
          success: true;
          data: ProductDetail;
          meta: ProductDetailMeta;
        }>(`/${productId}`);
        setProduct(res.data);
        setMeta(res.meta);
        setSelectedImage(0);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load product.';
        setError(message);
        if (!silent) toast.error(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [productId]
  );

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  const totalStock = useMemo(
    () => product?.skus.reduce((sum, sku) => sum + sku.stock, 0) ?? 0,
    [product]
  );

  const estProfitRange = useMemo(() => {
    const values =
      product?.skus
        .map((sku) => sku.estProfit)
        .filter((n): n is number => n !== null && n !== undefined && Number.isFinite(n)) ??
      [];
    return rangeFromValues(values).label;
  }, [product]);

  async function handleDelete() {
    if (!product) return;
    setDeleting(true);
    try {
      const res = await requestJson<{ success: true; message?: string }>(
        `/${product.id}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ confirm: true }),
        }
      );
      toast.success(res.message || 'Product deleted.');
      router.push('/product/manage');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete product.');
    } finally {
      setDeleting(false);
    }
  }

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
                <BreadcrumbPage>Product Details</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button asChild variant="outline" size="sm" className="w-fit gap-1.5">
            <Link href="/product/manage">
              <ArrowLeft className="size-3.5" />
              Products
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || refreshing}
              onClick={() => void loadProduct(true)}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn('size-3.5', refreshing && 'animate-spin')}
              />
              Refresh
            </Button>
            {product && meta?.canUpdate && (
              <Button asChild size="sm" className="gap-1.5">
                <Link href={`/product/edit/${product.id}`}>
                  <Edit className="size-3.5" />
                  Edit
                </Link>
              </Button>
            )}
            {product && meta?.canDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteOpen(true)}
                className="gap-1.5"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading product...
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <ShieldAlert className="text-destructive size-8" />
              <div>
                <p className="font-medium">Could not load product</p>
                <p className="text-muted-foreground mt-1 text-sm">{error}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadProduct()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : product ? (
          <>
            <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <div className="space-y-3">
                <div className="relative aspect-[1/1] overflow-hidden rounded-lg border bg-muted">
                  {product.images[selectedImage]?.url ? (
                    <CustomImage
                      src={product.images[selectedImage].url}
                      alt={product.images[selectedImage].alt || product.name}
                      priority
                      width={675}
                      height={675}
                      className="h-full w-full"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ImageIcon className="text-muted-foreground size-10" />
                    </div>
                  )}
                </div>
                {product.images.length > 1 && (
                  <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
                    {product.images.slice(0, 14).map((image, index) => (
                      <button
                        key={`${image.url}-${index}`}
                        type="button"
                        onClick={() => setSelectedImage(index)}
                        className={cn(
                          'relative aspect-square overflow-hidden rounded-md border bg-muted',
                          selectedImage === index && 'ring-2 ring-primary'
                        )}
                      >
                        <CustomImage
                          src={image.url}
                          alt={image.alt || `${product.name} ${index + 1}`}
                          width={96}
                          height={96}
                          className="h-full w-full"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={product.published ? 'default' : 'secondary'}>
                      {product.published ? 'Published' : 'Draft'}
                    </Badge>
                    {product.featured && <Badge variant="outline">Featured</Badge>}
                    {product.isAEProduct && <Badge variant="outline">AliExpress</Badge>}
                  </div>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                      {product.name}
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                      /{product.slug}
                    </p>
                  </div>
                  {product.description && (
                    <p className="text-muted-foreground text-sm leading-6">
                      {product.description}
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
                  <PriceOverview skus={product.skus} />
                  <InfoTile label="Stock" value={totalStock} icon={ShoppingBag} />
                  <button
                    type="button"
                    onClick={() => setVariantsOpen(true)}
                    className="rounded-lg border p-3 text-left transition hover:border-primary/50 hover:bg-muted/40"
                  >
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                      <CheckCircle2 className="size-3.5" />
                      Variants
                    </div>
                    <p className="mt-1 truncate font-medium tabular-nums">
                      {product.skus.length} · view all
                    </p>
                  </button>
                  <InfoTile
                    label="Orders"
                    value={product.orderCount ?? 0}
                    icon={ShoppingCart}
                  />
                  <InfoTile
                    label="Revenue (Total Sold)"
                    value={formatMoney(product.totalRevenue ?? 0)}
                    icon={DollarSign}
                  />
                  <InfoTile
                    label="Revenue in profit"
                    value={formatMoney(product.revenueInProfit ?? 0)}
                    icon={TrendingUp}
                  />
                  <InfoTile
                    label="Est. Profit"
                    value={estProfitRange ?? 'Not set'}
                    icon={TrendingUp}
                  />
                  <InfoTile
                    label="Created"
                    value={formatDateTime(product.createdAt)}
                    icon={Calendar}
                  />
                  <InfoTile
                    label="Updated"
                    value={formatDateTime(product.updatedAt)}
                    icon={Calendar}
                  />
                </div>

                <Card>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Tags className="size-4" />
                      Organization
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {product.categories.length > 0 ? (
                        product.categories.map((category) => (
                          <Badge key={category.id} variant="secondary">
                            {category.name}
                          </Badge>
                        ))
                      ) : (
                        <p className="text-muted-foreground text-sm">No categories</p>
                      )}
                    </div>
                    {product.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {product.tags.map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardContent className="space-y-4 p-4">
                  <h2 className="font-medium">Admin & SEO</h2>
                  <div className="space-y-4 text-sm">
                    <div className="flex items-center gap-3 rounded-lg border p-3">
                      <Avatar size="sm">
                        <AvatarImage src={product.addedBy?.image ?? undefined} />
                        <AvatarFallback>
                          {getInitials(product.addedBy?.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-muted-foreground text-xs">Added by</p>
                        <p className="truncate font-medium">
                          {product.addedBy?.name || product.productAddedBy || 'Unknown'}
                        </p>
                        {product.addedBy?.email && (
                          <p className="text-muted-foreground truncate text-xs">
                            {product.addedBy.email}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-muted-foreground text-xs">Created</p>
                        <p>{formatDateTime(product.createdAt)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Updated</p>
                        <p>{formatDateTime(product.updatedAt)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Orders</p>
                        <p className="font-medium tabular-nums">
                          {product.orderCount ?? 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Total revenue</p>
                        <p className="font-medium tabular-nums">
                          {formatMoney(product.totalRevenue ?? 0)}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Meta title</p>
                      <p>{product.metaTitle || 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Meta description</p>
                      <p>{product.metaDescription || 'Not set'}</p>
                    </div>
                    {product.productNotes && (
                      <div>
                        <p className="text-muted-foreground text-xs">Internal notes</p>
                        <p className="whitespace-pre-wrap">{product.productNotes}</p>
                      </div>
                    )}
                    {product.aeProductId && (
                      <div>
                        <p className="text-muted-foreground text-xs">AliExpress ID</p>
                        <p className="flex items-center gap-1">
                          {product.aeProductId}
                          <ExternalLink className="size-3" />
                        </p>
                      </div>
                    )}
                    {product.aeLastSynced && (
                      <div>
                        <p className="text-muted-foreground text-xs">AE last synced</p>
                        <p>{formatDateTime(product.aeLastSynced)}</p>
                      </div>
                    )}
                    {product.aeStatus && (
                      <div>
                        <p className="text-muted-foreground text-xs">AE status</p>
                        <p>{product.aeStatus}</p>
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <p className="text-muted-foreground text-xs">AE rating</p>
                        <p>
                          {product.aeRating != null
                            ? `${product.aeRating}/5`
                            : 'Not set'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">AE reviews</p>
                        <p className="tabular-nums">
                          {product.aeReviewCount ?? 'Not set'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">AE sales</p>
                        <p>{product.aeSalesCount || 'Not set'}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-4 p-4">
                  <h2 className="font-medium">Main description</h2>
                  {product.description ? (
                    <p className="text-muted-foreground whitespace-pre-wrap text-sm leading-6">
                      {product.description}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      No main description has been added.
                    </p>
                  )}
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardContent className="space-y-4 p-4">
                  <h2 className="font-medium">Attributes</h2>
                  {product.attributes.length ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {product.attributes.map((attribute, index) => (
                        <div key={attribute.id ?? index} className="rounded-lg border p-3">
                          <p className="text-muted-foreground text-xs">
                            {attribute.attrName}
                          </p>
                          <p className="font-medium">{attribute.attrValue}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      No attributes have been added.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-4 p-4">
                  <h2 className="font-medium">Product detail HTML</h2>
                  {product.mobileDetail ? (
                    <div
                      className="prose prose-sm dark:prose-invert max-h-96 overflow-auto rounded-lg border p-3"
                      dangerouslySetInnerHTML={{ __html: product.mobileDetail }}
                    />
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      No long-form product detail has been added.
                    </p>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        ) : null}
      </main>

      <DeleteDialog
        product={product}
        open={deleteOpen}
        loading={deleting}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void handleDelete()}
      />
      <VariantsDialog
        product={product}
        open={variantsOpen}
        onOpenChange={setVariantsOpen}
      />
    </>
  );
}
