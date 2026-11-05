import { countText, sharedSentence, type Live } from "./liveCounts.ts";

const STEP_MS = 380;

async function fillLive(): Promise<void> {
  const fields = [...document.querySelectorAll<HTMLElement>("[data-live]")];
  if (fields.length === 0) return;
  const response = await fetch("/api/proof", { credentials: "same-origin" });
  const live = response.ok ? ((await response.json()) as { live?: Live }).live : undefined;
  for (const field of fields) field.textContent = countText(live?.[field.dataset["live"] as keyof Live]);
  const shared = document.querySelector<HTMLElement>("[data-shared-line]");
  const sentence = sharedSentence(live);
  if (shared && sentence) shared.textContent = sentence;
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
void fillLive().catch(() => undefined);
