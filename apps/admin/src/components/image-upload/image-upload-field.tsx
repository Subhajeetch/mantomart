'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ImagePlus,
  Loader2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import {
  ACCEPTED_IMAGE_ACCEPT,
  isAcceptedImageFile,
  MAX_SOURCE_FILE_BYTES,
} from './crop-utils';
import { ImageCropDialog } from './image-crop-dialog';
import { ImageUploadError, uploadImageBlob } from './upload-api';
import type { ImageUploadFieldProps } from './types';

/**
 * Reusable image field: drag/drop or pick → crop dialog → WebP upload.
 *
 * Configure `outputWidth` / `outputHeight` / `folder` / `name` / `purpose`
 * per use-site. Category icons typically use 128×128 + folder="category".
 */
export function ImageUploadField({
  value,
  onChange,
  disabled = false,
  outputWidth = 128,
  outputHeight = 128,
  quality = 0.9,
  folder,
  name,
  purpose,
  label = 'Image',
  hint,
  className,
  onUploaded,
}: ImageUploadFieldProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver] = useState(false);
  const [sourceSrc, setSourceSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  // Revoke object URLs on unmount / replace
  useEffect(() => {
    return () => {
      if (sourceSrc?.startsWith('blob:')) URL.revokeObjectURL(sourceSrc);
      if (localPreview?.startsWith('blob:')) URL.revokeObjectURL(localPreview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on unmount
  }, []);

  const displayUrl = localPreview || value || null;
  const busy = disabled || uploading;
  const canUpload = Boolean(name.trim());

  const openCropForFile = useCallback(
    (file: File) => {
      if (busy) return;

      if (!isAcceptedImageFile(file)) {
        toast.error('Please choose a JPEG, PNG, WebP, or GIF image.');
        return;
      }
      if (file.size > MAX_SOURCE_FILE_BYTES) {
        toast.error('Image is too large (max 10 MB before crop).');
        return;
      }
      if (!canUpload) {
        toast.error('Enter a name first so the image can be labelled.');
        return;
      }

      if (sourceSrc?.startsWith('blob:')) URL.revokeObjectURL(sourceSrc);
      const url = URL.createObjectURL(file);
      setSourceSrc(url);
      setCropOpen(true);
    },
    [busy, canUpload, sourceSrc]
  );

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow re-selecting the same file
    e.target.value = '';
    if (file) openCropForFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) openCropForFile(file);
  }

  async function handleCropped(blob: Blob, previewUrl: string) {
    if (localPreview?.startsWith('blob:')) URL.revokeObjectURL(localPreview);
    setLocalPreview(previewUrl);
    setUploading(true);

    try {
      const result = await uploadImageBlob({
        blob,
        folder,
        name: name.trim(),
        purpose,
        previewUrl,
      });

      // Prefer public URL; fall back to key only if API_URL / origin is missing.
      if (result.url) {
        onChange(result.url);
        // Keep local preview until parent re-renders with server URL;
        // then we can drop it on next value change.
      } else {
        toast.warning(
          'Image stored, but public URL could not be built (check API_URL).'
        );
        onChange(result.key);
      }

      onUploaded?.(result);
      toast.success('Image uploaded.');
    } catch (err) {
      if (localPreview?.startsWith('blob:')) {
        // Keep preview so user can retry? Clear on failure.
      }
      setLocalPreview(null);
      const message =
        err instanceof ImageUploadError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to upload image.';
      toast.error(message);
    } finally {
      setUploading(false);
      if (sourceSrc?.startsWith('blob:')) {
        URL.revokeObjectURL(sourceSrc);
      }
      setSourceSrc(null);
    }
  }

  function handleRemove() {
    if (busy) return;
    if (localPreview?.startsWith('blob:')) URL.revokeObjectURL(localPreview);
    setLocalPreview(null);
    onChange('');
  }

  const previewBoxStyle = {
    width: Math.min(outputWidth, 128),
    height: Math.min(outputHeight, 128),
  };

  return (
    <div className={cn('space-y-2', className)}>
      {label && <Label htmlFor={inputId}>{label}</Label>}

      <div className="flex items-start gap-3">
        {/* Preview */}
        <div
          className={cn(
            'bg-muted relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-border',
            !displayUrl && 'border-dashed'
          )}
          style={previewBoxStyle}
        >
          {displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrl}
              alt=""
              className="size-full object-cover"
              width={outputWidth}
              height={outputHeight}
            />
          ) : (
            <ImagePlus className="text-muted-foreground size-5" />
          )}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Loader2 className="text-primary size-5 animate-spin" />
            </div>
          )}
        </div>

        {/* Drop zone / actions */}
        <div className="min-w-0 flex-1 space-y-2">
          <div
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-disabled={busy}
            onKeyDown={(e) => {
              if (busy) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              if (!busy) setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDrop={handleDrop}
            onClick={() => {
              if (!busy) fileInputRef.current?.click();
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center transition-colors',
              dragOver && 'border-primary bg-primary/5',
              busy
                ? 'cursor-not-allowed opacity-60'
                : 'hover:border-primary/60 hover:bg-muted/40'
            )}
          >
            <Upload className="text-muted-foreground size-4" />
            <p className="text-muted-foreground text-xs">
              {canUpload
                ? 'Drop an image or click to choose'
                : 'Enter a name above before uploading'}
            </p>
            <p className="text-muted-foreground/80 text-[10px]">
              Crops to {outputWidth}×{outputHeight}px · saved as WebP
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !canUpload}
              onClick={() => fileInputRef.current?.click()}
              className="gap-1.5"
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {displayUrl ? 'Replace' : 'Upload'}
            </Button>
            {displayUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={handleRemove}
                className="text-destructive hover:text-destructive gap-1.5"
              >
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}

      <input
        ref={fileInputRef}
        id={inputId}
        type="file"
        accept={ACCEPTED_IMAGE_ACCEPT}
        className="sr-only"
        disabled={busy}
        onChange={handleFileInput}
      />

      {sourceSrc && (
        <ImageCropDialog
          open={cropOpen}
          onOpenChange={(open) => {
            setCropOpen(open);
            if (!open) {
              if (sourceSrc.startsWith('blob:')) {
                URL.revokeObjectURL(sourceSrc);
              }
              setSourceSrc(null);
            }
          }}
          imageSrc={sourceSrc}
          outputWidth={outputWidth}
          outputHeight={outputHeight}
          quality={quality}
          title={`Crop to ${outputWidth}×${outputHeight}`}
          onCropped={(blob, previewUrl) => {
            void handleCropped(blob, previewUrl);
          }}
        />
      )}
    </div>
  );
}

/** Compact clear button used when embedding the field tightly. */
export function ImageUploadClearButton({
  onClear,
  disabled,
}: {
  onClear: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      onClick={onClear}
      aria-label="Clear image"
    >
      <X className="size-3.5" />
    </Button>
  );
}
