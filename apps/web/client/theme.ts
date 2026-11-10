import { THEME_COLOR, rememberTheme, themeCookie, themeLabel, type Theme, type ThemeStore } from "./themeChoice.ts";

function store(): ThemeStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function tellServer(theme: Theme): void {
  try {
    document.cookie = themeCookie(theme);
  } catch {
    return;
  }
}

function shownTheme(): Theme {
  return document.documentElement.dataset["theme"] === "dark" ? "dark" : "light";
}

function draw(button: HTMLElement, theme: Theme): void {
  button.textContent = themeLabel(theme);
  button.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
}

function show(theme: Theme): void {
  if (theme === "dark") document.documentElement.dataset["theme"] = "dark";
  else delete document.documentElement.dataset["theme"];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  for (const button of document.querySelectorAll<HTMLElement>("[data-theme-toggle]")) draw(button, theme);
}

export function wireThemeToggle(button: HTMLElement): void {
  button.addEventListener("click", () => {
    const next: Theme = shownTheme() === "dark" ? "light" : "dark";
    rememberTheme(store(), next);
    tellServer(next);
    show(next);
    draw(button, next);
  });
  draw(button, shownTheme());
  tellServer(shownTheme());
}

export function themeToggle(look: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = look;
  button.type = "button";
  button.setAttribute("data-theme-toggle", "");
  wireThemeToggle(button);
  return button;
}
