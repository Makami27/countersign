import { THEME_COLOR, rememberTheme, themeAction, themeCookie, type Theme, type ThemeStore } from "./themeChoice.ts";

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

function draw(control: HTMLElement, theme: Theme): void {
  const dark = theme === "dark" ? "true" : "false";
  if (control.getAttribute("role") === "switch") return control.setAttribute("aria-checked", dark);
  control.setAttribute("aria-pressed", dark);
  control.setAttribute("aria-label", themeAction(theme));
}

function show(theme: Theme): void {
  if (theme === "dark") document.documentElement.dataset["theme"] = "dark";
  else delete document.documentElement.dataset["theme"];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  for (const control of document.querySelectorAll<HTMLElement>("[data-theme-toggle]")) draw(control, theme);
}

export function wireThemeToggle(control: HTMLElement): void {
  control.addEventListener("click", () => {
    const next: Theme = shownTheme() === "dark" ? "light" : "dark";
    rememberTheme(store(), next);
    tellServer(next);
    show(next);
    draw(control, next);
  });
  draw(control, shownTheme());
  tellServer(shownTheme());
}

export function themeSwitch(): HTMLButtonElement {
  const control = document.createElement("button");
  control.className = "theme-switch";
  control.type = "button";
  control.setAttribute("role", "switch");
  control.setAttribute("data-theme-toggle", "");
  const label = document.createElement("span");
  label.textContent = "Dark mode";
  const track = document.createElement("span");
  track.className = "track";
  track.setAttribute("aria-hidden", "true");
  const knob = document.createElement("span");
  knob.className = "knob";
  track.append(knob);
  control.append(label, track);
  wireThemeToggle(control);
  return control;
}
