import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getTheme, persistTheme, type Theme } from "~/lib/theme";

type ThemeValue = {
  /** The stored preference — "system" means: follow the OS. */
  theme: Theme;
  /** Persist a preference and apply it immediately. */
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * One source of truth for the color scheme, shared via useTheme(). Keeps the
 * `.dark` class on <html> in sync with the preference and — while on
 * "system" — with live OS changes. First paint is handled by the inline
 * script in root.tsx (React only runs after paint); this provider owns
 * everything from hydration on.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  useEffect(() => {
    // jsdom has no matchMedia; tests never exercise scheme switching.
    if (typeof matchMedia === "undefined") {
      return;
    }
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    if (theme !== "system") {
      return;
    }
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    persistTheme(next);
    setThemeState(next);
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ theme, setTheme }),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return value;
}
