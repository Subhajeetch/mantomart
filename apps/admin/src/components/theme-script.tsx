import {
  DEFAULT_THEME,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  THEMES,
} from '@/lib/theme';

/**
 * Blocking pre-paint theme bootstrap.
 *
 * next-themes injects a similar script from inside a client component in
 * <body>. With App Router streaming / React 19, that script can run after the
 * first paint — so the page briefly shows :root (light) CSS before .dark is
 * applied. This script lives in the root layout <head> and runs before paint.
 *
 * Logic mirrors next-themes' internal init (storage → system resolve → class
 * + color-scheme on <html>).
 */
export function ThemeInitScript() {
  // Keep arguments aligned with ThemeProvider configuration.
  const attribute = THEME_ATTRIBUTE;
  const storageKey = THEME_STORAGE_KEY;
  const defaultTheme = DEFAULT_THEME;
  const themes = JSON.stringify([...THEMES]);
  const enableSystem = true;
  const enableColorScheme = true;

  const script = `(function(){
  try {
    var storageKey = ${JSON.stringify(storageKey)};
    var defaultTheme = ${JSON.stringify(defaultTheme)};
    var attribute = ${JSON.stringify(attribute)};
    var themes = ${themes};
    var enableSystem = ${enableSystem};
    var enableColorScheme = ${enableColorScheme};
    var el = document.documentElement;
    var stored = null;
    try { stored = localStorage.getItem(storageKey); } catch (e) {}
    var theme = stored || defaultTheme;
    var resolved = theme;
    if (enableSystem && theme === "system") {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    if (attribute === "class") {
      el.classList.remove.apply(el.classList, themes);
      el.classList.add(resolved);
    } else {
      el.setAttribute(attribute, resolved);
    }
    if (enableColorScheme && (resolved === "dark" || resolved === "light")) {
      el.style.colorScheme = resolved;
    }
  } catch (e) {}
})();`;

  return (
    <script
      id="admin-theme-init"
      // Runs as soon as the parser hits this tag in <head>, before body paint.
      dangerouslySetInnerHTML={{ __html: script }}
      suppressHydrationWarning
    />
  );
}
