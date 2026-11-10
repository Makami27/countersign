import { countText, sharedLine, type Live } from "./liveCounts.ts";
import { wireThemeToggle } from "./theme.ts";

const STEP_MS = 160;
const LIVE_RETRY_MS = [3_000, 10_000, 30_000];
const LIVE_TIMEOUT_MS = 12_000;

async function readLive(): Promise<Live | undefined> {
  try {
    const response = await fetch("/api/live", { signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) });
    return response.ok ? ((await response.json()) as { live?: Live }).live : undefined;
  } catch {
    return undefined;
  }
}

async function fillLive(attempt = 0): Promise<void> {
  const live = await readLive();
  for (const field of document.querySelectorAll<HTMLElement>("[data-live]")) {
    const value = live?.[field.dataset["live"] as keyof Live];
    if (typeof value === "number") field.textContent = countText(value);
  }
  const shared = document.querySelector<HTMLElement>("[data-shared-line]");
  const line = sharedLine(live);
  if (shared && line) {
    shared.hidden = !line.show;
    if (line.show) shared.textContent = line.text;
  }
  const wait = LIVE_RETRY_MS[attempt];
  if (wait !== undefined && (typeof live?.memories !== "number" || !line)) setTimeout(() => void fillLive(attempt + 1), wait);
}

function replayOnce(): void {
  const replay = document.querySelector<HTMLElement>("[data-replay]");
  if (!replay || matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  const steps = [...replay.querySelectorAll<HTMLElement>("[data-step]")];
  const first = steps[0];
  if (!first || first.getBoundingClientRect().top < window.innerHeight) return;
  replay.classList.add("pending");
  const showAll = () => {
    replay.classList.remove("pending");
    steps.forEach((step) => step.classList.add("shown"));
  };
  const watcher = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    watcher.disconnect();
    if (first.getBoundingClientRect().bottom < 0) return showAll();
    steps.forEach((step, i) => setTimeout(() => step.classList.add("shown"), i * STEP_MS));
    setTimeout(() => replay.classList.remove("pending"), steps.length * STEP_MS + 300);
  }, { threshold: 0.01, rootMargin: "0px 0px -10% 0px" });
  watcher.observe(first);
  watcher.observe(replay);
}

document.querySelectorAll<HTMLElement>("[data-theme-toggle]").forEach(wireThemeToggle);
replayOnce();
void fillLive();
