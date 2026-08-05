'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileEdit,
  ImageOff,
  Import,
  PackageOpen,
  ShoppingCart,
  Star,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ProxiedNextImage } from '@/app/(with-sidebar)/settings/proxied-image';

import ImportWizard from './import-wizard';
import {
  IMPORT_WIZARD_STEP_COUNT,
  PRODUCT_DRAFTS_KEY,
  SAVED_PRODUCTS_KEY,
  readDrafts,
  readSavedProducts,
  removeDraft,
  removeSavedProduct,
  writeSavedProducts,
  type ProductImportDraft,
  type SavedAliExpressProduct,
} from './storage';

function formatRelativeTime(ms: number) {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

const MyList = () => {
  const [savedProducts, setSavedProducts] = useState<SavedAliExpressProduct[]>(
    []
  );
  const [drafts, setDrafts] = useState<ProductImportDraft[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [activeItem, setActiveItem] = useState<SavedAliExpressProduct | null>(
    null
  );
  const [activeDraft, setActiveDraft] = useState<ProductImportDraft | null>(
    null
  );

  const refresh = useCallback(() => {
    setSavedProducts(readSavedProducts());
    setDrafts(readDrafts());
  }, []);

  useEffect(() => {
    refresh();

    const onStorage = (event: StorageEvent) => {
      if (
        event.key === SAVED_PRODUCTS_KEY ||
        event.key === PRODUCT_DRAFTS_KEY
      ) {
        refresh();
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  const draftByListId = useMemo(() => {
    const map = new Map<string, ProductImportDraft>();
    for (const d of drafts) map.set(d.listItemId, d);
    return map;
  }, [drafts]);

  /** Drafts whose list item may have been removed — still show them. */
  const orphanDrafts = useMemo(() => {
    const listIds = new Set(savedProducts.map((p) => p.id));
    return drafts.filter((d) => !listIds.has(d.listItemId));
  }, [drafts, savedProducts]);

  const openImport = (item: SavedAliExpressProduct) => {
    setActiveItem(item);
    setActiveDraft(draftByListId.get(item.id) ?? null);
    setWizardOpen(true);
  };

  const openDraft = (draft: ProductImportDraft) => {
    const item = savedProducts.find((p) => p.id === draft.listItemId) ?? null;
    // Reconstruct a minimal list item if the product was removed from list
    const fallback: SavedAliExpressProduct = item ?? {
      schemaVersion: 3,
      id: draft.listItemId,
      source: 'aliexpress',
      status: 'pending_review',
      addedAt: draft.updatedAt,
      addedAtMs: draft.updatedAtMs,
      searchContext: { query: '', pageIndex: 1, url: null },
      product: {
        itemId: draft.aeProductId,
        title: draft.titleSnapshot,
        targetSalePrice: '',
        targetOriginalPrice: '',
        salePriceFormat: '',
        discount: '',
        itemMainPic: draft.imageSnapshot ?? '',
        orders: '',
        evaluateRate: '',
        score: '',
        itemUrl: '',
      },
      normalized: {
        itemId: draft.aeProductId,
        title: draft.titleSnapshot,
        imageUrl: draft.imageSnapshot,
        itemUrl: null,
        displayPrice: '—',
        targetSalePrice: null,
        targetOriginalPrice: null,
        discount: null,
        orders: null,
        rating: null,
        positiveRate: null,
      },
    };
    setActiveItem(fallback);
    setActiveDraft(draft);
    setWizardOpen(true);
  };

  const handleRemoveFromList = (id: string) => {
    removeSavedProduct(id);
    removeDraft(id);
    refresh();
    toast.success('Removed from list.');
  };

  const handleDiscardDraft = (listItemId: string) => {
    removeDraft(listItemId);
    refresh();
    toast.success('Draft discarded.');
  };

  const handleClearList = () => {
    if (savedProducts.length === 0) return;
    writeSavedProducts([]);
    refresh();
    toast.success('My list cleared.');
  };

  const handlePublished = () => {
    refresh();
  };

  return (
    <div className="space-y-8 pb-8">
      {/* ── Drafts ── */}
      {drafts.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Drafts</h2>
              <p className="text-xs text-muted-foreground">
                Continue products you were editing — even if you closed the
                browser.
              </p>
            </div>
            <Badge variant="secondary">{drafts.length}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {drafts.map((draft) => (
              <Card
                key={draft.listItemId}
                className="group overflow-hidden border-amber-500/30 bg-amber-500/5 shadow-sm transition hover:border-amber-500/50 hover:shadow-md p-0"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                  {draft.imageSnapshot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={draft.imageSnapshot}
                      alt={draft.titleSnapshot}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <ImageOff className="h-8 w-8" />
                    </div>
                  )}
                  <Badge className="absolute left-2 top-2 bg-amber-600 hover:bg-amber-600">
                    Draft · step {draft.currentStep + 1}/
                    {IMPORT_WIZARD_STEP_COUNT}
                  </Badge>
                </div>
                <CardContent className="space-y-3 p-3">
                  <div>
                    <p className="line-clamp-2 text-sm font-medium leading-5">
                      {draft.titleSnapshot || 'Untitled draft'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Saved {formatRelativeTime(draft.updatedAtMs)}
                      {orphanDrafts.some(
                        (d) => d.listItemId === draft.listItemId
                      )
                        ? ' · list item removed'
                        : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="flex-1"
                      onClick={() => openDraft(draft)}
                    >
                      <FileEdit className="mr-1.5 h-3.5 w-3.5" />
                      Continue
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleDiscardDraft(draft.listItemId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── My List ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight">My List</h2>
            <p className="text-xs text-muted-foreground">
              Products added from AliExpress search. Import to edit and publish.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {savedProducts.length > 0 ? (
              <>
                <Badge variant="secondary">{savedProducts.length}</Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleClearList}
                >
                  Clear list
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {savedProducts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
              <PackageOpen className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium">Your list is empty</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Go to the Search Product tab, find AliExpress items, and add
                them to the list to import them here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {savedProducts.map((item) => {
              const hasDraft = draftByListId.has(item.id);
              const imageUrl = item.normalized.imageUrl;
              const title = item.normalized.title;
              const rating = item.normalized.rating;

              return (
                <Card
                  key={item.id}
                  className="group overflow-hidden shadow-sm transition hover:border-primary/40 hover:shadow-md p-0"
                >
                  <div className="relative aspect-square overflow-hidden bg-muted">
                    {imageUrl ? (
                      <ProxiedNextImage
                        src={imageUrl}
                        alt={title}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                        className="object-cover transition duration-300 group-hover:scale-[1.03]"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <ImageOff className="h-8 w-8" />
                      </div>
                    )}
                    {hasDraft ? (
                      <Badge className="absolute left-2 top-2 gap-1 bg-amber-600 hover:bg-amber-600">
                        <FileEdit className="h-3 w-3" />
                        Draft
                      </Badge>
                    ) : null}
                    {item.normalized.discount ? (
                      <Badge
                        variant="destructive"
                        className="absolute right-2 top-2"
                      >
                        {item.normalized.discount}
                      </Badge>
                    ) : null}
                  </div>

                  <CardContent className="flex min-h-[180px] flex-col gap-3 p-3">
                    <div className="space-y-1.5">
                      <p className="line-clamp-2 min-h-[40px] text-sm font-medium leading-5">
                        {title}
                      </p>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-base font-semibold text-primary">
                          {item.normalized.displayPrice}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {rating != null && rating > 0 ? (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                          {rating.toFixed(1)}
                        </span>
                      ) : null}
                      {item.normalized.orders ? (
                        <span className="ml-auto inline-flex items-center gap-1">
                          <ShoppingCart className="h-3.5 w-3.5" />
                          {item.normalized.orders} sold
                        </span>
                      ) : null}
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                      Added {formatRelativeTime(item.addedAtMs)}
                    </p>

                    <div className="mt-auto flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="flex-1"
                        onClick={() => openImport(item)}
                      >
                        <Import className="mr-1.5 h-3.5 w-3.5" />
                        {hasDraft ? 'Continue import' : 'Import'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleRemoveFromList(item.id)}
                        aria-label="Remove from list"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <ImportWizard
        open={wizardOpen}
        listItem={activeItem}
        resumeDraft={activeDraft}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) {
            setActiveItem(null);
            setActiveDraft(null);
            refresh();
          }
        }}
        onPublished={handlePublished}
        onDraftSaved={refresh}
      />
    </div>
  );
};

export default MyList;
