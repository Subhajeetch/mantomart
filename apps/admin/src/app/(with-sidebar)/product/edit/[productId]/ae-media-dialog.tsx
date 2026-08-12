'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ImageIcon, Loader2, Video } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
import { ProxiedImg } from '@/util/proxied-image';
import { cn } from '@/lib/utils';

import {
  extractAliExpressMedia,
} from '../../add/import-wizard-utils';
import {
  fetchAliExpressProductDetail,
} from '../../add/product-dialog';
import { imageDedupeKey } from './edit-utils';

type MediaMode = 'images' | 'video' | 'size-chart';

type AeMediaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: MediaMode;
  aeProductId: string | null;
  productName: string;
  /** URLs already on the product — used to grey out / skip duplicates for images. */
  existingImageUrls?: string[];
  currentMainVideo?: string | null;
  currentSizeChartImage?: string | null;
  onAddImages?: (images: Array<{ url: string; alt: string }>) => void;
  onSelectVideo?: (url: string | null) => void;
  onSelectSizeChart?: (url: string | null) => void;
};

export function AeMediaDialog({
  open,
  onOpenChange,
  mode,
  aeProductId,
  productName,
  existingImageUrls = [],
  currentMainVideo = null,
  currentSizeChartImage = null,
  onAddImages,
  onSelectVideo,
  onSelectSizeChart,
}: AeMediaDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [videos, setVideos] = useState<
    Array<{ url: string; poster: string | null }>
  >([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [selectedSizeChart, setSelectedSizeChart] = useState<string | null>(
    null
  );
  const [altDraft, setAltDraft] = useState(productName.slice(0, 120));

  const existingKeys = useMemo(
    () => new Set(existingImageUrls.map(imageDedupeKey)),
    [existingImageUrls]
  );

  const load = useCallback(async () => {
    if (!aeProductId?.trim()) {
      setError('This product is not linked to an AliExpress source.');
      setImages([]);
      setVideos([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const detail = await fetchAliExpressProductDetail(aeProductId.trim());
      const media = extractAliExpressMedia(detail);
      setImages(media.images);
      setVideos(media.videos);

      if (mode === 'images' && media.images.length === 0) {
        setError('No images found on the AliExpress product.');
      }
      if (mode === 'video' && media.videos.length === 0) {
        setError('This AliExpress product has no video.');
      }
      if (mode === 'size-chart' && media.images.length === 0) {
        setError('No images available to use as a size chart.');
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to load AliExpress media.';
      setError(message);
      setImages([]);
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [aeProductId, mode]);

  useEffect(() => {
    if (!open) return;
    setSelectedUrls(new Set());
    setSelectedVideo(currentMainVideo);
    setSelectedSizeChart(currentSizeChartImage);
    setAltDraft(productName.trim().slice(0, 120) || 'Product image');
    void load();
  }, [
    open,
    load,
    productName,
    currentMainVideo,
    currentSizeChartImage,
  ]);

  const title =
    mode === 'images'
      ? 'Add images from AliExpress'
      : mode === 'video'
        ? 'Select product video'
        : 'Select size chart image';

  const description =
    mode === 'images'
      ? 'Pick gallery or detail images from the linked AliExpress product. Alt text defaults to the product name.'
      : mode === 'video'
        ? 'Choose a video from the linked AliExpress product, or clear the current one.'
        : 'Pick an image from AliExpress (detail images often include size charts).';

  function toggleImage(url: string) {
    if (existingKeys.has(imageDedupeKey(url))) return;
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function handleConfirm() {
    if (mode === 'images') {
      if (selectedUrls.size === 0) {
        toast.error('Select at least one image.');
        return;
      }
      const alt = altDraft.trim().slice(0, 120) || productName.slice(0, 120);
      onAddImages?.(
        Array.from(selectedUrls).map((url) => ({ url, alt }))
      );
      toast.success(
        selectedUrls.size === 1
          ? 'Image added.'
          : `${selectedUrls.size} images added.`
      );
      onOpenChange(false);
      return;
    }

    if (mode === 'video') {
      onSelectVideo?.(selectedVideo);
      toast.success(
        selectedVideo ? 'Video updated.' : 'Video cleared.'
      );
      onOpenChange(false);
      return;
    }

    onSelectSizeChart?.(selectedSizeChart);
    toast.success(
      selectedSizeChart ? 'Size chart image set.' : 'Size chart image cleared.'
    );
    onOpenChange(false);
  }

  const canConfirm =
    mode === 'images'
      ? selectedUrls.size > 0
      : mode === 'video'
        ? true
        : true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-4 pb-3">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {!aeProductId?.trim() ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              This product has no AliExpress product id. Media can only be
              picked from a linked AliExpress source.
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Fetching AliExpress media…
            </div>
          ) : error &&
            ((mode === 'images' && images.length === 0) ||
              (mode === 'video' && videos.length === 0) ||
              (mode === 'size-chart' && images.length === 0)) ? (
            <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void load()}
              >
                Retry
              </Button>
            </div>
          ) : (
            <>
              {error ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {error}
                </p>
              ) : null}

              {mode === 'images' ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="ae-img-alt">Alt text (for selected)</Label>
                    <Input
                      id="ae-img-alt"
                      value={altDraft}
                      maxLength={120}
                      onChange={(e) => setAltDraft(e.target.value)}
                      placeholder="Product name"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Defaults to the product title. Applied to every image you
                      add in this batch.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                    {images.map((url) => {
                      const already = existingKeys.has(imageDedupeKey(url));
                      const selected = selectedUrls.has(url);
                      return (
                        <button
                          key={url}
                          type="button"
                          disabled={already}
                          onClick={() => toggleImage(url)}
                          className={cn(
                            'group relative aspect-square overflow-hidden rounded-lg border bg-muted transition',
                            selected &&
                              'border-primary ring-2 ring-primary/30',
                            already && 'cursor-not-allowed opacity-40'
                          )}
                          title={
                            already
                              ? 'Already on this product'
                              : selected
                                ? 'Deselect'
                                : 'Select'
                          }
                        >
                          <ProxiedImg
                            src={url}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                          {selected ? (
                            <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="size-3" />
                            </span>
                          ) : null}
                          {already ? (
                            <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-center text-[10px] text-white">
                              Already added
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {selectedUrls.size > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {selectedUrls.size} selected
                    </p>
                  ) : null}
                </>
              ) : null}

              {mode === 'video' ? (
                <div className="space-y-2">
                  {videos.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-sm text-muted-foreground">
                      <Video className="size-6 opacity-50" />
                      No videos on this AliExpress product.
                    </div>
                  ) : (
                    videos.map((video) => {
                      const selected = selectedVideo === video.url;
                      return (
                        <button
                          key={video.url}
                          type="button"
                          onClick={() =>
                            setSelectedVideo(
                              selected ? null : video.url
                            )
                          }
                          className={cn(
                            'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:bg-muted/50',
                            selected &&
                              'border-primary bg-primary/5 ring-1 ring-primary/20'
                          )}
                        >
                          <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                            {video.poster ? (
                              <ProxiedImg
                                src={video.poster}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <Video className="size-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              Product video
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {video.url}
                            </p>
                          </div>
                          {selected ? (
                            <Check className="size-4 shrink-0 text-primary" />
                          ) : null}
                        </button>
                      );
                    })
                  )}
                  {currentMainVideo && selectedVideo === currentMainVideo ? (
                    <p className="text-xs text-muted-foreground">
                      Currently set as main video. Click again to clear, or
                      pick another.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {mode === 'size-chart' ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {images.map((url) => {
                    const selected = selectedSizeChart === url;
                    return (
                      <button
                        key={url}
                        type="button"
                        onClick={() =>
                          setSelectedSizeChart(selected ? null : url)
                        }
                        className={cn(
                          'relative aspect-square overflow-hidden rounded-lg border bg-muted transition',
                          selected &&
                            'border-primary ring-2 ring-primary/30'
                        )}
                      >
                        <ProxiedImg
                          src={url}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        {selected ? (
                          <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-3" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  {images.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-sm text-muted-foreground">
                      <ImageIcon className="size-6 opacity-50" />
                      No images available.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {mode === 'video' && selectedVideo ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSelectedVideo(null);
                onSelectVideo?.(null);
                toast.success('Video cleared.');
                onOpenChange(false);
              }}
            >
              Clear video
            </Button>
          ) : null}
          {mode === 'size-chart' && selectedSizeChart ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSelectedSizeChart(null);
                onSelectSizeChart?.(null);
                toast.success('Size chart image cleared.');
                onOpenChange(false);
              }}
            >
              Clear image
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={
              loading ||
              !canConfirm ||
              (mode === 'images' && selectedUrls.size === 0)
            }
            onClick={handleConfirm}
          >
            {mode === 'images'
              ? `Add${selectedUrls.size ? ` (${selectedUrls.size})` : ''}`
              : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
