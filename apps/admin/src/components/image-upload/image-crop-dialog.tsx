'use client';

import { useCallback, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Crop, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { getCroppedWebpBlob } from './crop-utils';
import type { ImageCropDialogProps } from './types';

/**
 * Modal cropper sized around the required output (e.g. 128×128).
 * Always exports WebP at exact pixel dimensions.
 */
export function ImageCropDialog({
  open,
  onOpenChange,
  imageSrc,
  outputWidth,
  outputHeight,
  quality = 0.9,
  title = 'Crop image',
  description,
  confirmLabel = 'Apply crop',
  onCropped,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aspect =
    outputHeight > 0 ? outputWidth / outputHeight : 1;

  const onCropComplete = useCallback(
    (_croppedArea: Area, croppedPixels: Area) => {
      setCroppedAreaPixels(croppedPixels);
    },
    []
  );

  async function handleConfirm() {
    if (!croppedAreaPixels) {
      setError('Adjust the crop area before continuing.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const blob = await getCroppedWebpBlob(
        imageSrc,
        croppedAreaPixels,
        outputWidth,
        outputHeight,
        quality
      );
      const previewUrl = URL.createObjectURL(blob);
      onCropped(blob, previewUrl);
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to crop image.'
      );
    } finally {
      setBusy(false);
    }
  }

  // Keep the crop stage compact — roughly the output size, but large enough to use.
  const stageSize = Math.min(
    320,
    Math.max(160, Math.max(outputWidth, outputHeight) * 1.75)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crop className="size-4" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {description ??
              `Drag to reposition, scroll or use the slider to zoom. Output will be ${outputWidth}×${outputHeight}px WebP.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className={cn(
              'relative mx-auto overflow-hidden rounded-lg bg-muted ring-1 ring-border'
            )}
            style={{
              width: stageSize,
              height: stageSize / aspect,
              maxWidth: '100%',
            }}
          >
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              showGrid
              objectFit="contain"
              style={{
                containerStyle: {
                  width: '100%',
                  height: '100%',
                  background: 'transparent',
                },
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="crop-zoom" className="text-xs">
                Zoom
              </Label>
              <span className="text-muted-foreground text-xs tabular-nums">
                {zoom.toFixed(2)}×
              </span>
            </div>
            <input
              id="crop-zoom"
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              disabled={busy}
              className="w-full accent-primary"
            />
          </div>

          <p className="text-muted-foreground text-center text-xs">
            Final size:{' '}
            <span className="font-mono tabular-nums">
              {outputWidth}×{outputHeight}
            </span>{' '}
            · format: <span className="font-mono">webp</span>
          </p>

          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy || !croppedAreaPixels}
            className="gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
