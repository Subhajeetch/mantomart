'use client';

import '@uiw/react-md-editor/markdown-editor.css';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  FolderPlus,
  ImageIcon,
  ImageOff,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Star,
  Tag,
  TrendingUp,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Textarea } from '@/components/ui/textarea';
import {
  FullscreenDialog,
  FullscreenDialogBody,
  FullscreenDialogContent,
  FullscreenDialogDescription,
  FullscreenDialogFooter,
  FullscreenDialogHeader,
  FullscreenDialogTitle,
} from '@/components/ui/fullscreen-dialog';
import { useSession } from '@/lib/auth-client';
import config from '@/mine.config';
import { cn } from '@/lib/utils';

import {
  fetchAliExpressProductDetail,
  type AliExpressProductDetailResponse,
} from './product-dialog';
import {
  applyTitleToImageAlts,
  buildInitialForm,
  buildPublishPayload,
  markdownToHtml,
  normalizeImportForm,
  validateStep,
  WIZARD_STEPS,
} from './import-wizard-utils';
import { ImportWizardVariants } from './import-wizard-variants';
import AiSeoSheet, { type AiSeoApplyPayload } from './ai-seo-sheet';
import KeywordResearchSheet from './keyword-research-sheet';
import ProductPreviewSheet from './product-preview-sheet';
import {
  getDraft,
  removeDraft,
  removeSavedProduct,
  slugify,
  upsertDraft,
  type ImportFormState,
  type ProductImportDraft,
  type SavedAliExpressProduct,
} from './storage';

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading editor…
    </div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────

type CategoryNode = {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  depth: number;
  children: CategoryNode[];
};

type ImportWizardProps = {
  open: boolean;
  listItem: SavedAliExpressProduct | null;
  /** When resuming a draft, pass it so we skip re-init from AE when possible. */
  resumeDraft?: ProductImportDraft | null;
  onOpenChange: (open: boolean) => void;
  onPublished: (listItemId: string) => void;
  onDraftSaved: () => void;
};

// ─── API helpers ──────────────────────────────────────────────────────────────

class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message);
    this.code = opts.code;
    this.status = opts.status ?? 500;
  }
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Unable to reach the server. Please try again.', {
      status: 0,
      code: 'NETWORK_ERROR',
    });
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      response.ok
        ? 'Server returned an invalid response.'
        : `Request failed with status ${response.status}.`,
      { status: response.status }
    );
  }

  const body = data as {
    success?: boolean;
    error?: string;
    message?: string;
    code?: string;
  };

  if (!response.ok || body.success === false) {
    throw new ApiError(
      body.error || body.message || `Request failed (${response.status}).`,
      { code: body.code, status: response.status }
    );
  }

  return data as T;
}

function flattenCategories(
  nodes: CategoryNode[],
  prefix = ''
): Array<{ id: string; label: string; depth: number; name: string }> {
  const result: Array<{
    id: string;
    label: string;
    depth: number;
    name: string;
  }> = [];
  for (const node of nodes) {
    const label = prefix ? `${prefix} › ${node.name}` : node.name;
    result.push({ id: node.id, label, depth: node.depth, name: node.name });
    if (node.children?.length) {
      result.push(...flattenCategories(node.children, label));
    }
  }
  return result;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({
  current,
  onJump,
}: {
  current: number;
  onJump: (step: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 sm:gap-2">
      {WIZARD_STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <button
            key={step.key}
            type="button"
            onClick={() => {
              if (index <= current) onJump(index);
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition sm:px-3 sm:text-sm',
              active && 'bg-primary text-primary-foreground',
              done &&
                !active &&
                'bg-primary/15 text-primary hover:bg-primary/25',
              !done && !active && 'bg-muted text-muted-foreground'
            )}
          >
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                active && 'bg-primary-foreground/20 text-primary-foreground',
                done && !active && 'bg-primary text-primary-foreground',
                !done && !active && 'bg-background'
              )}
            >
              {done ? <Check className="h-3 w-3" /> : index + 1}
            </span>
            <span className="hidden sm:inline">{step.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Google SERP preview ──────────────────────────────────────────────────────

function GooglePreview({
  title,
  description,
  slug,
}: {
  title: string;
  description: string;
  slug: string;
}) {
  const displayTitle = title.trim() || 'Product title';
  const displayDesc =
    description.trim() ||
    'Your meta description will appear here in Google search results.';
  const path = slug.trim() || 'product-slug';

  return (
    <Card className="overflow-hidden border bg-[#ddd] shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={config.logoShort}
              alt={config.brandName}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1 text-sm text-[#060607]">
              <span className="font-bold">{config.brandName}</span>
            </div>
            <p className="truncate text-xs text-[#4d5156]">
              https://ragimart.com › product › {path}
            </p>
            <h3 className="mt-1 line-clamp-2 text-lg font-bold leading-snug text-[#1a0dab]">
              {displayTitle}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm leading-5 text-[#4d5156]">
              {displayDesc}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export default function ImportWizard({
  open,
  listItem,
  resumeDraft = null,
  onOpenChange,
  onPublished,
  onDraftSaved,
}: ImportWizardProps) {
  const { data: session } = useSession();
  const adminUser = session?.user;

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ImportFormState | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  // Categories
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const [categorySearch, setCategorySearch] = useState('');
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  // Tags input
  const [tagInput, setTagInput] = useState('');

  // Attributes
  const [attributeSearch, setAttributeSearch] = useState('');

  // Size chart image picker (regular dialog)
  const [sizeChartPickerOpen, setSizeChartPickerOpen] = useState(false);
  const [sizeChartPickerSelection, setSizeChartPickerSelection] = useState<
    string | null
  >(null);

  // Google Keyword Planner research
  const [keywordResearchOpen, setKeywordResearchOpen] = useState(false);

  // AI SEO generator (Gemini)
  const [aiSeoOpen, setAiSeoOpen] = useState(false);

  // AliExpress product preview sheet
  const [productPreviewOpen, setProductPreviewOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listItemId = listItem?.id ?? resumeDraft?.listItemId ?? null;

  const flatCategories = useMemo(
    () => flattenCategories(categoryTree),
    [categoryTree]
  );

  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return flatCategories;
    return flatCategories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
    );
  }, [flatCategories, categorySearch]);

  const filteredAttributes = useMemo(() => {
    if (!form) return [];
    const q = attributeSearch.trim().toLowerCase();
    return form.attributes
      .map((attr, index) => ({ attr, index }))
      .filter(({ attr }) => {
        if (!q) return true;
        return (
          attr.attrName.toLowerCase().includes(q) ||
          attr.attrValue.toLowerCase().includes(q) ||
          (attr.attrValueUnit ?? '').toLowerCase().includes(q)
        );
      });
  }, [form, attributeSearch]);

  const updateForm = useCallback(
    (updater: (prev: ImportFormState) => ImportFormState) => {
      setForm((prev) => {
        if (!prev) return prev;
        return updater(prev);
      });
    },
    []
  );

  // Auto-save draft
  useEffect(() => {
    if (!open || !form || !listItemId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const now = new Date();
      const draft: ProductImportDraft = {
        schemaVersion: 1,
        listItemId,
        aeProductId: form.aeProductId,
        updatedAt: now.toISOString(),
        updatedAtMs: now.getTime(),
        currentStep: step,
        titleSnapshot:
          form.name.trim() || listItem?.normalized.title || 'Untitled draft',
        imageSnapshot:
          form.productImages.find((i) => i.selected !== false)?.url ??
          listItem?.normalized.imageUrl ??
          null,
        form,
      };
      upsertDraft(draft);
      onDraftSaved();
    }, 600);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [form, step, open, listItemId, listItem, onDraftSaved]);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    try {
      const res = await requestJson<{
        success: true;
        data: CategoryNode[];
      }>('/api/categories/tree');
      setCategoryTree(res.data ?? []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load categories.'
      );
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  const initWizard = useCallback(async () => {
    if (!listItem && !resumeDraft) return;

    setDetailError(null);
    setStepError(null);

    // Resume from draft without re-fetch when form is complete
    if (resumeDraft?.form) {
      setForm(normalizeImportForm(resumeDraft.form));
      setStep(resumeDraft.currentStep ?? 0);
      void loadCategories();
      return;
    }

    // Check local draft first
    if (listItem) {
      const existing = getDraft(listItem.id);
      if (existing?.form) {
        setForm(normalizeImportForm(existing.form));
        setStep(existing.currentStep ?? 0);
        void loadCategories();
        return;
      }
    }

    if (!listItem) return;

    setLoadingDetail(true);
    setForm(null);
    setStep(0);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let detail: AliExpressProductDetailResponse | null = null;
      const productId = listItem.normalized.itemId || listItem.id;
      if (productId) {
        detail = await fetchAliExpressProductDetail(productId, {
          signal: controller.signal,
        });
      }
      const initial = buildInitialForm(listItem, detail);
      setForm(normalizeImportForm(initial));
      void loadCategories();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setDetailError(
        err instanceof Error ? err.message : 'Failed to load product details.'
      );
      // Still allow editing with search-card data
      if (listItem) {
        setForm(normalizeImportForm(buildInitialForm(listItem, null)));
        void loadCategories();
      }
    } finally {
      setLoadingDetail(false);
    }
  }, [listItem, resumeDraft, loadCategories]);

  useEffect(() => {
    if (open) {
      void initWizard();
    } else {
      abortRef.current?.abort();
      setForm(null);
      setStep(0);
      setDetailError(null);
      setStepError(null);
      setPublishing(false);
      setCategorySearch('');
      setNewCategoryName('');
      setTagInput('');
      setAttributeSearch('');
      setSizeChartPickerOpen(false);
      setSizeChartPickerSelection(null);
      setKeywordResearchOpen(false);
      setAiSeoOpen(false);
      setProductPreviewOpen(false);
      // Extra body-scroll unlock when dialog unmounts / closes
      if (typeof document !== 'undefined') {
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('pointer-events');
        document.body.style.removeProperty('padding-right');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listItemId]);

  const goToStep = (nextStep: number) => {
    if (!form) {
      setStep(nextStep);
      return;
    }

    // When entering variants step, stamp step-1 title onto image alt texts
    if (nextStep === 1) {
      setForm((prev) => (prev ? applyTitleToImageAlts(prev) : prev));
    }

    setStepError(null);
    setStep(nextStep);
  };

  const handleNext = () => {
    if (!form) return;
    const err = validateStep(step, form);
    if (err) {
      setStepError(err);
      return;
    }
    goToStep(Math.min(step + 1, WIZARD_STEPS.length - 1));
  };

  const handleBack = () => {
    goToStep(Math.max(step - 1, 0));
  };

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setCreatingCategory(true);
    try {
      const res = await requestJson<{
        success: true;
        data: { id: string; name: string; slug: string };
      }>('/api/categories', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      toast.success(`Category "${res.data.name}" created.`);
      setNewCategoryName('');
      await loadCategories();
      updateForm((prev) => ({
        ...prev,
        categoryIds: prev.categoryIds.includes(res.data.id)
          ? prev.categoryIds
          : [...prev.categoryIds, res.data.id],
      }));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create category.'
      );
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleAddTag = () => {
    const tag = tagInput.trim().replace(/\s+/g, ' ');
    if (!tag) return;
    updateForm((prev) => {
      if (prev.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        return prev;
      }
      if (prev.tags.length >= 40) return prev;
      return { ...prev, tags: [...prev.tags, tag] };
    });
    setTagInput('');
  };

  /** Apply fields generated by the AI SEO sheet into the import form. */
  const handleAiSeoApply = useCallback(
    (payload: AiSeoApplyPayload) => {
      updateForm((prev) => {
        const next = { ...prev };

        if (typeof payload.name === 'string' && payload.name.trim()) {
          next.name = payload.name.trim().slice(0, 300);
        }

        if (typeof payload.description === 'string') {
          next.description = payload.description;
        }

        if (typeof payload.mobileDetailMarkdown === 'string') {
          next.mobileDetailMarkdown = payload.mobileDetailMarkdown;
        }

        if (typeof payload.metaTitle === 'string' && payload.metaTitle.trim()) {
          next.metaTitle = payload.metaTitle.trim().slice(0, 120);
        }

        if (
          typeof payload.metaDescription === 'string' &&
          payload.metaDescription.trim()
        ) {
          next.metaDescription = payload.metaDescription.trim().slice(0, 320);
        }

        if (Array.isArray(payload.tags)) {
          const seen = new Set<string>();
          const merged: string[] = [];
          for (const t of payload.tags) {
            if (typeof t !== 'string') continue;
            const tag = t.trim().replace(/\s+/g, ' ');
            if (!tag) continue;
            const key = tag.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(tag.slice(0, 60));
            if (merged.length >= 40) break;
          }
          next.tags = merged;
        }

        return next;
      });
    },
    [updateForm]
  );

  const handleAddAttribute = () => {
    updateForm((prev) => {
      if (prev.attributes.length >= 100) return prev;
      return {
        ...prev,
        attributes: [
          ...prev.attributes,
          {
            aeAttrNameId: null,
            attrName: '',
            aeAttrValueId: null,
            attrValue: '',
            attrValueUnit: null,
            position: prev.attributes.length,
            selected: true,
          },
        ],
      };
    });
  };

  const handlePublish = async () => {
    if (!form || !listItemId) return;

    for (let s = 0; s <= 4; s++) {
      const err = validateStep(s, form);
      if (err) {
        setStep(s);
        setStepError(err);
        return;
      }
    }

    setPublishing(true);
    setStepError(null);

    try {
      const payload = buildPublishPayload(form);
      // Prefer HTML conversion client-side for richer markdown
      const html = await markdownToHtml(form.mobileDetailMarkdown);
      const body = {
        ...payload,
        mobileDetail: html || null,
      };

      const res = await requestJson<{
        success: true;
        message: string;
        data: { id: string; slug: string; name: string };
      }>('/api/products/mylist', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      removeDraft(listItemId);
      removeSavedProduct(listItemId);
      onPublished(listItemId);
      onOpenChange(false);
      toast.success(res.message || `Product "${res.data.name}" published.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to publish product.';
      setStepError(message);
      toast.error(message);
    } finally {
      setPublishing(false);
    }
  };

  const selectedSkuCount =
    form?.skus.filter((s) => s.selected && s.stock > 0).length ?? 0;
  const selectedImageCount =
    form?.productImages.filter((i) => i.selected !== false).length ?? 0;
  const selectedAttributeCount = form
    ? normalizeImportForm(form).attributes.filter(
        (attr) =>
          attr.selected !== false &&
          attr.attrName.trim() &&
          attr.attrValue.trim()
      ).length
    : 0;

  const aePrice =
    listItem?.normalized.displayPrice ||
    (listItem?.normalized.targetSalePrice
      ? `$${listItem.normalized.targetSalePrice}`
      : null);
  const aeRating = form?.aeRating ?? listItem?.normalized.rating ?? null;
  const aeSales = form?.aeSalesCount || listItem?.normalized.orders || null;

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen && typeof document !== 'undefined') {
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('pointer-events');
      document.body.style.removeProperty('padding-right');
    }
    onOpenChange(nextOpen);
  };

  const openSizeChartPicker = () => {
    setSizeChartPickerSelection(form?.sizeChartImage ?? null);
    setSizeChartPickerOpen(true);
  };

  const confirmSizeChartSelection = () => {
    updateForm((prev) => ({
      ...prev,
      sizeChartImage: sizeChartPickerSelection,
      hasSizeChart: true,
    }));
    setSizeChartPickerOpen(false);
  };

  return (
    <>
      <FullscreenDialog open={open} onOpenChange={handleClose}>
        <FullscreenDialogContent showCloseButton={!publishing}>
          <FullscreenDialogHeader>
            <div className="flex flex-col gap-3 pr-10">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <FullscreenDialogTitle className="line-clamp-2">
                    {form?.name.trim() ? (
                      <>
                        Import product
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          — {form.name}
                        </span>
                      </>
                    ) : (
                      <>
                        Import product
                        {listItem?.normalized.title ? (
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            — {listItem.normalized.title}
                          </span>
                        ) : null}
                      </>
                    )}
                  </FullscreenDialogTitle>
                  <FullscreenDialogDescription className="sr-only">
                    Edit details in steps, then publish to your catalog.
                    Progress is saved as a draft automatically.
                  </FullscreenDialogDescription>
                  {/* AliExpress source stats */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:text-sm">
                    {aePrice ? (
                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                        <DollarSign className="h-3.5 w-3.5 text-primary" />
                        {aePrice}
                      </span>
                    ) : null}
                    {aeRating != null && aeRating > 0 ? (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                        {aeRating.toFixed(1)}
                        {form?.aeReviewCount != null ? (
                          <span className="text-muted-foreground">
                            ({form.aeReviewCount.toLocaleString()})
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    {aeSales ? (
                      <span className="inline-flex items-center gap-1">
                        <ShoppingCart className="h-3.5 w-3.5" />
                        {aeSales} sold
                      </span>
                    ) : null}
                    {listItem?.normalized.discount ? (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                        {listItem.normalized.discount}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 self-start flex items-center gap-2"
                    onClick={() => setProductPreviewOpen(true)}
                    disabled={publishing}
                  >
                    <Image
                      src="/icons/aliexpress_logo.webp"
                      alt="Search Icon"
                      width={14}
                      height={14}
                    />
                    Product
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 self-start"
                    onClick={() => setKeywordResearchOpen(true)}
                    disabled={publishing}
                  >
                    <TrendingUp className="mr-1.5 h-3.5 w-3.5" />
                    Keyword
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 self-start"
                    onClick={() => setAiSeoOpen(true)}
                    disabled={publishing}
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    AI SEO
                  </Button>
                </div>
              </div>
              <StepIndicator current={step} onJump={goToStep} />
            </div>
          </FullscreenDialogHeader>

          <FullscreenDialogBody className="px-4 py-4 sm:px-6 sm:py-6">
            {loadingDetail ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">
                  Loading full AliExpress product details…
                </p>
              </div>
            ) : null}

            {detailError && form ? (
              <Alert className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Partial data loaded</AlertTitle>
                <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>{detailError}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void initWizard()}
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {detailError && !form && !loadingDetail ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Could not load product</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{detailError}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void initWizard()}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {form && !loadingDetail ? (
              <div className="mx-auto max-w-5xl space-y-6">
                {/* ── Step 0: Title & Description ── */}
                {step === 0 ? (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="product-name">Product title</Label>
                      <Input
                        id="product-name"
                        value={form.name}
                        onChange={(e) => {
                          const name = e.target.value;
                          updateForm((prev) => ({
                            ...prev,
                            name,
                          }));
                        }}
                        maxLength={300}
                        placeholder="Write a clear, SEO-friendly product title"
                        className="text-base"
                      />
                      <p className="text-xs text-muted-foreground">
                        {form.name.length}/300
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="product-description">Description</Label>
                      <Textarea
                        id="product-description"
                        value={form.description}
                        onChange={(e) =>
                          updateForm((prev) => ({
                            ...prev,
                            description: e.target.value,
                          }))
                        }
                        rows={6}
                        placeholder="Write your product description from scratch…"
                        className="min-h-[140px] font-mono text-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Mobile description</Label>
                      <p className="text-xs text-muted-foreground">
                        Starts blank — write in Markdown. On publish this is
                        stored as HTML for the storefront.
                      </p>
                      <div data-color-mode="light" className="dark:hidden">
                        <MDEditor
                          value={form.mobileDetailMarkdown}
                          onChange={(val) =>
                            updateForm((prev) => ({
                              ...prev,
                              mobileDetailMarkdown: val ?? '',
                            }))
                          }
                          height={360}
                          preview="live"
                        />
                      </div>
                      <div data-color-mode="dark" className="hidden dark:block">
                        <MDEditor
                          value={form.mobileDetailMarkdown}
                          onChange={(val) =>
                            updateForm((prev) => ({
                              ...prev,
                              mobileDetailMarkdown: val ?? '',
                            }))
                          }
                          height={360}
                          preview="live"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* ── Step 1: Variants & Images ── */}
                {step === 1 ? (
                  <div className="space-y-6">
                    <section className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold">
                            Product images ({selectedImageCount} selected)
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            Gallery, variant, video posters, and
                            detail/description images from AliExpress. Toggle
                            and set alt text for SEO.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateForm((prev) => ({
                                ...prev,
                                productImages: prev.productImages.map(
                                  (img) => ({
                                    ...img,
                                    selected: true,
                                  })
                                ),
                              }))
                            }
                          >
                            Select all
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateForm((prev) => ({
                                ...prev,
                                productImages: prev.productImages.map(
                                  (img) => ({
                                    ...img,
                                    selected: false,
                                  })
                                ),
                              }))
                            }
                          >
                            Clear
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {form.productImages.map((img, index) => {
                          const selected = img.selected !== false;
                          return (
                            <Card
                              key={`${img.url}-${index}`}
                              className={cn(
                                'overflow-hidden transition p-0',
                                selected
                                  ? 'border-primary ring-1 ring-primary/30'
                                  : 'opacity-70'
                              )}
                            >
                              <div className="relative aspect-square bg-muted">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={img.url}
                                  alt={img.alt || form.name}
                                  className="h-full w-full object-contain"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateForm((prev) => ({
                                      ...prev,
                                      productImages: prev.productImages.map(
                                        (p, i) =>
                                          i === index
                                            ? {
                                                ...p,
                                                selected: p.selected === false,
                                              }
                                            : p
                                      ),
                                    }))
                                  }
                                  className={cn(
                                    'absolute right-2 top-2 rounded-full p-1.5 shadow',
                                    selected
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-background text-muted-foreground'
                                  )}
                                >
                                  {selected ? (
                                    <Check className="h-3.5 w-3.5" />
                                  ) : (
                                    <Plus className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                              <CardContent className="space-y-2 p-3">
                                <Label className="text-xs">Alt text</Label>
                                <Input
                                  value={img.alt}
                                  onChange={(e) =>
                                    updateForm((prev) => ({
                                      ...prev,
                                      productImages: prev.productImages.map(
                                        (p, i) =>
                                          i === index
                                            ? { ...p, alt: e.target.value }
                                            : p
                                      ),
                                    }))
                                  }
                                  placeholder="Describe the image for SEO"
                                  className="h-8 text-xs"
                                />
                              </CardContent>
                            </Card>
                          );
                        })}
                        {form.productImages.length === 0 ? (
                          <div className="col-span-full flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                            <ImageOff className="mr-2 h-4 w-4" />
                            No images available from AliExpress
                          </div>
                        ) : null}
                      </div>
                    </section>

                    <ImportWizardVariants
                      skus={form.skus}
                      selectedSkuCount={selectedSkuCount}
                      onUpdateSkus={(updater) =>
                        updateForm((prev) => ({
                          ...prev,
                          skus: updater(prev.skus),
                        }))
                      }
                    />

                    {form.videos.length > 0 ? (
                      <section className="space-y-2">
                        <h3 className="text-sm font-semibold">
                          Videos ({form.videos.length})
                        </h3>
                        <div className="grid gap-3 md:grid-cols-2">
                          {form.videos.map((video) => (
                            <video
                              key={video.url}
                              controls
                              preload="metadata"
                              poster={video.poster ?? undefined}
                              className="max-h-56 w-full rounded-lg border bg-muted"
                            >
                              <source src={video.url} />
                            </video>
                          ))}
                        </div>
                      </section>
                    ) : null}
                  </div>
                ) : null}

                {/* ── Step 2: Product Attributes ── */}
                {step === 2 ? (
                  <div className="space-y-5">
                    <section className="space-y-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold">
                            Product attributes ({selectedAttributeCount}{' '}
                            selected)
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            Choose AliExpress specs to publish, edit them, or
                            add your own product attributes.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateForm((prev) => ({
                                ...prev,
                                attributes: prev.attributes.map((attr) => ({
                                  ...attr,
                                  selected: true,
                                })),
                              }))
                            }
                            disabled={form.attributes.length === 0}
                          >
                            Select all
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateForm((prev) => ({
                                ...prev,
                                attributes: prev.attributes.map((attr) => ({
                                  ...attr,
                                  selected: false,
                                })),
                              }))
                            }
                            disabled={form.attributes.length === 0}
                          >
                            Clear
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={handleAddAttribute}
                            disabled={form.attributes.length >= 100}
                          >
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Add attribute
                          </Button>
                        </div>
                      </div>

                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={attributeSearch}
                          onChange={(e) => setAttributeSearch(e.target.value)}
                          placeholder="Search attributes..."
                          className="pl-9"
                        />
                      </div>

                      <div className="space-y-2">
                        {filteredAttributes.map(({ attr, index }) => {
                          const selected = attr.selected !== false;
                          const isAliExpressAttribute = Boolean(
                            attr.aeAttrNameId || attr.aeAttrValueId
                          );

                          return (
                            <Card
                              key={`${attr.aeAttrNameId ?? 'manual'}-${attr.aeAttrValueId ?? index}-${index}`}
                              className={cn(
                                'transition',
                                selected ? 'border-primary/50' : 'opacity-60'
                              )}
                            >
                              <CardContent className="space-y-3 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex min-w-0 items-start gap-3">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateForm((prev) => ({
                                          ...prev,
                                          attributes: prev.attributes.map(
                                            (item, i) =>
                                              i === index
                                                ? {
                                                    ...item,
                                                    selected:
                                                      item.selected === false,
                                                  }
                                                : item
                                          ),
                                        }))
                                      }
                                      className={cn(
                                        'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                                        selected
                                          ? 'border-primary bg-primary text-primary-foreground'
                                          : 'border-muted-foreground/40'
                                      )}
                                      aria-label={
                                        selected
                                          ? 'Unselect attribute'
                                          : 'Select attribute'
                                      }
                                    >
                                      {selected ? (
                                        <Check className="h-3 w-3" />
                                      ) : null}
                                    </button>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="truncate text-sm font-medium">
                                          {attr.attrName || 'New attribute'}
                                        </p>
                                        <Badge
                                          variant="outline"
                                          className="text-[10px]"
                                        >
                                          {isAliExpressAttribute
                                            ? 'AliExpress'
                                            : 'Manual'}
                                        </Badge>
                                      </div>
                                      {attr.attrValue ? (
                                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                                          {attr.attrValue}
                                          {attr.attrValueUnit
                                            ? ` ${attr.attrValueUnit}`
                                            : ''}
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      updateForm((prev) => ({
                                        ...prev,
                                        attributes: prev.attributes.filter(
                                          (_item, i) => i !== index
                                        ),
                                      }))
                                    }
                                    aria-label="Remove attribute"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>

                                <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_0.6fr]">
                                  <div className="space-y-1">
                                    <Label className="text-xs">Name</Label>
                                    <Input
                                      value={attr.attrName}
                                      maxLength={120}
                                      onChange={(e) =>
                                        updateForm((prev) => ({
                                          ...prev,
                                          attributes: prev.attributes.map(
                                            (item, i) =>
                                              i === index
                                                ? {
                                                    ...item,
                                                    attrName: e.target.value,
                                                  }
                                                : item
                                          ),
                                        }))
                                      }
                                      placeholder="Material"
                                      className="h-8"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Value</Label>
                                    <Input
                                      value={attr.attrValue}
                                      maxLength={500}
                                      onChange={(e) =>
                                        updateForm((prev) => ({
                                          ...prev,
                                          attributes: prev.attributes.map(
                                            (item, i) =>
                                              i === index
                                                ? {
                                                    ...item,
                                                    attrValue: e.target.value,
                                                  }
                                                : item
                                          ),
                                        }))
                                      }
                                      placeholder="Cotton"
                                      className="h-8"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Unit</Label>
                                    <Input
                                      value={attr.attrValueUnit ?? ''}
                                      maxLength={40}
                                      onChange={(e) =>
                                        updateForm((prev) => ({
                                          ...prev,
                                          attributes: prev.attributes.map(
                                            (item, i) =>
                                              i === index
                                                ? {
                                                    ...item,
                                                    attrValueUnit:
                                                      e.target.value || null,
                                                  }
                                                : item
                                          ),
                                        }))
                                      }
                                      placeholder="Optional"
                                      className="h-8"
                                    />
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}

                        {form.attributes.length === 0 ? (
                          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                            No product attributes parsed. Add your own
                            attributes if needed.
                          </div>
                        ) : null}

                        {form.attributes.length > 0 &&
                        filteredAttributes.length === 0 ? (
                          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                            No attributes match your search.
                          </div>
                        ) : null}
                      </div>
                    </section>
                  </div>
                ) : null}

                {/* ── Step 3: Categories & Size chart ── */}
                {step === 3 ? (
                  <div className="space-y-6">
                    <section className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold">Categories</h3>
                        <p className="text-xs text-muted-foreground">
                          A product can belong to multiple categories. Search or
                          create one if it does not exist.
                        </p>
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
                                    updateForm((prev) => ({
                                      ...prev,
                                      categoryIds: prev.categoryIds.filter(
                                        (c) => c !== id
                                      ),
                                    }))
                                  }
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
                        {categoriesLoading ? (
                          <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading categories…
                          </div>
                        ) : filteredCategories.length === 0 ? (
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
                                  updateForm((prev) => ({
                                    ...prev,
                                    categoryIds: selected
                                      ? prev.categoryIds.filter(
                                          (id) => id !== cat.id
                                        )
                                      : [...prev.categoryIds, cat.id],
                                  }))
                                }
                                className={cn(
                                  'flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50',
                                  selected && 'bg-primary/5'
                                )}
                                style={{
                                  paddingLeft: `${12 + (cat.depth - 1) * 12}px`,
                                }}
                              >
                                <span>{cat.label}</span>
                                {selected ? (
                                  <Check className="h-4 w-4 text-primary" />
                                ) : null}
                              </button>
                            );
                          })
                        )}
                      </div>

                      <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-end">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Create new category</Label>
                          <Input
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            placeholder="e.g. Fashion Accessories"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleCreateCategory();
                              }
                            }}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={creatingCategory || !newCategoryName.trim()}
                          onClick={() => void handleCreateCategory()}
                        >
                          {creatingCategory ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <FolderPlus className="mr-2 h-4 w-4" />
                          )}
                          Create
                        </Button>
                      </div>
                    </section>

                    <section className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold">Size chart</h3>
                        <p className="text-xs text-muted-foreground">
                          Optional. Use if AliExpress provides sizing info, or
                          leave empty.
                        </p>
                      </div>

                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.hasSizeChart}
                          onChange={(e) =>
                            updateForm((prev) => ({
                              ...prev,
                              hasSizeChart: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border"
                        />
                        This product has a size chart
                      </label>

                      {form.hasSizeChart ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label className="text-xs">Size chart image</Label>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={openSizeChartPicker}
                                disabled={form.productImages.length === 0}
                              >
                                <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
                                Select image
                              </Button>
                              {form.sizeChartImage ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    updateForm((prev) => ({
                                      ...prev,
                                      sizeChartImage: null,
                                    }))
                                  }
                                >
                                  Clear
                                </Button>
                              ) : null}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Pick from AliExpress product images (detail images
                              often include size charts), or paste a URL below.
                            </p>
                            <Input
                              value={form.sizeChartImage ?? ''}
                              onChange={(e) =>
                                updateForm((prev) => ({
                                  ...prev,
                                  sizeChartImage: e.target.value.trim() || null,
                                }))
                              }
                              placeholder="Or paste image URL…"
                              className="text-xs"
                            />
                            {form.sizeChartImage ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={form.sizeChartImage}
                                alt="Size chart preview"
                                className="mt-1 max-h-48 w-full rounded-md border object-contain bg-muted"
                              />
                            ) : null}
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              Size chart description
                            </Label>
                            <Textarea
                              value={form.sizeChartDescription ?? ''}
                              onChange={(e) =>
                                updateForm((prev) => ({
                                  ...prev,
                                  sizeChartDescription:
                                    e.target.value.trim() || null,
                                }))
                              }
                              rows={5}
                              placeholder="Sizing notes…"
                            />
                          </div>
                        </div>
                      ) : null}
                    </section>
                  </div>
                ) : null}

                {/* ── Step 4: SEO & Tags ── */}
                {step === 4 ? (
                  <div className="space-y-6">
                    <GooglePreview
                      title={form.metaTitle}
                      description={form.metaDescription}
                      slug={slugify(form.name)}
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="meta-title">
                          Meta title ({form.metaTitle.length}/70 recommended)
                        </Label>
                        <Input
                          id="meta-title"
                          value={form.metaTitle}
                          onChange={(e) =>
                            updateForm((prev) => ({
                              ...prev,
                              metaTitle: e.target.value.slice(0, 120),
                            }))
                          }
                          maxLength={120}
                        />
                      </div>

                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="meta-desc">
                          Meta description ({form.metaDescription.length}/160
                          recommended)
                        </Label>
                        <Textarea
                          id="meta-desc"
                          value={form.metaDescription}
                          onChange={(e) =>
                            updateForm((prev) => ({
                              ...prev,
                              metaDescription: e.target.value.slice(0, 320),
                            }))
                          }
                          rows={3}
                          maxLength={320}
                        />
                      </div>
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
                                  updateForm((prev) => ({
                                    ...prev,
                                    tags: prev.tags.filter((t) => t !== tag),
                                  }))
                                }
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
                  </div>
                ) : null}

                {/* ── Step 5: Publish ── */}
                {step === 5 ? (
                  <div className="space-y-5">
                    <Card>
                      <CardContent className="space-y-4 p-4 sm:p-5">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <PackageCheck className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="font-semibold">Ready to publish</h3>
                            <p className="text-sm text-muted-foreground">
                              Review the summary, add optional notes, then
                              publish. The product will be removed from your
                              list and drafts.
                            </p>
                          </div>
                        </div>

                        <dl className="grid gap-2 text-sm sm:grid-cols-2">
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <dt className="text-xs text-muted-foreground">
                              Title
                            </dt>
                            <dd className="font-medium">{form.name}</dd>
                          </div>
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <dt className="text-xs text-muted-foreground">
                              Variants
                            </dt>
                            <dd className="font-medium">{selectedSkuCount}</dd>
                          </div>
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <dt className="text-xs text-muted-foreground">
                              Images
                            </dt>
                            <dd className="font-medium">
                              {selectedImageCount}
                            </dd>
                          </div>
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <dt className="text-xs text-muted-foreground">
                              Attributes
                            </dt>
                            <dd className="font-medium">
                              {selectedAttributeCount}
                            </dd>
                          </div>
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <dt className="text-xs text-muted-foreground">
                              Categories
                            </dt>
                            <dd className="font-medium">
                              {form.categoryIds.length}
                            </dd>
                          </div>
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <dt className="text-xs text-muted-foreground">
                              AE Product ID
                            </dt>
                            <dd className="font-mono text-xs">
                              {form.aeProductId}
                            </dd>
                          </div>
                        </dl>

                        <div className="rounded-lg border p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Added by
                          </p>
                          <div className="mt-2 flex items-center gap-3">
                            {adminUser?.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={adminUser.image}
                                alt=""
                                className="h-9 w-9 rounded-full object-cover"
                              />
                            ) : (
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                                {(adminUser?.name || 'A')
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-medium">
                                {adminUser?.name || 'Current admin'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {adminUser?.email || 'Signed-in admin account'}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="product-notes">
                            Product notes (optional, internal)
                          </Label>
                          <Textarea
                            id="product-notes"
                            value={form.productNotes}
                            onChange={(e) =>
                              updateForm((prev) => ({
                                ...prev,
                                productNotes: e.target.value,
                              }))
                            }
                            rows={3}
                            placeholder="Notes for other admins…"
                          />
                        </div>

                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={form.featured}
                            onChange={(e) =>
                              updateForm((prev) => ({
                                ...prev,
                                featured: e.target.checked,
                              }))
                            }
                            className="h-4 w-4 rounded border"
                          />
                          Mark as featured
                        </label>
                      </CardContent>
                    </Card>
                  </div>
                ) : null}

                {stepError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Cannot continue</AlertTitle>
                    <AlertDescription>{stepError}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : null}
          </FullscreenDialogBody>

          <FullscreenDialogFooter>
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={publishing}
              >
                Close
              </Button>

              <div className="flex items-center gap-2">
                {step > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleBack}
                    disabled={publishing || loadingDetail}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                ) : null}

                {step < WIZARD_STEPS.length - 1 ? (
                  <Button
                    type="button"
                    onClick={handleNext}
                    disabled={!form || loadingDetail || publishing}
                  >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => void handlePublish()}
                    disabled={!form || publishing || loadingDetail}
                    className="min-w-[140px]"
                  >
                    {publishing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Publishing…
                      </>
                    ) : (
                      <>
                        <PackageCheck className="mr-2 h-4 w-4" />
                        Publish product
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </FullscreenDialogFooter>
        </FullscreenDialogContent>
      </FullscreenDialog>

      {/* Size chart image picker — normal dialog over the fullscreen wizard */}
      <Dialog
        open={sizeChartPickerOpen}
        onOpenChange={(next) => {
          setSizeChartPickerOpen(next);
          if (!next) setSizeChartPickerSelection(null);
        }}
      >
        <DialogContent
          className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
          style={{ maxWidth: 'min(96vw, 42rem)' }}
        >
          <DialogHeader className="border-b px-4 py-3 sm:px-5">
            <DialogTitle>Select size chart image</DialogTitle>
            <DialogDescription>
              Choose an image from this AliExpress product. Detail images often
              include size charts — look for measurement tables.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {form && form.productImages.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {form.productImages.map((img, index) => {
                  const isSelected = sizeChartPickerSelection === img.url;
                  return (
                    <button
                      key={`size-chart-pick-${img.url}-${index}`}
                      type="button"
                      onClick={() => setSizeChartPickerSelection(img.url)}
                      className={cn(
                        'group relative aspect-square overflow-hidden rounded-lg border-2 bg-muted transition',
                        isSelected
                          ? 'border-primary ring-2 ring-primary/30'
                          : 'border-transparent hover:border-primary/40'
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={img.alt || `Product image ${index + 1}`}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                      {isSelected ? (
                        <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <ImageOff className="h-8 w-8" />
                No product images available to pick from.
              </div>
            )}
          </div>

          <DialogFooter className="border-t px-4 py-3 sm:px-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSizeChartPickerOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!sizeChartPickerSelection}
              onClick={confirmSizeChartSelection}
            >
              <Check className="mr-1.5 h-4 w-4" />
              Select
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <KeywordResearchSheet
        open={keywordResearchOpen}
        onOpenChange={setKeywordResearchOpen}
      />

      <AiSeoSheet
        open={aiSeoOpen}
        onOpenChange={setAiSeoOpen}
        productKey={listItemId}
        productContext={{
          name: form?.name ?? '',
          description: form?.description ?? '',
          mobileDetailMarkdown: form?.mobileDetailMarkdown ?? '',
          tags: form?.tags ?? [],
        }}
        onApply={handleAiSeoApply}
      />

      <ProductPreviewSheet
        open={productPreviewOpen}
        onOpenChange={setProductPreviewOpen}
        listItem={listItem}
      />
    </>
  );
}
