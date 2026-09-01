'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

type ExpandableProps = {
  children: ReactNode;
  className?: string;
};

export function Expandable({ children, className }: ExpandableProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const check = () => {
      // Hidden tab panels report 0×0; wait until they are visible.
      if (el.clientHeight === 0 && el.scrollHeight === 0) return;
      setOverflows(el.scrollHeight > el.clientHeight + 12);
    };

    check();
    const resize = new ResizeObserver(check);
    resize.observe(el);

    // Specs live in a keepMounted tab, so re-check when the panel is shown.
    const intersect = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) check();
      },
      { threshold: 0 }
    );
    intersect.observe(el);

    return () => {
      resize.disconnect();
      intersect.disconnect();
    };
  }, []);

  const canToggle = overflows || expanded;

  return (
    <div>
      <div className="relative">
        <div
          ref={bodyRef}
          className={cn(className, !expanded && 'max-h-48 overflow-hidden')}
        >
          {children}
        </div>
        {!expanded && canToggle ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent"
            aria-hidden
          />
        ) : null}
      </div>
      {canToggle ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-3 text-sm font-medium underline underline-offset-4"
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      ) : null}
    </div>
  );
}

type ExpandableCopyProps = {
  title: string;
  html: string;
};

export function ExpandableCopy({ title, html }: ExpandableCopyProps) {
  if (!html.trim()) return null;

  return (
    <section>
      {title ? (
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      ) : null}
      <div className={title ? 'mt-3' : undefined}>
        <Expandable className="product-html text-sm leading-relaxed text-foreground/80">
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </Expandable>
      </div>
    </section>
  );
}
