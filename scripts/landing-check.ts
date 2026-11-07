import { mkdirSync } from "node:fs";
import type { TestContext } from "node:test";
import { chromium } from "playwright";
import { ownerServer } from "../apps/web/test/support/ownerServer.ts";

const out = process.argv[2] ?? "evidence/screens/signing-desk/ux";
const SWEEP = [960, 1000, 1023, 1024, 1100, 1200, 1280, 1366, 1440, 1920];
const SHOTS = [390, 1024, 1440];
mkdirSync(out, { recursive: true });
const cleanups: (() => void)[] = [];
const s = await ownerServer({ after: (fn: () => void) => void cleanups.push(fn) } as unknown as TestContext);
(s.owner as unknown as Record<string, unknown>)["balances"] = async () => ({ status: "KNOWN", usdcBaseUnits: 12_500_000n, suiBaseUnits: 421_000_000n });
const browser = await chromium.launch();
let problems = 0;
function note(problem: string): void {
  problems += 1;
  console.log(`PROBLEM ${problem}`);
}

const sweepPage = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
await sweepPage.goto(s.base);
for (const width of SWEEP) {
  await sweepPage.setViewportSize({ width, height: 900 });
  const header = await sweepPage.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(".site-bar");
    const parts = [".wordmark", ".site-links", ".site-actions"].map((selector) => bar?.querySelector<HTMLElement>(selector)?.getBoundingClientRect());
    const items = [...(bar?.querySelectorAll<HTMLElement>(".site-links a, .site-actions .btn") ?? [])].filter((el) => el.offsetParent !== null).map((el) => el.getBoundingClientRect());
    const tops = new Set(items.map((r) => Math.round(r.top + r.height / 2)));
    const [mark, links, actions] = parts;
    return {
      height: bar?.offsetHeight ?? 0,
      oneLine: tops.size === 1,
      gapMarkLinks: (links?.left ?? 0) - (mark?.right ?? 0),
      gapLinksActions: (actions?.left ?? 0) - (links?.right ?? 0),
      wide: [...(bar?.querySelectorAll<HTMLElement>(".wide-only") ?? [])].some((el) => el.offsetParent !== null),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  console.log(`${width}: header ${header.height}px, Status and GitHub ${header.wide ? "shown" : "footer only"}, gap wordmark-links ${Math.round(header.gapMarkLinks)}px, links-actions ${Math.round(header.gapLinksActions)}px`);
  if (!header.oneLine) note(`header wraps at ${width}`);
  if (header.gapMarkLinks < 16) note(`links crowd the wordmark at ${width}`);
  if (header.gapLinksActions < 0 || header.gapLinksActions > 24) note(`links aren't directly before the buttons at ${width}`);
  if (header.overflow) note(`page scrolls sideways at ${width}`);
  const hero = await sweepPage.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().top ?? 0;
    return { headline: top(".hero h1"), card: top(".hero-card") };
  });
  if (Math.abs(hero.headline - hero.card) > 4) note(`headline ${Math.round(hero.headline)} and card ${Math.round(hero.card)} don't line up at ${width}`);
}

const retryPage = await (await browser.newContext()).newPage();
let liveCalls = 0;
await retryPage.route("**/api/live", (route) => {
  liveCalls += 1;
  return liveCalls === 1 ? route.abort() : route.fulfill({ json: { live: { memories: 16, sharedAgents: 2, sharedReports: 3 } } });
});
await retryPage.goto(s.base);
await retryPage.waitForFunction(() => document.querySelector("[data-live='memories']")?.textContent === "16", undefined, { timeout: 10_000 }).catch(() => note("the counter didn't recover after a failed fetch"));
if (!(await retryPage.locator("[data-shared-line]").textContent())?.includes("3, from 2 agents")) note("the shared line didn't fill in");
console.log(`counters filled after ${liveCalls} requests, the first one failing`);

for (const scheme of ["light", "dark"] as const) for (const width of SHOTS) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
  const [name, value] = s.cookie.split("=");
  await context.addCookies([{ name: name ?? "", value: value ?? "", domain: "127.0.0.1", path: "/" }]);
  const page = await context.newPage();
  await page.goto(s.base);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/landing-top-${width}-${scheme}.png` });
  await page.goto(`${s.base}/app`);
  await page.waitForSelector(".wallet-panel");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/app-top-${width}-${scheme}.png` });
  await context.close();
}
await browser.close();
for (const fn of cleanups) fn();
console.log(problems === 0 ? "landing clean" : `${problems} problems`);
process.exit(problems === 0 ? 0 : 1);
