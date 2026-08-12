'use client';

import { useState, useRef, useEffect, ImgHTMLAttributes } from 'react';
import { useProxiedImageSrc } from '@/app/(with-sidebar)/settings/use-settings';

interface CustomImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  className?: string;
  placeholderSrc?: string;
  /** width + height prevent CLS — always pass these */
  width?: number;
  height?: number;
  /** true for your LCP/hero image — skips lazy load, sets fetchpriority=high */
  priority?: boolean;
  /** caption text — wraps in <figure>/<figcaption> for semantic HTML */
  caption?: string;
}

/**
 * Product image with blur-in loading.
 * AliExpress CDN URLs are routed through the admin image proxy when that
 * setting is enabled; all other URLs are left unchanged.
 */
export default function CustomImage({
  src,
  alt,
  className = '',
  placeholderSrc = '',
  width,
  height,
  priority = false,
  caption,
  ...props
}: CustomImageProps) {
  const resolvedSrc = useProxiedImageSrc(src);
  const resolvedPlaceholder = useProxiedImageSrc(placeholderSrc || null);
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setIsLoaded(false);

    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setIsLoaded(true);
      return;
    }

    const t = setTimeout(() => {
      if (!imgRef.current?.complete) setIsLoaded(true);
    }, 2500);

    return () => clearTimeout(t);
  }, [resolvedSrc]);

  const img = (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Blur placeholder — hidden from assistive tech, no alt needed */}
      {!isLoaded && resolvedPlaceholder && (
        <img
          src={resolvedPlaceholder}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-105 object-cover blur-lg"
        />
      )}

      {/* Real image */}
      <img
        ref={imgRef}
        src={resolvedSrc || undefined}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        fetchPriority={priority ? 'high' : 'auto'}
        onLoad={() => setIsLoaded(true)}
        onError={() => setIsLoaded(true)}
        className={`h-full w-full object-cover transition-opacity duration-500 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        {...props}
      />
    </div>
  );

  if (caption) {
    return (
      <figure className="m-0 p-0">
        {img}
        <figcaption className="mt-1 text-sm text-gray-500">{caption}</figcaption>
      </figure>
    );
  }

  return img;
}
