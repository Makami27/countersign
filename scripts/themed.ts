import type { BrowserContext, Page } from "playwright";

export async function themed<T extends BrowserContext | Page>(target: T, theme: string, base: string): Promise<T> {
  const context = "context" in target ? target.context() : target;
  await context.addCookies([{ name: "cs_theme", value: theme, url: base }]);
  await target.addInitScript((chosen) => {
    try {
      window.localStorage.setItem("countersign:theme", chosen);
    } catch {
      return;
    }
  }, theme);
  return target;
}
