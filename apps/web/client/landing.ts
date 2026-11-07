import { countText, sharedSentence, type Live } from "./liveCounts.ts";

const STEP_MS = 380;
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
  const sentence = sharedSentence(live);
  if (shared && sentence) shared.textContent = sentence;
  const wait = LIVE_RETRY_MS[attempt];
  if (wait !== undefined && (typeof live?.memories !== "number" || !sentence)) setTimeout(() => void fillLive(attempt + 1), wait);
}

function replayOnce(): void {
  const replay = document.querySelector<HTMLElement>("[data-replay]");
  if (!replay || matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  const steps = [...replay.querySelectorAll<HTMLElement>("[data-step]")];
  replay.classList.add("pending");
  const watcher = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    watcher.disconnect();
    steps.forEach((step, i) => setTimeout(() => step.classList.add("shown"), 200 + i * STEP_MS));
    setTimeout(() => replay.classList.remove("pending"), 400 + steps.length * STEP_MS);
  }, { threshold: 0.3 });
  watcher.observe(replay);
}

replayOnce();
void fillLive();
