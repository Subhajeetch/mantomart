'use client';

import CustomImage from '@/components/custom-image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  flattenCategories,
  formatMoney,
  normalizeProductPayload,
  requestCategories,
  requestJson,
  slugify,
  type CategoryNode,
  type ProductAttribute,
  type ProductDetail,
  type ProductDetailMeta,
  type ProductImage,
  type ProductPayload,
  type ProductSku,
  type SkuProperty,
} from '../../manage/utils';

const STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'media', label: 'Media' },
  { key: 'variants', label: 'Variants' },
  { key: 'attributes', label: 'Attributes' },
  { key: 'review', label: 'Review' },
] as const;

function emptyImage(position: number): ProductImage {
  return { url: '', alt: '', position };
}

function emptyProperty(): SkuProperty {
  return {
    aePropertyId: null,
    propertyName: '',
    aeValueId: null,
    value: '',
    valueDefinitionName: null,
    image: null,
  };
}

function emptySku(): ProductSku {
  return {
    aeSkuId: null,
    aeSkuAttr: null,
    price: 0,
    compareAtPrice: null,
    aePrice: null,
    aeSalePrice: null,
    stock: 0,
    sku: '',
    priceIncludesTax: false,
    images: [],
    properties: [],
  };
}

function emptyAttribute(position: number): ProductAttribute {
  return {
    aeAttrNameId: null,
    attrName: '',
    aeAttrValueId: null,
    attrValue: '',
    attrValueUnit: null,
    position,
  };
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dollarsFromCents(value: number | null | undefined) {
  if (value === null || value === undefined) return '';
  return String((value / 100).toFixed(2));
}

function centsFromDollars(value: string) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function StepIndicator({
  current,
  onJump,
}: {
  current: number;
  onJump: (step: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STEPS.map((step, index) => {
        const active = index === current;
        const done = index < current;
        return (
          <button
            key={step.key}
            type="button"
            onClick={() => onJump(index)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
              active && 'bg-primary text-primary-foreground',
              done && !active && 'bg-primary/15 text-primary hover:bg-primary/25',
              !done && !active && 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-[10px]',
                active && 'bg-primary-foreground/20 text-primary-foreground',
                done && !active && 'bg-primary text-primary-foreground',
                !done && !active && 'bg-background'
              )}
            >
              {done ? <Check className="size-3" /> : index + 1}
            </span>
            {step.label}
          </button>
        );
      })}
    </div>
  );
}

export default function ProductEditPage() {
  const params = useParams<{ productId: string }>();
  const router = useRouter();
  const productId = params.productId;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [form, setForm] = useState<ProductPayload | null>(null);
  const [meta, setMeta] = useState<ProductDetailMeta | null>(null);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);
  const selectedCategories = useMemo(
    () =>
      flatCategories.filter((category) =>
        form?.categoryIds.includes(category.id)
      ),
    [flatCategories, form?.categoryIds]
  );

  const loadProduct = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [productRes, categoryRes] = await Promise.all([
          requestJson<{
            success: true;
            data: ProductDetail;
            meta: ProductDetailMeta;
          }>(`/${productId}`),
          requestCategories<{ success: true; data: CategoryNode[] }>('/tree'),
        ]);
        setProduct(productRes.data);
        setForm(normalizeProductPayload(productRes.data));
        setMeta(productRes.meta);
        setCategories(categoryRes.data);
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

  function updateForm(patch: Partial<ProductPayload>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function updateSku(index: number, patch: Partial<ProductSku>) {
    setForm((current) => {
      if (!current) return current;
      const skus = current.skus.map((sku, i) =>
        i === index ? { ...sku, ...patch } : sku
      );
      return { ...current, skus };
    });
  }

  function updateProperty(
    skuIndex: number,
    propertyIndex: number,
    patch: Partial<SkuProperty>
  ) {
    setForm((current) => {
      if (!current) return current;
      const skus = current.skus.map((sku, i) => {
        if (i !== skuIndex) return sku;
        return {
          ...sku,
          properties: sku.properties.map((property, j) =>
            j === propertyIndex ? { ...property, ...patch } : property
          ),
        };
      });
      return { ...current, skus };
    });
  }

  function validateForm(payload: ProductPayload) {
    if (!payload.name.trim()) return 'Product name is required.';
    if (!payload.slug.trim()) return 'Slug is required.';
    if (!payload.categoryIds.length) return 'Select at least one category.';
    if (!payload.skus.length) return 'Add at least one variant.';
    for (const [index, sku] of payload.skus.entries()) {
      if (sku.price < 0) return `Variant ${index + 1} has an invalid price.`;
      if (sku.stock < 0) return `Variant ${index + 1} has an invalid stock.`;
      for (const [propIndex, property] of sku.properties.entries()) {
        if (!property.propertyName.trim() || !property.value.trim()) {
          return `Variant ${index + 1}, option ${propIndex + 1} needs a name and value.`;
        }
      }
    }
    for (const [index, attribute] of payload.attributes.entries()) {
      if (!attribute.attrName.trim() || !attribute.attrValue.trim()) {
        return `Attribute ${index + 1} needs a name and value.`;
      }
    }
    for (const [index, image] of payload.images.entries()) {
      if (!image.url.trim()) return `Image ${index + 1} needs a URL.`;
    }
    return null;
  }

  async function handleSave() {
    if (!form) return;
    const validation = validateForm(form);
    if (validation) {
      toast.error(validation);
      return;
    }

    setSaving(true);
    try {
      const payload: ProductPayload = {
        ...form,
        slug: slugify(form.slug || form.name),
        description: nullable(form.description ?? ''),
        mobileDetail: nullable(form.mobileDetail ?? ''),
        sizeChartImage: nullable(form.sizeChartImage ?? ''),
        sizeChartDescription: nullable(form.sizeChartDescription ?? ''),
        aeProductId: nullable(form.aeProductId ?? ''),
        aeCategoryId: nullable(form.aeCategoryId ?? ''),
        aeSalesCount: nullable(form.aeSalesCount ?? ''),
        aeStatus: nullable(form.aeStatus ?? ''),
        mainVideo: nullable(form.mainVideo ?? ''),
        metaTitle: nullable(form.metaTitle ?? ''),
        metaDescription: nullable(form.metaDescription ?? ''),
        productNotes: nullable(form.productNotes ?? ''),
        images: form.images
          .map((image, index) => ({
            ...image,
            url: image.url.trim(),
            alt: image.alt.trim(),
            position: image.position ?? index,
          }))
          .filter((image) => image.url),
        tags: form.tags.map((tag) => tag.trim()).filter(Boolean),
        skus: form.skus.map((sku) => ({
          ...sku,
          sku: nullable(sku.sku ?? ''),
          aeSkuId: nullable(sku.aeSkuId ?? ''),
          aeSkuAttr: nullable(sku.aeSkuAttr ?? ''),
          properties: sku.properties.map((property) => ({
            ...property,
            propertyName: property.propertyName.trim(),
            value: property.value.trim(),
            aePropertyId: nullable(property.aePropertyId ?? ''),
            aeValueId: nullable(property.aeValueId ?? ''),
            valueDefinitionName: nullable(property.valueDefinitionName ?? ''),
            image: nullable(property.image ?? ''),
          })),
        })),
        attributes: form.attributes.map((attribute, index) => ({
          ...attribute,
          attrName: attribute.attrName.trim(),
          attrValue: attribute.attrValue.trim(),
          aeAttrNameId: nullable(attribute.aeAttrNameId ?? ''),
          aeAttrValueId: nullable(attribute.aeAttrValueId ?? ''),
          attrValueUnit: nullable(attribute.attrValueUnit ?? ''),
          position: attribute.position ?? index,
        })),
      };

      const res = await requestJson<{
        success: true;
        message?: string;
        data: { id: string };
      }>(`/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      toast.success(res.message || 'Product updated.');
      router.push(`/product/view/${productId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
      setSaving(false);
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
                <BreadcrumbPage>Edit Product</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button asChild variant="outline" size="sm" className="w-fit gap-1.5">
            <Link href={`/product/view/${productId}`}>
              <ArrowLeft className="size-3.5" />
              Product
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || refreshing || saving}
              onClick={() => void loadProduct(true)}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn('size-3.5', refreshing && 'animate-spin')}
              />
              Reload
            </Button>
            <Button
              size="sm"
              disabled={loading || saving || !form || !meta?.canUpdate}
              onClick={() => void handleSave()}
              className="gap-1.5"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save changes
            </Button>
          </div>
        </div>

        {loading ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading editor...
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
        ) : form && product ? (
          <>
            {!meta?.canUpdate && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <p>You do not have product update permission.</p>
              </div>
            )}

            <Card>
              <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">Editing</p>
                  <h1 className="truncate text-xl font-semibold">{product.name}</h1>
                </div>
                <StepIndicator current={step} onJump={setStep} />
              </CardContent>
            </Card>

            {step === 0 && (
              <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                <Card>
                  <CardContent className="space-y-4 p-4">
                    <h2 className="font-medium">Core details</h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                          id="name"
                          value={form.name}
                          onChange={(event) =>
                            updateForm({
                              name: event.target.value,
                              slug: form.slug ? form.slug : slugify(event.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="slug">Slug</Label>
                        <Input
                          id="slug"
                          value={form.slug}
                          onChange={(event) =>
                            updateForm({ slug: slugify(event.target.value) })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="position">Position</Label>
                        <Input
                          id="position"
                          type="number"
                          min={0}
                          value={form.position}
                          onChange={(event) =>
                            updateForm({
                              position: Number.parseInt(event.target.value, 10) || 0,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="description">Short description</Label>
                        <Textarea
                          id="description"
                          value={form.description ?? ''}
                          onChange={(event) =>
                            updateForm({ description: event.target.value })
                          }
                          rows={4}
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="mobileDetail">Product detail HTML</Label>
                        <Textarea
                          id="mobileDetail"
                          value={form.mobileDetail ?? ''}
                          onChange={(event) =>
                            updateForm({ mobileDetail: event.target.value })
                          }
                          rows={10}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.published}
                          onChange={(event) =>
                            updateForm({ published: event.target.checked })
                          }
                        />
                        Published
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.featured}
                          onChange={(event) =>
                            updateForm({ featured: event.target.checked })
                          }
                        />
                        Featured
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.isAEProduct}
                          onChange={(event) =>
                            updateForm({ isAEProduct: event.target.checked })
                          }
                        />
                        AliExpress product
                      </label>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-4 p-4">
                    <h2 className="font-medium">Categories & SEO</h2>
                    <div className="max-h-72 space-y-2 overflow-auto rounded-lg border p-2">
                      {flatCategories.map((category) => (
                        <label
                          key={category.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                        >
                          <input
                            type="checkbox"
                            checked={form.categoryIds.includes(category.id)}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...form.categoryIds, category.id]
                                : form.categoryIds.filter((id) => id !== category.id);
                              updateForm({ categoryIds: Array.from(new Set(next)) });
                            }}
                          />
                          <span className="truncate">{category.label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {selectedCategories.map((category) => (
                        <Badge key={category.id} variant="secondary">
                          {category.name}
                        </Badge>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="metaTitle">Meta title</Label>
                      <Input
                        id="metaTitle"
                        value={form.metaTitle ?? ''}
                        onChange={(event) =>
                          updateForm({ metaTitle: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="metaDescription">Meta description</Label>
                      <Textarea
                        id="metaDescription"
                        value={form.metaDescription ?? ''}
                        onChange={(event) =>
                          updateForm({ metaDescription: event.target.value })
                        }
                        rows={3}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tags">Tags</Label>
                      <Input
                        id="tags"
                        value={form.tags.join(', ')}
                        onChange={(event) =>
                          updateForm({
                            tags: event.target.value
                              .split(',')
                              .map((tag) => tag.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="summer, dress, cotton"
                      />
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            {step === 1 && (
              <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <Card>
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-medium">Images</h2>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          updateForm({
                            images: [...form.images, emptyImage(form.images.length)],
                          })
                        }
                        className="gap-1.5"
                      >
                        <Plus className="size-3.5" />
                        Image
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      {form.images.map((image, index) => (
                        <div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[96px_1fr_auto]">
                          <div className="relative aspect-square overflow-hidden rounded-md bg-muted">
                            {image.url ? (
                              <CustomImage src={image.url} alt={image.alt || 'Product image'} sizes="96px" className="object-cover" />
                            ) : (
                              <div className="flex h-full items-center justify-center">
                                <ImageIcon className="text-muted-foreground size-5" />
                              </div>
                            )}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Input
                              value={image.url}
                              onChange={(event) =>
                                updateForm({
                                  images: form.images.map((img, i) =>
                                    i === index ? { ...img, url: event.target.value } : img
                                  ),
                                })
                              }
                              placeholder="Image URL"
                              className="sm:col-span-2"
                            />
                            <Input
                              value={image.alt}
                              onChange={(event) =>
                                updateForm({
                                  images: form.images.map((img, i) =>
                                    i === index ? { ...img, alt: event.target.value } : img
                                  ),
                                })
                              }
                              placeholder="Alt text"
                            />
                            <Input
                              type="number"
                              value={image.position ?? index}
                              onChange={(event) =>
                                updateForm({
                                  images: form.images.map((img, i) =>
                                    i === index
                                      ? {
                                          ...img,
                                          position:
                                            Number.parseInt(event.target.value, 10) || 0,
                                        }
                                      : img
                                  ),
                                })
                              }
                              placeholder="Position"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              updateForm({
                                images: form.images.filter((_, i) => i !== index),
                              })
                            }
                            aria-label="Remove image"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-4 p-4">
                    <h2 className="font-medium">Video & size chart</h2>
                    <div className="space-y-1.5">
                      <Label>Main video URL</Label>
                      <Input
                        value={form.mainVideo ?? ''}
                        onChange={(event) =>
                          updateForm({ mainVideo: event.target.value })
                        }
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.hasSizeChart}
                        onChange={(event) =>
                          updateForm({ hasSizeChart: event.target.checked })
                        }
                      />
                      Has size chart
                    </label>
                    <div className="space-y-1.5">
                      <Label>Size chart image</Label>
                      <Input
                        value={form.sizeChartImage ?? ''}
                        onChange={(event) =>
                          updateForm({ sizeChartImage: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Size chart notes</Label>
                      <Textarea
                        rows={5}
                        value={form.sizeChartDescription ?? ''}
                        onChange={(event) =>
                          updateForm({ sizeChartDescription: event.target.value })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            {step === 2 && (
              <Card>
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-medium">Variants</h2>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateForm({ skus: [...form.skus, emptySku()] })}
                      className="gap-1.5"
                    >
                      <Plus className="size-3.5" />
                      Variant
                    </Button>
                  </div>
                  <div className="space-y-4">
                    {form.skus.map((sku, skuIndex) => (
                      <div key={skuIndex} className="space-y-3 rounded-lg border p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">Variant {skuIndex + 1}</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={form.skus.length <= 1}
                            onClick={() =>
                              updateForm({
                                skus: form.skus.filter((_, index) => index !== skuIndex),
                              })
                            }
                            className="gap-1.5"
                          >
                            <Trash2 className="size-3.5" />
                            Remove
                          </Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="space-y-1.5">
                            <Label>SKU code</Label>
                            <Input
                              value={sku.sku ?? ''}
                              onChange={(event) =>
                                updateSku(skuIndex, { sku: event.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Price</Label>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={dollarsFromCents(sku.price)}
                              onChange={(event) =>
                                updateSku(skuIndex, {
                                  price: centsFromDollars(event.target.value),
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Compare price</Label>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={dollarsFromCents(sku.compareAtPrice)}
                              onChange={(event) =>
                                updateSku(skuIndex, {
                                  compareAtPrice: event.target.value
                                    ? centsFromDollars(event.target.value)
                                    : null,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Stock</Label>
                            <Input
                              type="number"
                              min={0}
                              value={sku.stock}
                              onChange={(event) =>
                                updateSku(skuIndex, {
                                  stock: Number.parseInt(event.target.value, 10) || 0,
                                })
                              }
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium">Options</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                updateSku(skuIndex, {
                                  properties: [...sku.properties, emptyProperty()],
                                })
                              }
                              className="gap-1.5"
                            >
                              <Plus className="size-3.5" />
                              Option
                            </Button>
                          </div>
                          {sku.properties.map((property, propertyIndex) => (
                            <div key={propertyIndex} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                              <Input
                                value={property.propertyName}
                                onChange={(event) =>
                                  updateProperty(skuIndex, propertyIndex, {
                                    propertyName: event.target.value,
                                  })
                                }
                                placeholder="Color"
                              />
                              <Input
                                value={property.value}
                                onChange={(event) =>
                                  updateProperty(skuIndex, propertyIndex, {
                                    value: event.target.value,
                                  })
                                }
                                placeholder="Black"
                              />
                              <Input
                                value={property.image ?? ''}
                                onChange={(event) =>
                                  updateProperty(skuIndex, propertyIndex, {
                                    image: event.target.value,
                                  })
                                }
                                placeholder="Option image URL"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() =>
                                  updateSku(skuIndex, {
                                    properties: sku.properties.filter(
                                      (_, index) => index !== propertyIndex
                                    ),
                                  })
                                }
                                aria-label="Remove option"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 3 && (
              <Card>
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-medium">Attributes</h2>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateForm({
                          attributes: [
                            ...form.attributes,
                            emptyAttribute(form.attributes.length),
                          ],
                        })
                      }
                      className="gap-1.5"
                    >
                      <Plus className="size-3.5" />
                      Attribute
                    </Button>
                  </div>
                  <div className="grid gap-3">
                    {form.attributes.map((attribute, index) => (
                      <div key={index} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_1fr_120px_auto]">
                        <Input
                          value={attribute.attrName}
                          onChange={(event) =>
                            updateForm({
                              attributes: form.attributes.map((item, i) =>
                                i === index
                                  ? { ...item, attrName: event.target.value }
                                  : item
                              ),
                            })
                          }
                          placeholder="Material"
                        />
                        <Input
                          value={attribute.attrValue}
                          onChange={(event) =>
                            updateForm({
                              attributes: form.attributes.map((item, i) =>
                                i === index
                                  ? { ...item, attrValue: event.target.value }
                                  : item
                              ),
                            })
                          }
                          placeholder="Cotton"
                        />
                        <Input
                          type="number"
                          value={attribute.position}
                          onChange={(event) =>
                            updateForm({
                              attributes: form.attributes.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      position:
                                        Number.parseInt(event.target.value, 10) || 0,
                                    }
                                  : item
                              ),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() =>
                            updateForm({
                              attributes: form.attributes.filter((_, i) => i !== index),
                            })
                          }
                          aria-label="Remove attribute"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                    {form.attributes.length === 0 && (
                      <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
                        No attributes yet.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 4 && (
              <section className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardContent className="space-y-4 p-4">
                    <h2 className="font-medium">Review changes</h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">Name</p>
                        <p className="font-medium">{form.name}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">Slug</p>
                        <p className="font-medium">/{slugify(form.slug || form.name)}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">Categories</p>
                        <p className="font-medium">{form.categoryIds.length}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">Images</p>
                        <p className="font-medium">{form.images.length}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">Variants</p>
                        <p className="font-medium">{form.skus.length}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">Lowest price</p>
                        <p className="font-medium">
                          {formatMoney(Math.min(...form.skus.map((sku) => sku.price)))}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-4 p-4">
                    <h2 className="font-medium">Publish state</h2>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={form.published ? 'default' : 'secondary'}>
                        {form.published ? 'Published' : 'Draft'}
                      </Badge>
                      {form.featured && <Badge variant="outline">Featured</Badge>}
                      {form.isAEProduct && <Badge variant="outline">AliExpress</Badge>}
                    </div>
                    <Button
                      type="button"
                      disabled={saving || !meta?.canUpdate}
                      onClick={() => void handleSave()}
                      className="w-full gap-1.5"
                    >
                      {saving ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />}
                      Save product
                    </Button>
                  </CardContent>
                </Card>
              </section>
            )}

            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={step === 0}
                onClick={() => setStep((value) => Math.max(0, value - 1))}
                className="gap-1.5"
              >
                <ChevronLeft className="size-3.5" />
                Previous
              </Button>
              <Button
                type="button"
                disabled={step === STEPS.length - 1}
                onClick={() =>
                  setStep((value) => Math.min(STEPS.length - 1, value + 1))
                }
                className="gap-1.5"
              >
                Next
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}
