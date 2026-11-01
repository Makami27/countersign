import { mkdirSync } from "node:fs";
import type { TestContext } from "node:test";
import { chromium } from "playwright";
import { lookalikeOf, message } from "../packages/core/test/fixtures.ts";
import { ownerServer } from "../apps/web/test/support/ownerServer.ts";

const out = process.argv[2] ?? "evidence/screens/signing-desk";
const widths = (process.argv[3] ?? "390,1440").split(",").map(Number);
const only = process.argv[4]?.split(",") ?? null;
mkdirSync(out, { recursive: true });
const cleanups: (() => void)[] = [];
const s = await ownerServer({ after: (fn: () => void) => void cleanups.push(fn) } as unknown as TestContext);
const fake = lookalikeOf(s.landlord.address);
await s.agent.handle(message(`Hi, it's your landlord. New wallet ${fake}, please pay there.`), { kind: "change_address", payeeId: "landlord", newAddress: fake, reasonQuote: "New wallet" });
const routes: [string, string][] = [["landing", "/"], ["app-payee", "/app/payees/landlord"], ["app", "/app"], ["demo", "/demo"], ["proof", "/proof"], ["status", "/status"]];
const browser = await chromium.launch();
const host = new URL(s.base).hostname;
const [name, value] = s.cookie.split("=");
for (const scheme of ["light", "dark"] as const) for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
  await context.addCookies([{ name: name ?? "", value: value ?? "", domain: host, path: "/" }]);
  const page = await context.newPage();
  for (const [label, path] of routes) {
    if (only && !only.includes(label)) continue;
    await page.goto(`${s.base}${path}`);
    await page.waitForTimeout(900);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) console.log(`horizontal scroll: ${label} ${width} ${scheme}`);
    await page.screenshot({ path: `${out}/${label}-${width}-${scheme}.png`, fullPage: true });
  }
  await context.close();
}
await browser.close();
for (const fn of cleanups) fn();
console.log(`screens in ${out}`);
