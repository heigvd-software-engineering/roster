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
    // Which <html> classes each preference means. "terminal" rides on dark:
    // both classes, so `dark:` styles keep working and `.terminal` only
    // re-skins the tokens (app.css). Exhaustive over Theme — a new theme
    // fails to compile until it's mapped here.
    const classesFor = (preference: Theme) => {
      switch (preference) {
        case "light":
          return { dark: false, terminal: false };
        case "dark":
          return { dark: true, terminal: false };
        case "terminal":
          return { dark: true, terminal: true };
        case "system":
          return { dark: media.matches, terminal: false };
      }
    };
    const apply = () => {
      const classes = classesFor(theme);
      document.documentElement.classList.toggle("dark", classes.dark);
      document.documentElement.classList.toggle("terminal", classes.terminal);
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
