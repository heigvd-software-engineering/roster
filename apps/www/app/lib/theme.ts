/**
 * Theme preference storage: an explicit "light"/"dark" choice persisted in
 * localStorage, or "system" (nothing stored) which follows the OS setting.
 * These are read/write helpers; applying the class to <html> is
 * ThemeProvider's job (contexts/theme-context.tsx), and the inline script in
 * root.tsx reads the same key before first paint so a stored choice never
 * flashes.
 */
export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

export function getTheme(): Theme {
  // Guarded: the app shell is prerendered at build time (no window there).
  if (typeof localStorage === "undefined") {
    return "system";
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function persistTheme(theme: Theme) {
  if (theme === "system") {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, theme);
  }
}
