'use client';

/**
 * Drop-in image helpers that honor the AliExpress image-proxy setting.
 * Use these in product UIs instead of raw <img> / next/image src for AE CDN URLs.
 *
 * Non-AliExpress URLs (uploads, local assets, data/blob) are left unchanged.
 * When the setting is off, every URL is left unchanged.
 */

import Image, { type ImageProps } from 'next/image';
import { useProxiedImageSrc } from '@/app/(with-sidebar)/settings/use-settings';

type NativeImgProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
};

/** Native <img> with optional proxy resolution for AliExpress CDN URLs. */
export function ProxiedImg({ src, alt = '', ...props }: NativeImgProps) {
  const resolved = useProxiedImageSrc(src);
  return <img src={resolved || undefined} alt={alt} {...props} />;
}

type ProxiedNextImageProps = Omit<ImageProps, 'src'> & {
  src: string;
};

/** next/image with optional proxy resolution (keep unoptimized for remote CDNs). */
export function ProxiedNextImage({
  src,
  alt,
  ...props
}: ProxiedNextImageProps) {
  const resolved = useProxiedImageSrc(src);
  if (!resolved) {
    return null;
  }
  return <Image src={resolved} alt={alt} {...props} />;
}
