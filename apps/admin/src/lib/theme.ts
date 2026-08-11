/**
 * Single source of truth for admin theming (next-themes).
 *
 * Keep these in sync with ThemeProvider props and the pre-paint init script
 * in `theme-script.tsx` — mismatches reintroduce FOUC (flash of wrong theme).
 */

export const THEME_STORAGE_KEY = 'theme' as const;

/** Used when localStorage has no value (first visit). */
export const DEFAULT_THEME = 'dark' as const;

export const THEME_ATTRIBUTE = 'class' as const;

export const THEMES = ['light', 'dark'] as const;

export type ThemeValue = (typeof THEMES)[number] | 'system';

export function isThemeValue(value: string | undefined | null): value is ThemeValue {
  return value === 'light' || value === 'dark' || value === 'system';
}
