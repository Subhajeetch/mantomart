'use client';

import { ThemeProvider } from 'next-themes';
import { type ReactNode } from 'react';

import {
  DEFAULT_THEME,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  THEMES,
} from '@/lib/theme';

/**
 * App-wide theme context (next-themes).
 *
 * FOUC prevention also depends on `ThemeInitScript` in the root layout <head>
 * — do not remove one without the other.
 */
export function TailwindThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute={THEME_ATTRIBUTE}
      defaultTheme={DEFAULT_THEME}
      enableSystem
      enableColorScheme
      storageKey={THEME_STORAGE_KEY}
      themes={[...THEMES]}
      // Avoid animating CSS variables during the client theme apply (looks like a flash).
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
