'use client';

import '@uiw/react-md-editor/markdown-editor.css';
import dynamic from 'next/dynamic';
import CustomImage from '@/components/custom-image';
import { ProxiedImg } from '@/util/proxied-image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  GripVertical,
  ImageIcon,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Tag,
  Trash2,
  Video,
  X,
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
import { Switch } from '@/components/ui/switch';
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
} from '../../manage/utils';

import { AeMediaDialog } from './ae-media-dialog';
import {
  htmlToMarkdown,
  imageDedupeKey,
  markdownToHtml,
  serializeFormSnapshot,
} from './edit-utils';
import { EditVariantsSection } from './edit-variants';

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading editor…
    </div>
  ),
});

const STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'media', label: 'Media' },
  { key: 'variants', label: 'Variants' },
  { key: 'attributes', label: 'Attributes' },
  { key: 'review', label: 'Review' },
] as const;

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

function SortableImageRow({
  id,
  image,
  index,
  onAltChange,
  onRemove,
}: {
  id: string;
  image: ProductImage;
  index: number;
  onAltChange: (alt: string) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'grid gap-3 rounded-lg border p-3 md:grid-cols-[40px_96px_1fr_auto]',
        isDragging && 'z-10 bg-background shadow-lg ring-1 ring-border'
      )}
    >
      <button
        type="button"
        className="flex size-9 touch-none items-center justify-center self-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Drag to reorder image ${index + 1}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="relative aspect-square overflow-hidden rounded-md bg-muted">
        {image.url ? (
          <CustomImage
            src={image.url}
            alt={image.alt || 'Product image'}
            sizes="96px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="size-5 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="space-y-1.5 self-center">
        <Label className="text-xs text-muted-foreground">
          Alt text · position {index + 1} {(index === 0 && '- Thumbnail') || ''}
        </Label>
        <Input
          value={image.alt}
          onChange={(e) => onAltChange(e.target.value)}
          placeholder="Alt text for SEO"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onRemove}
        aria-label="Remove image"
        className="self-center"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function SortableAttributeRow({
  id,
  attribute,
  onChange,
  onRemove,
}: {
  id: string;
  attribute: ProductAttribute;
  onChange: (patch: Partial<ProductAttribute>) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'grid gap-2 rounded-lg border p-3 md:grid-cols-[40px_1fr_1fr_120px_auto]',
        isDragging && 'z-10 bg-background shadow-lg ring-1 ring-border'
      )}
    >
      <button
        type="button"
        className="flex size-9 touch-none items-center justify-center self-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Drag to reorder attribute"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <Input
        value={attribute.attrName}
        onChange={(e) => onChange({ attrName: e.target.value })}
        placeholder="Material"
      />
      <Input
        value={attribute.attrValue}
        onChange={(e) => onChange({ attrValue: e.target.value })}
        placeholder="Cotton"
      />
      <Input
        value={attribute.attrValueUnit ?? ''}
        onChange={(e) =>
          onChange({ attrValueUnit: e.target.value.trim() || null })
        }
        placeholder="Unit"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onRemove}
        aria-label="Remove attribute"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

export default function ProductEditPage() {
  const params = useParams<{ productId: string }>();
  const router = useRouter();
  const productId = params.productId;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [form, setForm] = useState<ProductPayload | null>(null);
  const [mobileDetailMarkdown, setMobileDetailMarkdown] = useState('');
  const [meta, setMeta] = useState<ProductDetailMeta | null>(null);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const [categorySearch, setCategorySearch] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);

  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);

  const [mediaDialog, setMediaDialog] = useState<{
    open: boolean;
    mode: 'images' | 'video' | 'size-chart';
  }>({ open: false, mode: 'images' });

  const baselineRef = useRef<string>('');
  const imageIdsRef = useRef<string[]>([]);
  const attrIdsRef = useRef<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const flatCategories = useMemo(
    () => flattenCategories(categories),
    [categories]
  );

  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return flatCategories;
    return flatCategories.filter(
      (c) =>
        c.label.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    );
  }, [flatCategories, categorySearch]);

  const derivedSlug = useMemo(
    () => slugify(form?.name ?? ''),
    [form?.name]
  );

  const isDirty = useMemo(() => {
    if (!form) return false;
    return (
      serializeFormSnapshot(form, mobileDetailMarkdown) !== baselineRef.current
    );
  }, [form, mobileDetailMarkdown]);

  const ensureImageIds = useCallback((count: number) => {
    while (imageIdsRef.current.length < count) {
      imageIdsRef.current.push(
        `img-${Date.now()}-${imageIdsRef.current.length}-${Math.random().toString(36).slice(2, 7)}`
      );
    }
    if (imageIdsRef.current.length > count) {
      imageIdsRef.current = imageIdsRef.current.slice(0, count);
    }
    return imageIdsRef.current;
  }, []);

  const ensureAttrIds = useCallback((count: number) => {
    while (attrIdsRef.current.length < count) {
      attrIdsRef.current.push(
        `attr-${Date.now()}-${attrIdsRef.current.length}-${Math.random().toString(36).slice(2, 7)}`
      );
    }
    if (attrIdsRef.current.length > count) {
      attrIdsRef.current = attrIdsRef.current.slice(0, count);
    }
    return attrIdsRef.current;
  }, []);

  const applyLoadedProduct = useCallback((data: ProductDetail) => {
    const payload = normalizeProductPayload(data);
    const md = htmlToMarkdown(payload.mobileDetail);
    setProduct(data);
    setForm(payload);
    setMobileDetailMarkdown(md);
    baselineRef.current = serializeFormSnapshot(payload, md);
    imageIdsRef.current = payload.images.map(
      (_, i) => `img-init-${i}-${payload.images[i]?.url?.slice(-12) ?? i}`
    );
    attrIdsRef.current = payload.attributes.map(
      (_, i) =>
        `attr-init-${i}-${payload.attributes[i]?.attrName?.slice(0, 8) ?? i}`
    );
  }, []);

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
        applyLoadedProduct(productRes.data);
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
    [productId, applyLoadedProduct]
  );

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  function updateForm(patch: Partial<ProductPayload>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function requestReload() {
    if (isDirty) {
      setReloadConfirmOpen(true);
      return;
    }
    void loadProduct(true);
  }

  function confirmReload() {
    setReloadConfirmOpen(false);
    void loadProduct(true);
  }

  async function loadCategoriesTree() {
    try {
      const res = await requestCategories<{
        success: true;
        data: CategoryNode[];
      }>('/tree');
      setCategories(res.data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to refresh categories.'
      );
    }
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setCreatingCategory(true);
    try {
      const res = await requestCategories<{
        success: true;
        data: { id: string; name: string; slug: string };
      }>('/', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      toast.success(`Category "${res.data.name}" created.`);
      setNewCategoryName('');
      setCreateCategoryOpen(false);
      await loadCategoriesTree();
      setForm((current) => {
        if (!current) return current;
        if (current.categoryIds.includes(res.data.id)) return current;
        return {
          ...current,
          categoryIds: [...current.categoryIds, res.data.id],
        };
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create category.'
      );
    } finally {
      setCreatingCategory(false);
    }
  }

  function handleAddTag() {
    const tag = tagInput.trim().replace(/\s+/g, ' ');
    if (!tag || !form) return;
    if (form.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setTagInput('');
      return;
    }
    if (form.tags.length >= 40) {
      toast.error('Maximum 40 tags allowed.');
      return;
    }
    updateForm({ tags: [...form.tags, tag] });
    setTagInput('');
  }

  function handleImageDragEnd(event: DragEndEvent) {
    if (!form) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = ensureImageIds(form.images.length);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextImages = arrayMove(form.images, oldIndex, newIndex).map(
      (img, i) => ({ ...img, position: i })
    );
    imageIdsRef.current = arrayMove(ids, oldIndex, newIndex);
    updateForm({ images: nextImages });
  }

  function handleAttributeDragEnd(event: DragEndEvent) {
    if (!form) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = ensureAttrIds(form.attributes.length);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextAttrs = arrayMove(form.attributes, oldIndex, newIndex).map(
      (attr, i) => ({ ...attr, position: i })
    );
    attrIdsRef.current = arrayMove(ids, oldIndex, newIndex);
    updateForm({ attributes: nextAttrs });
  }

  function validateForm(payload: ProductPayload) {
    if (!payload.name.trim()) return 'Product name is required.';
    if (!slugify(payload.name)) {
      return 'Product title must produce a valid URL slug.';
    }
    if (!payload.categoryIds.length) return 'Select at least one category.';
    if (!payload.skus.length) return 'Add at least one variant.';
    for (const [index, sku] of payload.skus.entries()) {
      if (sku.price < 0) return `Variant ${index + 1} has an invalid price.`;
      if (sku.stock < 0) return `Variant ${index + 1} has an invalid stock.`;
    }
    for (const [index, attribute] of payload.attributes.entries()) {
      if (!attribute.attrName.trim() || !attribute.attrValue.trim()) {
        return `Attribute ${index + 1} needs a name and value.`;
      }
    }
    for (const [index, image] of payload.images.entries()) {
      if (!image.url.trim()) return `Image ${index + 1} is missing a URL.`;
    }
    return null;
  }

  async function handleSave() {
    if (!form || !product) return;
    const validation = validateForm(form);
    if (validation) {
      toast.error(validation);
      setSaveConfirmOpen(false);
      return;
    }

    setSaving(true);
    try {
      const html = await markdownToHtml(mobileDetailMarkdown);
      const payload: ProductPayload = {
        ...form,
        // Slug always derived from title — never free-edited.
        slug: slugify(form.name),
        // Preserve AE identity & catalog position from the loaded product.
        isAEProduct: product.isAEProduct,
        aeProductId: product.aeProductId,
        aeCategoryId: product.aeCategoryId,
        aeRating: product.aeRating,
        aeReviewCount: product.aeReviewCount,
        aeSalesCount: product.aeSalesCount,
        aeStatus: product.aeStatus,
        position: product.position,
        description: nullable(form.description ?? ''),
        mobileDetail: html || null,
        sizeChartImage: nullable(form.sizeChartImage ?? ''),
        sizeChartDescription: nullable(form.sizeChartDescription ?? ''),
        mainVideo: nullable(form.mainVideo ?? ''),
        metaTitle: nullable(form.metaTitle ?? ''),
        metaDescription: nullable(form.metaDescription ?? ''),
        productNotes: nullable(form.productNotes ?? ''),
        images: form.images
          .map((image, index) => ({
            ...image,
            url: image.url.trim(),
            alt: image.alt.trim() || form.name.trim().slice(0, 120),
            position: index,
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
          position: index,
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

      baselineRef.current = serializeFormSnapshot(
        { ...payload, mobileDetail: html || null },
        mobileDetailMarkdown
      );
      setSaveConfirmOpen(false);
      toast.success(res.message || 'Product updated successfully.');
      router.push(`/product/view/${productId}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save product.'
      );
    } finally {
      setSaving(false);
    }
  }

  const imageIds = form ? ensureImageIds(form.images.length) : [];
  const attrIds = form ? ensureAttrIds(form.attributes.length) : [];

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
            {isDirty ? (
              <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                Unsaved changes
              </Badge>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={loading || refreshing || saving}
              onClick={requestReload}
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
              onClick={() => setSaveConfirmOpen(true)}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save changes
            </Button>
          </div>
        </div>

        {loading ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading editor…
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <ShieldAlert className="size-8 text-destructive" />
              <div>
                <p className="font-medium">Could not load product</p>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadProduct()}
              >
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
                  <p className="text-xs text-muted-foreground">Editing</p>
                  <h1 className="truncate text-xl font-semibold">
                    {product.name}
                  </h1>
                  {product.isAEProduct && product.aeProductId ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      AliExpress · {product.aeProductId}
                    </p>
                  ) : null}
                </div>
                <StepIndicator current={step} onJump={setStep} />
              </CardContent>
            </Card>

            {/* ── Step 0: Basics ── */}
            {step === 0 && (
              <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                <Card>
                  <CardContent className="space-y-4 p-4">
                    <h2 className="font-medium">Core details</h2>
                    <div className="grid gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="name">Product title</Label>
                        <Input
                          id="name"
                          value={form.name}
                          maxLength={300}
                          onChange={(e) =>
                            updateForm({ name: e.target.value })
                          }
                          placeholder="Clear, SEO-friendly product title"
                          className="text-base"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            URL slug (auto):{' '}
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                              /{derivedSlug || '…'}
                            </code>
                          </span>
                          <span>{form.name.length}/300</span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="description">Short description</Label>
                        <Textarea
                          id="description"
                          value={form.description ?? ''}
                          onChange={(e) =>
                            updateForm({ description: e.target.value })
                          }
                          rows={4}
                          placeholder="Write a clear product description…"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Product detail</Label>
                        <p className="text-xs text-muted-foreground">
                          Write in Markdown. Saved as HTML for the storefront.
                        </p>
                        <div data-color-mode="light" className="dark:hidden">
                          <MDEditor
                            value={mobileDetailMarkdown}
                            onChange={(val) =>
                              setMobileDetailMarkdown(val ?? '')
                            }
                            height={360}
                            preview="live"
                          />
                        </div>
                        <div
                          data-color-mode="dark"
                          className="hidden dark:block"
                        >
                          <MDEditor
                            value={mobileDetailMarkdown}
                            onChange={(val) =>
                              setMobileDetailMarkdown(val ?? '')
                            }
                            height={360}
                            preview="live"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center justify-between gap-4 sm:justify-start">
                        <div>
                          <p className="text-sm font-medium">Published</p>
                          <p className="text-xs text-muted-foreground">
                            Visible in the storefront when on
                          </p>
                        </div>
                        <Switch
                          checked={form.published}
                          onCheckedChange={(checked) =>
                            updateForm({ published: checked })
                          }
                          aria-label="Published"
                        />
                      </div>
                      <Separator
                        orientation="vertical"
                        className="hidden h-10 sm:block"
                      />
                      <div className="flex items-center justify-between gap-4 sm:justify-start">
                        <div>
                          <p className="text-sm font-medium">Featured</p>
                          <p className="text-xs text-muted-foreground">
                            Highlight on featured surfaces
                          </p>
                        </div>
                        <Switch
                          checked={form.featured}
                          onCheckedChange={(checked) =>
                            updateForm({ featured: checked })
                          }
                          aria-label="Featured"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  <Card>
                    <CardContent className="space-y-4 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h2 className="font-medium">Categories</h2>
                          <p className="text-xs text-muted-foreground">
                            A product can belong to multiple categories.
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => setCreateCategoryOpen(true)}
                        >
                          <FolderPlus className="size-3.5" />
                          New
                        </Button>
                      </div>

                      {form.categoryIds.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {form.categoryIds.map((id) => {
                            const cat = flatCategories.find((c) => c.id === id);
                            return (
                              <Badge
                                key={id}
                                variant="secondary"
                                className="gap-1 pr-1"
                              >
                                {cat?.label ?? id}
                                <button
                                  type="button"
                                  className="rounded-full p-0.5 hover:bg-muted"
                                  onClick={() =>
                                    updateForm({
                                      categoryIds: form.categoryIds.filter(
                                        (c) => c !== id
                                      ),
                                    })
                                  }
                                  aria-label={`Remove ${cat?.name ?? 'category'}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            );
                          })}
                        </div>
                      ) : null}

                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={categorySearch}
                          onChange={(e) => setCategorySearch(e.target.value)}
                          placeholder="Search categories…"
                          className="pl-9"
                        />
                      </div>

                      <div className="max-h-56 overflow-y-auto rounded-lg border">
                        {filteredCategories.length === 0 ? (
                          <div className="p-6 text-center text-sm text-muted-foreground">
                            No categories match your search.
                          </div>
                        ) : (
                          filteredCategories.map((cat) => {
                            const selected = form.categoryIds.includes(cat.id);
                            return (
                              <button
                                key={cat.id}
                                type="button"
                                onClick={() =>
                                  updateForm({
                                    categoryIds: selected
                                      ? form.categoryIds.filter(
                                          (id) => id !== cat.id
                                        )
                                      : [...form.categoryIds, cat.id],
                                  })
                                }
                                className={cn(
                                  'flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50',
                                  selected && 'bg-primary/5'
                                )}
                                style={{
                                  paddingLeft: `${12 + Math.max(0, cat.depth - 1) * 12}px`,
                                }}
                              >
                                <span className="truncate">{cat.label}</span>
                                {selected ? (
                                  <Check className="h-4 w-4 shrink-0 text-primary" />
                                ) : null}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="space-y-4 p-4">
                      <h2 className="font-medium">SEO & tags</h2>
                      <div className="space-y-1.5">
                        <Label htmlFor="metaTitle">
                          Meta title ({(form.metaTitle ?? '').length}/70)
                        </Label>
                        <Input
                          id="metaTitle"
                          value={form.metaTitle ?? ''}
                          maxLength={120}
                          onChange={(e) =>
                            updateForm({
                              metaTitle: e.target.value.slice(0, 120),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="metaDescription">
                          Meta description (
                          {(form.metaDescription ?? '').length}/160)
                        </Label>
                        <Textarea
                          id="metaDescription"
                          value={form.metaDescription ?? ''}
                          maxLength={320}
                          onChange={(e) =>
                            updateForm({
                              metaDescription: e.target.value.slice(0, 320),
                            })
                          }
                          rows={3}
                        />
                      </div>

                      <section className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Tag className="h-4 w-4 text-muted-foreground" />
                          <h3 className="text-sm font-semibold">Tags</h3>
                        </div>
                        {form.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {form.tags.map((tag) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="gap-1 pr-1"
                              >
                                {tag}
                                <button
                                  type="button"
                                  className="rounded-full p-0.5 hover:bg-muted"
                                  onClick={() =>
                                    updateForm({
                                      tags: form.tags.filter((t) => t !== tag),
                                    })
                                  }
                                  aria-label={`Remove tag ${tag}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex gap-2">
                          <Input
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            placeholder="Add a tag…"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ',') {
                                e.preventDefault();
                                handleAddTag();
                              }
                            }}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={handleAddTag}
                          >
                            Add
                          </Button>
                        </div>
                      </section>
                    </CardContent>
                  </Card>
                </div>
              </section>
            )}

            {/* ── Step 1: Media ── */}
            {step === 1 && (
              <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <Card>
                  <CardContent className="space-y-4 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="font-medium">
                          Images ({form.images.length})
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          Drag the grip to reorder. Add images from the linked
                          AliExpress product.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() =>
                          setMediaDialog({ open: true, mode: 'images' })
                        }
                        disabled={!product.aeProductId}
                      >
                        <Plus className="size-3.5" />
                        Add from AliExpress
                      </Button>
                    </div>

                    {!product.aeProductId ? (
                      <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                        This product is not linked to AliExpress, so new images
                        cannot be imported here.
                      </p>
                    ) : null}

                    {form.images.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-sm text-muted-foreground">
                        <ImageIcon className="size-6 opacity-50" />
                        No images yet.
                      </div>
                    ) : (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleImageDragEnd}
                      >
                        <SortableContext
                          items={imageIds}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="grid gap-3">
                            {form.images.map((image, index) => (
                              <SortableImageRow
                                key={imageIds[index]}
                                id={imageIds[index]!}
                                image={image}
                                index={index}
                                onAltChange={(alt) =>
                                  updateForm({
                                    images: form.images.map((img, i) =>
                                      i === index ? { ...img, alt } : img
                                    ),
                                  })
                                }
                                onRemove={() => {
                                  const next = form.images.filter(
                                    (_, i) => i !== index
                                  );
                                  imageIdsRef.current =
                                    imageIdsRef.current.filter(
                                      (_, i) => i !== index
                                    );
                                  updateForm({
                                    images: next.map((img, i) => ({
                                      ...img,
                                      position: i,
                                    })),
                                  });
                                }}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-4 p-4">
                    <h2 className="font-medium">Video & size chart</h2>

                    <div className="space-y-2">
                      <Label>Main video</Label>
                      {form.mainVideo ? (
                        <div className="rounded-lg border p-3">
                          <div className="flex items-start gap-2">
                            <Video className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <p className="min-w-0 flex-1 break-all text-xs text-muted-foreground">
                              {form.mainVideo}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No video selected.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!product.aeProductId}
                          onClick={() =>
                            setMediaDialog({ open: true, mode: 'video' })
                          }
                        >
                          {form.mainVideo ? 'Change video' : 'Select video'}
                        </Button>
                        {form.mainVideo ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => updateForm({ mainVideo: null })}
                          >
                            Clear
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Has size chart</p>
                        <p className="text-xs text-muted-foreground">
                          Enable if sizing info is available
                        </p>
                      </div>
                      <Switch
                        checked={form.hasSizeChart}
                        onCheckedChange={(checked) =>
                          updateForm({ hasSizeChart: checked })
                        }
                        aria-label="Has size chart"
                      />
                    </div>

                    {form.hasSizeChart ? (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label>Size chart image</Label>
                          {form.sizeChartImage ? (
                            <ProxiedImg
                              src={form.sizeChartImage}
                              alt="Size chart"
                              className="max-h-48 w-full rounded-md border object-contain bg-muted"
                            />
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              No size chart image selected.
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={!product.aeProductId}
                              onClick={() =>
                                setMediaDialog({
                                  open: true,
                                  mode: 'size-chart',
                                })
                              }
                            >
                              <ImageIcon className="mr-1.5 size-3.5" />
                              Select image
                            </Button>
                            {form.sizeChartImage ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  updateForm({ sizeChartImage: null })
                                }
                              >
                                Clear
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Size chart notes</Label>
                          <Textarea
                            rows={4}
                            value={form.sizeChartDescription ?? ''}
                            onChange={(e) =>
                              updateForm({
                                sizeChartDescription: e.target.value,
                              })
                            }
                            placeholder="Sizing notes…"
                          />
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </section>
            )}

            {/* ── Step 2: Variants ── */}
            {step === 2 && (
              <Card>
                <CardContent className="p-4">
                  <EditVariantsSection
                    skus={form.skus}
                    onUpdateSkus={(updater) => {
                      updateForm({ skus: updater(form.skus) });
                    }}
                  />
                </CardContent>
              </Card>
            )}

            {/* ── Step 3: Attributes ── */}
            {step === 3 && (
              <Card>
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="font-medium">Attributes</h2>
                      <p className="text-xs text-muted-foreground">
                        Drag to reorder. Position is saved automatically.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const next = [
                          ...form.attributes,
                          emptyAttribute(form.attributes.length),
                        ];
                        ensureAttrIds(next.length);
                        updateForm({ attributes: next });
                      }}
                      className="gap-1.5"
                    >
                      <Plus className="size-3.5" />
                      Attribute
                    </Button>
                  </div>

                  {form.attributes.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No attributes yet.
                    </p>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleAttributeDragEnd}
                    >
                      <SortableContext
                        items={attrIds}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="grid gap-3">
                          {form.attributes.map((attribute, index) => (
                            <SortableAttributeRow
                              key={attrIds[index]}
                              id={attrIds[index]!}
                              attribute={attribute}
                              onChange={(patch) =>
                                updateForm({
                                  attributes: form.attributes.map((item, i) =>
                                    i === index ? { ...item, ...patch } : item
                                  ),
                                })
                              }
                              onRemove={() => {
                                const next = form.attributes.filter(
                                  (_, i) => i !== index
                                );
                                attrIdsRef.current =
                                  attrIdsRef.current.filter(
                                    (_, i) => i !== index
                                  );
                                updateForm({
                                  attributes: next.map((item, i) => ({
                                    ...item,
                                    position: i,
                                  })),
                                });
                              }}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Step 4: Review ── */}
            {step === 4 && (
              <section className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardContent className="space-y-4 p-4">
                    <h2 className="font-medium">Review changes</h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Name</p>
                        <p className="font-medium">{form.name}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Slug</p>
                        <p className="font-medium">/{derivedSlug}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">
                          Categories
                        </p>
                        <p className="font-medium">
                          {form.categoryIds.length}
                        </p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Images</p>
                        <p className="font-medium">{form.images.length}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">
                          Variants
                        </p>
                        <p className="font-medium">{form.skus.length}</p>
                      </div>
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">
                          Lowest price
                        </p>
                        <p className="font-medium">
                          {form.skus.length
                            ? formatMoney(
                                Math.min(...form.skus.map((s) => s.price))
                              )
                            : '—'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-4 p-4">
                    <h2 className="font-medium">Publish state</h2>
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        variant={form.published ? 'default' : 'secondary'}
                      >
                        {form.published ? 'Published' : 'Draft'}
                      </Badge>
                      {form.featured ? (
                        <Badge variant="outline">Featured</Badge>
                      ) : null}
                      {product.isAEProduct ? (
                        <Badge variant="outline">AliExpress</Badge>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      disabled={saving || !meta?.canUpdate}
                      onClick={() => setSaveConfirmOpen(true)}
                      className="w-full gap-1.5"
                    >
                      {saving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <PackageCheck className="size-4" />
                      )}
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
                onClick={() => setStep((v) => Math.max(0, v - 1))}
                className="gap-1.5"
              >
                <ChevronLeft className="size-3.5" />
                Previous
              </Button>
              <Button
                type="button"
                disabled={step === STEPS.length - 1}
                onClick={() =>
                  setStep((v) => Math.min(STEPS.length - 1, v + 1))
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

      {/* Create category dialog */}
      <Dialog open={createCategoryOpen} onOpenChange={setCreateCategoryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create category</DialogTitle>
            <DialogDescription>
              Adds a new root category and selects it on this product.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="new-cat">Category name</Label>
            <Input
              id="new-cat"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="e.g. Fashion Accessories"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreateCategory();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateCategoryOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={creatingCategory || !newCategoryName.trim()}
              onClick={() => void handleCreateCategory()}
            >
              {creatingCategory ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <FolderPlus className="mr-2 size-4" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reload confirmation when dirty */}
      <Dialog open={reloadConfirmOpen} onOpenChange={setReloadConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              You have edited this product. Reloading will discard those changes
              and restore the last saved version from the server.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReloadConfirmOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmReload}
            >
              Discard & reload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save confirmation */}
      <Dialog open={saveConfirmOpen} onOpenChange={setSaveConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save product changes?</DialogTitle>
            <DialogDescription>
              This will update the live product record
              {form ? (
                <>
                  {' '}
                  for <strong>{form.name}</strong>
                </>
              ) : null}
              . Markdown detail will be converted to HTML before saving.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setSaveConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || !meta?.canUpdate}
              onClick={() => void handleSave()}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Confirm save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AE media picker */}
      {product ? (
        <AeMediaDialog
          open={mediaDialog.open}
          onOpenChange={(open) =>
            setMediaDialog((prev) => ({ ...prev, open }))
          }
          mode={mediaDialog.mode}
          aeProductId={product.aeProductId}
          productName={form?.name ?? product.name}
          existingImageUrls={form?.images.map((i) => i.url) ?? []}
          currentMainVideo={form?.mainVideo ?? null}
          currentSizeChartImage={form?.sizeChartImage ?? null}
          onAddImages={(images) => {
            if (!form) return;
            const existing = new Set(
              form.images.map((i) => imageDedupeKey(i.url))
            );
            const additions = images
              .filter((img) => !existing.has(imageDedupeKey(img.url)))
              .map((img, i) => ({
                url: img.url,
                alt: img.alt,
                position: form.images.length + i,
              }));
            if (!additions.length) return;
            const next = [...form.images, ...additions];
            ensureImageIds(next.length);
            updateForm({ images: next });
          }}
          onSelectVideo={(url) => {
            updateForm({
              mainVideo: url,
              videos: url
                ? [{ url, poster: null, alt: form?.name ?? '' }]
                : [],
            });
          }}
          onSelectSizeChart={(url) => {
            updateForm({
              sizeChartImage: url,
              hasSizeChart: Boolean(url) || form?.hasSizeChart,
            });
          }}
        />
      ) : null}
    </>
  );
}
