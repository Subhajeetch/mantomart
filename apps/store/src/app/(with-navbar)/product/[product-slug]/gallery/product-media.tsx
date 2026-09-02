'use client';

import { cn } from '@/lib/utils';

import type { PublicGalleryItem } from '../types';

type ProductMediaProps = {
  item: PublicGalleryItem;
  className?: string;
  contain?: boolean;
  priority?: boolean;
};

export function ProductMedia({
  item,
  className,
  contain = false,
  priority = false,
}: ProductMediaProps) {
  if (item.type === 'video') {
    return (
      <video
        src={item.url}
        poster={item.poster ?? undefined}
        controls
        playsInline
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        preload="metadata"
        onContextMenu={(event) => event.preventDefault()}
        aria-label={item.alt}
        className={cn(
          'size-full bg-black',
          contain ? 'object-contain' : 'object-cover',
          className
        )}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- R2 / arbitrary product URLs
    <img
      src={item.url}
      alt={item.alt}
      width={960}
      height={960}
      draggable={false}
      decoding="async"
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      className={cn(
        'size-full select-none',
        contain ? 'object-contain' : 'object-cover',
        className
      )}
    />
  );
}
