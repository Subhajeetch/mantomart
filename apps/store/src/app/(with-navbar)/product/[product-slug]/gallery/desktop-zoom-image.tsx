'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { cn } from '@/lib/utils';

type DesktopZoomImageProps = {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
};

export function DesktopZoomImage({
  src,
  alt,
  className,
  priority = false,
}: DesktopZoomImageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef<number | null>(null);
  const [origin, setOrigin] = useState('50% 50%');
  const [zooming, setZooming] = useState(false);

  const flush = () => {
    raf.current = null;
    const next = pending.current;
    if (!next) return;
    setOrigin(`${next.x}% ${next.y}%`);
  };

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.min(
      100,
      Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)
    );
    const y = Math.min(
      100,
      Math.max(0, ((event.clientY - rect.top) / rect.height) * 100)
    );
    pending.current = { x, y };
    if (raf.current == null) {
      raf.current = requestAnimationFrame(flush);
    }
  };

  useEffect(() => {
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, []);

  return (
    <div
      ref={frameRef}
      className={cn('size-full overflow-hidden bg-neutral-100', className)}
      onMouseEnter={() => setZooming(true)}
      onMouseLeave={() => {
        setZooming(false);
        setOrigin('50% 50%');
      }}
      onMouseMove={onMove}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- R2 / arbitrary product URLs */}
      <img
        src={src}
        alt={alt}
        width={960}
        height={960}
        draggable={false}
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        className={cn(
          'size-full object-cover will-change-transform select-none',
          zooming ? 'scale-[2.25] cursor-zoom-in' : 'scale-100'
        )}
        style={{
          transformOrigin: origin,
          transition: zooming
            ? 'transform 90ms linear'
            : 'transform 160ms ease',
        }}
      />
    </div>
  );
}
