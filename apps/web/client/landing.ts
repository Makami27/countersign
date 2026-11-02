type Live = { readonly memories: number | null; readonly sharedAgents: number | null; readonly sharedReports: number | null };

const STEP_MS = 380;

async function fillLive(): Promise<void> {
  const fields = [...document.querySelectorAll<HTMLElement>("[data-live]")];
  if (fields.length === 0) return;
  const response = await fetch("/api/proof", { credentials: "same-origin" });
  const live = response.ok ? ((await response.json()) as { live?: Live }).live : undefined;
  for (const field of fields) {
    const value = live?.[field.dataset["live"] as keyof Live];
    field.textContent = typeof value === "number" ? String(value) : "—";
  }
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
