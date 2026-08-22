import type { CSSProperties } from "react";

import type { PromoSlideTheme } from "../types";

export type SlideThemeVars = {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  ctaFg: string;
  pattern: string;
};

export const SLIDE_THEMES: Record<PromoSlideTheme, SlideThemeVars> = {
  primary: {
    bg: "var(--primary)",
    fg: "var(--primary-foreground)",
    muted: "color-mix(in oklch, var(--primary-foreground) 78%, transparent)",
    accent: "var(--foreground)",
    ctaFg: "var(--background)",
    pattern: "color-mix(in oklch, var(--primary-foreground) 16%, transparent)",
  },
  warm: {
    bg: "oklch(0.64 0.12 48)",
    fg: "oklch(0.99 0.02 95)",
    muted: "oklch(0.99 0.02 95 / 0.78)",
    accent: "oklch(0.28 0.06 45)",
    ctaFg: "oklch(0.99 0.02 95)",
    pattern: "oklch(1 0 0 / 0.14)",
  },
  cool: {
    bg: "oklch(0.52 0.10 264)",
    fg: "oklch(0.99 0 0)",
    muted: "oklch(0.99 0 0 / 0.78)",
    accent: "oklch(0.22 0.05 264)",
    ctaFg: "oklch(0.99 0 0)",
    pattern: "oklch(1 0 0 / 0.16)",
  },
  forest: {
    bg: "oklch(0.48 0.07 155)",
    fg: "oklch(0.98 0.02 155)",
    muted: "oklch(0.98 0.02 155 / 0.78)",
    accent: "oklch(0.22 0.04 155)",
    ctaFg: "oklch(0.98 0.02 155)",
    pattern: "oklch(1 0 0 / 0.14)",
  },
  sunset: {
    bg: "oklch(0.74 0.11 42)",
    fg: "oklch(0.22 0.05 40)",
    muted: "oklch(0.22 0.05 40 / 0.72)",
    accent: "oklch(0.28 0.08 35)",
    ctaFg: "oklch(0.99 0.02 95)",
    pattern: "oklch(1 0 0 / 0.20)",
  },
  slate: {
    bg: "oklch(0.40 0.03 250)",
    fg: "oklch(0.98 0 0)",
    muted: "oklch(0.98 0 0 / 0.75)",
    accent: "oklch(0.18 0.02 250)",
    ctaFg: "oklch(0.98 0 0)",
    pattern: "oklch(1 0 0 / 0.12)",
  },
};

export function slideThemeStyle(theme: PromoSlideTheme): CSSProperties {
  const vars = SLIDE_THEMES[theme] ?? SLIDE_THEMES.primary;
  return {
    backgroundColor: vars.bg,
    color: vars.fg,
    ["--slide-bg" as string]: vars.bg,
    ["--slide-fg" as string]: vars.fg,
    ["--slide-muted" as string]: vars.muted,
    ["--slide-accent" as string]: vars.accent,
    ["--slide-cta-fg" as string]: vars.ctaFg,
    ["--slide-pattern" as string]: vars.pattern,
  };
}
