export const THEME_KEY = "countersign:theme";
export const THEME_COOKIE = "cs_theme";
const THEME_COOKIE_SECONDS = 365 * 24 * 60 * 60;

export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_SECONDS}; SameSite=Lax`;
}
export const THEME_COLOR = { light: "#F6F8FD", dark: "#0F1A3A" } as const;
export type Theme = keyof typeof THEME_COLOR;
export type ThemeStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function readTheme(storage: ThemeStore | null): Theme {
  try {
    return storage?.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function rememberTheme(storage: ThemeStore | null, theme: Theme): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    return;
  }
}

export function themeAction(theme: Theme): string {
  return theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
}
