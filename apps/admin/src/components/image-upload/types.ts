/** Shared types for the reusable image crop + upload flow. */

export type ImageUploadFolder =
  | 'category'
  | 'product'
  | 'product-gallery'
  | 'product-variant'
  | 'banner'
  | 'brand'
  | 'review'
  | 'user'
  | 'misc';

export type ImageCropUploadResult = {
  /** Public URL from the API (Worker /api/images or CDN via R2_PUBLIC_URL). */
  url: string | null;
  key: string;
  filename: string;
  folder: string;
  purpose: string;
  size: number;
  /** Local object URL for immediate preview (revoke when done). */
  previewUrl: string;
  /** Cropped WebP blob that was uploaded. */
  blob: Blob;
};

export type ImageCropDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Object URL or data URL of the source image. */
  imageSrc: string;
  /** Output width in CSS pixels (and canvas export size). */
  outputWidth: number;
  /** Output height in CSS pixels. */
  outputHeight: number;
  /** 0–1 WebP quality (default 0.9). */
  quality?: number;
  title?: string;
  description?: string;
  confirmLabel?: string;
  onCropped: (blob: Blob, previewUrl: string) => void;
};

export type ImageUploadFieldProps = {
  /** Current image URL (from server or previous upload). */
  value: string;
  onChange: (url: string) => void;
  /** Disabled while parent form is saving. */
  disabled?: boolean;
  /**
   * Exact export size. Category icons default to 128×128.
   * Dialog crop area is sized to match this aspect ratio.
   */
  outputWidth?: number;
  outputHeight?: number;
  /** WebP quality 0–1. */
  quality?: number;
  /** R2 folder — must be allow-listed on the API. */
  folder: ImageUploadFolder;
  /**
   * Free-form name used in the object key:
   * `{name}_{purpose}_{epoch}.webp`
   */
  name: string;
  /**
   * About-image purpose, e.g. "category" or "category-fashion".
   * Defaults to `folder` when omitted.
   */
  purpose?: string;
  /** Optional label above the control. */
  label?: string;
  /** Hint under the control. */
  hint?: string;
  className?: string;
  /** Called with the full upload result after a successful upload. */
  onUploaded?: (result: ImageCropUploadResult) => void;
};
