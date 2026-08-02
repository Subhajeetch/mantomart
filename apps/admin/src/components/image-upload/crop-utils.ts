import type { Area } from 'react-easy-crop';

/**
 * Draw the cropped region onto a canvas and export as WebP.
 * Output is exactly `outputWidth` × `outputHeight` pixels.
 */
export async function getCroppedWebpBlob(
  imageSrc: string,
  pixelCrop: Area,
  outputWidth: number,
  outputHeight: number,
  quality = 0.9
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create canvas context for image crop.');
  }

  // Smooth downscales look better for icons / small assets.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputWidth,
    outputHeight
  );

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/webp', quality);
  });

  if (!blob) {
    throw new Error('Failed to encode cropped image as WebP.');
  }

  return blob;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Object URLs / data URLs don't need crossOrigin; remote URLs might.
    if (!src.startsWith('blob:') && !src.startsWith('data:')) {
      image.crossOrigin = 'anonymous';
    }
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('Failed to load image for cropping.'));
    image.src = src;
  });
}

/** Accepted input MIME types before crop (any common raster). */
export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
] as const;

export const ACCEPTED_IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',');

/** Max source file size before crop (10 MiB). */
export const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;

export function isAcceptedImageFile(file: File): boolean {
  if (file.type && (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return true;
  }
  // Some browsers leave type empty — fall back to extension.
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'].includes(
    ext ?? ''
  );
}
