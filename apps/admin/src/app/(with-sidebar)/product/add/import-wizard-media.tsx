'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
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
  AlertCircle,
  AlertTriangle,
  Check,
  GripVertical,
  ImageOff,
  Plus,
  Video,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ProxiedImg } from '@/util/proxied-image';

import type { ImportFormState, ProductImageForm, ProductVideoForm } from './storage';

// ─── Image thumbnail with load-error fallback ─────────────────────────────────

function MediaImagePreview({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!src?.trim() || failed) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-muted/80 px-1 text-center"
        role="img"
        aria-label={src?.trim() ? 'Image failed to load' : 'No image URL'}
      >
        <ImageOff className="size-4 text-muted-foreground/70 sm:size-5" />
        <span className="text-[9px] leading-tight text-muted-foreground sm:text-[10px]">
          {src?.trim() ? 'Failed' : 'No URL'}
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {!loaded ? (
        <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden />
      ) : null}
      <ProxiedImg
        src={src}
        alt={alt}
        className={cn(
          'h-full w-full object-contain transition-opacity duration-200',
          loaded ? 'opacity-100' : 'opacity-0'
        )}
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setFailed(true);
          setLoaded(true);
        }}
      />
    </div>
  );
}

// ─── Sortable image row (vertical list) ───────────────────────────────────────

function SortableMediaImageRow({
  id,
  image,
  index,
  productName,
  onAltChange,
  onToggleSelected,
}: {
  id: string;
  image: ProductImageForm;
  index: number;
  productName: string;
  onAltChange: (alt: string) => void;
  onToggleSelected: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const selected = image.selected !== false;
  const isThumbnail = index === 0;
  const hasUrl = Boolean(image.url?.trim());

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        // Always a single horizontal row so items stack vertically in the list.
        // Compact padding on mobile (~3 rows visible); larger thumbs from md up.
        'grid grid-cols-[28px_100px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-lg border bg-background p-1.5 transition sm:grid-cols-[36px_100px_minmax(0,1fr)_auto] sm:gap-2.5 sm:p-2 md:grid-cols-[40px_112px_minmax(0,1fr)_auto] md:gap-3 md:p-2.5 lg:grid-cols-[40px_128px_minmax(0,1fr)_auto] lg:p-3 xl:grid-cols-[44px_144px_minmax(0,1fr)_auto] xl:gap-3.5',
        isDragging && 'z-10 shadow-lg ring-1 ring-border',
        !selected && 'opacity-60',
        selected && isThumbnail && 'border-primary/40 ring-1 ring-primary/15',
        !hasUrl && 'border-destructive/40'
      )}
    >
      <button
        type="button"
        className="flex size-7 touch-none items-center justify-center self-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:size-9"
        aria-label={`Drag to reorder image ${index + 1}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5 sm:size-4" />
      </button>

      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-muted">
        <MediaImagePreview
          src={image.url}
          alt={image.alt || productName || `Product image ${index + 1}`}
        />
        {isThumbnail ? (
          <Badge
            className="absolute left-0.5 top-0.5 gap-0.5 px-1 py-0 text-[9px] font-semibold shadow-sm sm:left-1 sm:top-1 sm:px-1.5 sm:text-[10px]"
            variant="default"
          >
            Thumb
          </Badge>
        ) : null}
      </div>

      <div className="min-w-0 space-y-0.5 self-center sm:space-y-1">
        <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
          <Label
            htmlFor={`img-alt-${id}`}
            className="text-[9px] leading-none text-muted-foreground sm:text-xs"
          >
            Alt · #{index + 1}
          </Label>
          {isThumbnail ? (
            <span className="text-[9px] font-medium leading-none text-primary sm:text-[11px]">
              Thumbnail
            </span>
          ) : null}
        </div>
        <Input
          id={`img-alt-${id}`}
          value={image.alt}
          onChange={(e) => onAltChange(e.target.value)}
          placeholder="Alt text for SEO"
          className="h-6 px-1.5 text-[11px] sm:h-8 sm:px-3 sm:text-sm md:h-9"
          maxLength={200}
          aria-label={`Alt text for image ${index + 1}`}
        />
        {!hasUrl ? (
          <p className="flex items-center gap-1 text-[10px] text-destructive">
            <AlertCircle className="size-3 shrink-0" />
            Missing URL — skipped on publish
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-end self-center">
        <button
          type="button"
          onClick={onToggleSelected}
          aria-pressed={selected}
          aria-label={
            selected
              ? `Deselect image ${index + 1}`
              : `Select image ${index + 1}`
          }
          className={cn(
            'flex size-7 items-center justify-center rounded-full border shadow-sm transition sm:size-9',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground'
          )}
        >
          {selected ? (
            <Check className="size-3.5 sm:size-4" />
          ) : (
            <Plus className="size-3.5 sm:size-4" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Media step ───────────────────────────────────────────────────────────────

type ImportWizardMediaProps = {
  form: ImportFormState;
  selectedImageCount: number;
  updateForm: (updater: (prev: ImportFormState) => ImportFormState) => void;
};

/** Opaque drag ids — never encode index so reorder can move ids with items. */
function createImageDragId(index: number): string {
  return `import-img-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ImportWizardMedia({
  form,
  selectedImageCount,
  updateForm,
}: ImportWizardMediaProps) {
  const imageIdsRef = useRef<string[]>([]);
  const seededForRef = useRef<string | null>(null);
  const imageCount = form.productImages.length;

  // Seed once per distinct image set (sorted URLs). Reorder / alt / select
  // must not recreate ids or SortableContext remounts mid-drag.
  const setIdentity = useMemo(() => {
    const urls = form.productImages.map((img) => img.url).filter(Boolean);
    return [...urls].sort().join('\0') || `count:${imageCount}`;
  }, [form.productImages, imageCount]);

  if (
    seededForRef.current !== setIdentity ||
    imageIdsRef.current.length !== imageCount
  ) {
    if (seededForRef.current === setIdentity && imageIdsRef.current.length > 0) {
      while (imageIdsRef.current.length < imageCount) {
        imageIdsRef.current.push(createImageDragId(imageIdsRef.current.length));
      }
      if (imageIdsRef.current.length > imageCount) {
        imageIdsRef.current = imageIdsRef.current.slice(0, imageCount);
      }
    } else {
      imageIdsRef.current = form.productImages.map((_, i) =>
        createImageDragId(i)
      );
      seededForRef.current = setIdentity;
    }
  }

  const imageIds = imageIdsRef.current;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const includeVideo = Boolean(form.mainVideo);
  const hasVideos = form.videos.length > 0;
  const imagesWithoutUrl = useMemo(
    () => form.productImages.filter((img) => !img.url?.trim()).length,
    [form.productImages]
  );
  const activeVideo: ProductVideoForm | null = useMemo(() => {
    if (!form.videos.length) return null;
    if (form.mainVideo) {
      return (
        form.videos.find((v) => v.url === form.mainVideo) ??
        form.videos[0] ??
        null
      );
    }
    return form.videos[0] ?? null;
  }, [form.videos, form.mainVideo]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const ids = imageIdsRef.current;
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

      imageIdsRef.current = arrayMove(ids, oldIndex, newIndex);

      updateForm((prev) => ({
        ...prev,
        productImages: arrayMove(prev.productImages, oldIndex, newIndex).map(
          (img, i) => ({ ...img, position: i })
        ),
      }));
    },
    [updateForm]
  );

  const setAllSelected = (selected: boolean) => {
    updateForm((prev) => ({
      ...prev,
      productImages: prev.productImages.map((img) => ({
        ...img,
        selected,
      })),
    }));
  };

  const setIncludeVideo = (checked: boolean) => {
    updateForm((prev) => {
      if (!checked) {
        return { ...prev, mainVideo: null };
      }
      const nextUrl =
        prev.videos.find((v) => v.url === prev.mainVideo)?.url ??
        prev.videos[0]?.url ??
        null;
      return { ...prev, mainVideo: nextUrl };
    });
  };

  const selectVideo = (url: string) => {
    if (!url?.trim()) return;
    updateForm((prev) => ({
      ...prev,
      mainVideo: url,
    }));
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Images */}
      <Card>
        <CardContent className="space-y-3 p-3 sm:space-y-4 sm:p-4 md:p-5">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold">
                Product images ({selectedImageCount} selected
                {imageCount > 0 ? ` · ${imageCount} total` : ''})
              </h3>
              <p className="text-xs text-muted-foreground">
                Drag the grip to reorder. The first image is always the
                storefront thumbnail. Toggle selection and set alt text for SEO.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAllSelected(true)}
                disabled={imageCount === 0}
              >
                Select all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAllSelected(false)}
                disabled={imageCount === 0}
              >
                Clear
              </Button>
            </div>
          </div>

          {imageCount === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center sm:min-h-36">
              <ImageOff className="size-6 text-muted-foreground/60" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">No images available</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  This AliExpress product did not return any images.
                </p>
              </div>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={imageIds}
                strategy={verticalListSortingStrategy}
              >
                {/*
                  Vertical stack — tighter gap on mobile so ~3 rows remain
                  visible; slightly more breathing room on larger screens.
                */}
                <div className="grid gap-2 sm:gap-2.5 md:gap-3">
                  {form.productImages.map((image, index) => {
                    const id = imageIds[index] ?? createImageDragId(index);
                    return (
                      <SortableMediaImageRow
                        key={id}
                        id={id}
                        image={image}
                        index={index}
                        productName={form.name}
                        onAltChange={(alt) =>
                          updateForm((prev) => ({
                            ...prev,
                            productImages: prev.productImages.map((img, i) =>
                              i === index ? { ...img, alt } : img
                            ),
                          }))
                        }
                        onToggleSelected={() =>
                          updateForm((prev) => ({
                            ...prev,
                            productImages: prev.productImages.map((img, i) =>
                              i === index
                                ? {
                                    ...img,
                                    selected: img.selected === false,
                                  }
                                : img
                            ),
                          }))
                        }
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {imageCount > 0 && selectedImageCount === 0 ? (
            <Alert className="border-amber-500/40 bg-amber-500/5 text-amber-950 dark:text-amber-100">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
              <AlertTitle className="text-amber-900 dark:text-amber-100">
                No images selected
              </AlertTitle>
              <AlertDescription className="text-amber-800/90 dark:text-amber-200/90">
                Select at least one image before continuing. The top image
                becomes the product thumbnail when selected.
              </AlertDescription>
            </Alert>
          ) : null}

          {imagesWithoutUrl > 0 ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Broken image entries</AlertTitle>
              <AlertDescription>
                {imagesWithoutUrl === 1
                  ? '1 image is missing a URL and will be skipped on publish.'
                  : `${imagesWithoutUrl} images are missing URLs and will be skipped on publish.`}{' '}
                Reorder or deselect them if needed.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* Video */}
      <Card>
        <CardContent className="space-y-4 p-3 sm:p-4 md:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Video className="size-4 shrink-0 text-muted-foreground" />
                Product video
              </h3>
              <p className="text-xs text-muted-foreground">
                {hasVideos
                  ? 'Optionally publish a main product video on the storefront.'
                  : 'This AliExpress product has no video attached.'}
              </p>
            </div>

            {hasVideos ? (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-none">
                    Include video
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {includeVideo ? 'Will be published' : 'Skipped on publish'}
                  </p>
                </div>
                <Switch
                  checked={includeVideo}
                  onCheckedChange={setIncludeVideo}
                  aria-label="Include product video"
                />
              </div>
            ) : null}
          </div>

          {!hasVideos ? (
            <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground">
              <Video className="h-5 w-5 opacity-50" />
              No video available
            </div>
          ) : (
            <div
              className={cn(
                'space-y-3 transition',
                !includeVideo && 'opacity-55'
              )}
            >
              {form.videos.length === 1 && activeVideo ? (
                <VideoPlayerCard
                  video={activeVideo}
                  label="Main product video"
                  enabled={includeVideo}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {form.videos.map((video, index) => {
                    const isActive =
                      includeVideo && form.mainVideo === video.url;
                    const hasValidUrl = Boolean(video.url?.trim());

                    return (
                      <button
                        key={video.url || `video-${index}`}
                        type="button"
                        disabled={!includeVideo || !hasValidUrl}
                        onClick={() => {
                          if (hasValidUrl) selectVideo(video.url);
                        }}
                        className={cn(
                          'overflow-hidden rounded-lg border text-left transition',
                          isActive
                            ? 'border-primary ring-2 ring-primary/25'
                            : 'hover:border-primary/40',
                          (!includeVideo || !hasValidUrl) &&
                            'cursor-not-allowed',
                          !hasValidUrl && 'border-destructive/40'
                        )}
                        aria-pressed={isActive}
                        aria-label={
                          hasValidUrl
                            ? `Select video ${index + 1} as main product video`
                            : `Video ${index + 1} has no playable URL`
                        }
                      >
                        {hasValidUrl ? (
                          <video
                            controls={includeVideo && isActive}
                            preload="metadata"
                            poster={video.poster ?? undefined}
                            className="max-h-48 w-full bg-black object-contain sm:max-h-56"
                            onClick={(e) => {
                              if (includeVideo && isActive) e.stopPropagation();
                            }}
                          >
                            <source src={video.url} />
                          </video>
                        ) : (
                          <div className="flex max-h-48 min-h-32 w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
                            <AlertCircle className="size-5" />
                            <span className="text-xs">Invalid video URL</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 border-t bg-background px-3 py-2">
                          <span className="truncate text-xs font-medium">
                            Video {index + 1}
                            {isActive ? ' · Main' : ''}
                          </span>
                          {isActive ? (
                            <Badge
                              variant="default"
                              className="shrink-0 text-[10px]"
                            >
                              Selected
                            </Badge>
                          ) : includeVideo && hasValidUrl ? (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              Click to use
                            </span>
                          ) : !hasValidUrl ? (
                            <span className="shrink-0 text-[11px] text-destructive">
                              Unavailable
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {!includeVideo ? (
                <p className="text-xs text-muted-foreground">
                  Video is off — it will not be attached when you publish. Turn
                  the switch on to include it.
                </p>
              ) : form.mainVideo ? (
                <p className="break-all text-[11px] text-muted-foreground">
                  Main video URL: {form.mainVideo}
                </p>
              ) : (
                <Alert className="border-amber-500/40 bg-amber-500/5 text-amber-950 dark:text-amber-100">
                  <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                  <AlertTitle className="text-amber-900 dark:text-amber-100">
                    No video selected
                  </AlertTitle>
                  <AlertDescription className="text-amber-800/90 dark:text-amber-200/90">
                    Include video is on, but no video URL is selected. Pick a
                    video above or turn the switch off.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Single video player ──────────────────────────────────────────────────────

function VideoPlayerCard({
  video,
  label,
  enabled,
}: {
  video: ProductVideoForm;
  label: string;
  enabled: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const hasUrl = Boolean(video.url?.trim());

  if (!hasUrl || failed) {
    return (
      <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-destructive/30 bg-destructive/5 px-4 py-8 text-center">
        <AlertCircle className="size-5 text-destructive/80" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {failed ? 'Video failed to load' : 'Invalid video URL'}
          </p>
          <p className="text-xs text-muted-foreground">
            {failed
              ? 'The source may be blocked or unavailable. Try another video or turn video off.'
              : 'This entry has no playable URL and cannot be published.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-muted">
      <video
        key={video.url}
        controls={enabled}
        preload="metadata"
        poster={video.poster ?? undefined}
        className="max-h-56 w-full bg-black object-contain sm:max-h-64 md:max-h-72"
        aria-label={label}
        onError={() => setFailed(true)}
      >
        <source src={video.url} />
      </video>
    </div>
  );
}
