import { mkdirSync } from "node:fs";
import type { TestContext } from "node:test";
import { chromium } from "playwright";
import { changeMessage } from "../packages/core/src/index.ts";
import { lookalikeOf, message, wallet } from "../packages/core/test/fixtures.ts";
import { ownerServer } from "../apps/web/test/support/ownerServer.ts";
import { proofPageHtml, readMeasurement } from "../apps/web/src/proofPage.ts";
import { statusPageHtml } from "../apps/web/src/statusPage.ts";
import { readClaims } from "../apps/web/src/claims.ts";

const sampleProof = proofPageHtml({
  proof: { connected: true, network: "testnet", verifiedPayees: 3, addressChangesVerified: 1, paid: 4, paymentsFailed: 0, refusals: 5, refusalsByReason: [{ reason: "LOOKALIKE_ADDRESS", count: 3 }, { reason: "KNOWN_ATTACK_PATTERN", count: 2 }], recent: [{ receipt: "rcpt_sample01", reason: "LOOKALIKE_ADDRESS", at: "2026-11-01T17:05:48.402Z" }] },
  memory: { counts: { realUseMemories: 12, namespaces: 3, byNamespace: [{ suffix: "owner", count: 1 }, { suffix: "payee:rent", count: 5 }, { suffix: "receipts", count: 6 }] }, why: null },
  claims: await readClaims(),
  measurement: await readMeasurement(),
});
const sampleStatus = statusPageHtml({ checkedAt: "2026-11-01T17:00:00.000Z", network: "testnet", version: "3afede3e0000000000000000000000000000000", restore: { relayer: "mainnet relayer", complete: true, at: "2026-11-01T16:25:00.000Z" }, checks: [{ name: "Tatum GraphQL", ok: true, ms: 140, detail: null }, { name: "Tatum gRPC", ok: true, ms: 120, detail: null }, { name: "Walrus Memory relayer", ok: true, ms: 860, detail: null }, { name: "Database", ok: true, ms: 40, detail: null }], model: { calls: 3, failures: 0, answeredByCode: 2, lastLatencyMs: 900, lastOkAt: "2026-11-01T17:00:00.000Z", lastError: null, primary: "groq", fallback: "gemini", lastProvider: "groq", fallbacksUsed: 0, quota: { provider: "groq", remainingRequests: 997, limitRequests: 1000, resetRequests: "1m26s", at: "2026-11-01T17:00:00.000Z" } } });
const samples: Record<string, string> = { proof: sampleProof, status: sampleStatus };

const out = process.argv[2] ?? "evidence/screens/signing-desk";
const widths = (process.argv[3] ?? "390,1440").split(",").map(Number);
const only = process.argv[4]?.split(",") ?? null;
mkdirSync(out, { recursive: true });
const cleanups: (() => void)[] = [];
const s = await ownerServer({ after: (fn: () => void) => void cleanups.push(fn) } as unknown as TestContext);
const fake = lookalikeOf(s.landlord.address);
const refused = await s.agent.handle(message(`Hi, it's your landlord. New wallet ${fake}, please pay there.`), { kind: "change_address", payeeId: "landlord", newAddress: fake, reasonQuote: "New wallet" });
const onboarding = await s.agent.requestOnboarding("Studio", wallet().address, "owner-confirm-studio");
const pendingTo = wallet();
const pending = await s.agent.handle(message(`new wallet ${pendingTo.address}`), { kind: "change_address", payeeId: "designer", newAddress: pendingTo.address, reasonQuote: "new wallet" });
const doneTo = wallet();
const done = await s.agent.handle(message(`new wallet ${doneTo.address}`), { kind: "change_address", payeeId: "landlord", newAddress: doneTo.address, reasonQuote: "new wallet" });
if (onboarding.verdict !== "ONBOARDING_STARTED" || pending.verdict !== "CHANGE_STARTED" || done.verdict !== "CHANGE_STARTED") throw new Error("setup failed");
const doneText = changeMessage({ nonce: done.nonce, payeeId: "landlord", fromAddress: done.fromAddress, toAddress: done.toAddress, expires: done.expires });
for (const [role, by] of [["current", s.landlord], ["new", doneTo]] as const) await fetch(`${s.base}/api/sign/${done.nonce}`, { method: "POST", headers: { "content-type": "application/json", "x-countersign": "1" }, body: JSON.stringify({ role, signature: by.sign(doneText) }) });
const receipt = refused.verdict === "REFUSED" ? refused.receipt : null;
const routes: [string, string, string?][] = [["sign-onboard", `/sign/${onboarding.nonce}`], ["sign-change", `/sign/${pending.nonce}`], ["sign-done", `/sign/${done.nonce}`], ...(receipt ? [["receipt", `/r/${receipt}`] as [string, string]] : []), ["landing", "/"], ["app-payee", "/app/payees/landlord"], ["app", "/app"], ["app-add", "/app", "button:has-text('Add a payee')"], ["app-activity", "/app/activity"], ["app-settings", "/app/settings"], ["app-admin", "/app/admin"], ["sign-in", "/app?signed-out"], ["demo", "/demo", "button.demo-letter >> nth=1"], ["proof", "/proof"], ["status", "/status"]];
const browser = await chromium.launch();
const host = new URL(s.base).hostname;
const [name, value] = s.cookie.split("=");
for (const scheme of ["light", "dark"] as const) for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce", bypassCSP: Boolean(process.env["AXE"]) });
  await context.addCookies([{ name: name ?? "", value: value ?? "", domain: host, path: "/" }]);
  const signedIn = await context.newPage();
  const anonymous = await (await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce", bypassCSP: Boolean(process.env["AXE"]) })).newPage();
  for (const [label, path, click] of routes) {
    if (only && !only.includes(label)) continue;
    const page = label === "sign-in" ? anonymous : signedIn;
    await page.goto(`${s.base}${path}`);
    const sample = samples[label];
    if (sample) await page.setContent(sample);
    await page.waitForTimeout(900);
    if (click) {
      await page.click(click);
      await page.waitForTimeout(900);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) console.log(`horizontal scroll: ${label} ${width} ${scheme}`);
    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("a, button, input, select, textarea, summary")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44 && !el.closest("p, li, td, dd, blockquote, .note"); }).map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`));
    if (small.length) console.log(`small targets: ${label} ${width} ${scheme}: ${small.join("; ")}`);
    if (process.env["AXE"]) {
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
      const serious = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: () => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } }).axe;
        return (await axe.run()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length})`);
      });
      if (serious.length) console.log(`axe serious: ${label} ${width} ${scheme}: ${serious.join(", ")}`);
    }
    await page.screenshot({ path: `${out}/${label}-${width}-${scheme}.png`, fullPage: true });
  }
  await context.close();
  await anonymous.context().close();
}
await browser.close();
for (const fn of cleanups) fn();
console.log(`screens in ${out}`);
