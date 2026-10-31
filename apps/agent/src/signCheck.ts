import { mkdirSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { chromium, type Browser } from "playwright";
import { OwnerAuth } from "@countersign/web/ownerAuth";
import { SqliteRows } from "@countersign/adapters/sqlite";

const BASE = process.argv[2] ?? "http://localhost:8788";
const DATABASE = process.argv[3] ?? "";
const OUT = process.argv[4] ?? "evidence/screens/phase3";
if (!DATABASE) throw new Error("Usage: signCheck.ts <base url> <database path> [out dir]");
mkdirSync(OUT, { recursive: true });
const auth = await OwnerAuth.open(new SqliteRows(DATABASE));
const problems: string[] = [];

async function session(): Promise<string> {
  const response = await fetch(`${BASE}/api/session`, { method: "POST", headers: { "content-type": "application/json", "x-countersign": "1" }, body: JSON.stringify({ code: await auth.issueCode() }) });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function call<T>(cookie: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", "x-countersign": "1", cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return (await response.json()) as T;
}

async function shoot(browser: Browser, name: string, url: string, cookie: string | null, waitFor: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    for (const [label, width] of [["phone", 390], ["desktop", 1440]] as const) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
      if (cookie) await context.addCookies([{ name: cookie.split("=")[0] ?? "", value: cookie.split("=").slice(1).join("="), url: BASE }]);
      const page = await context.newPage();
      page.on("console", (m) => { if (m.type() === "error") problems.push(`${name}: ${m.text().slice(0, 160)}`); });
      await page.goto(url);
      await page.waitForSelector(waitFor, { timeout: 30_000 });
      await page.waitForTimeout(600);
      const overflow = Number(await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"));
      if (overflow > 0) problems.push(`${name} ${scheme} @${width}: overflow ${overflow}px`);
      await page.screenshot({ path: `${OUT}/${name}-${label}-${scheme}.png`, fullPage: true });
      await context.close();
    }
  }
}

const browser = await chromium.launch();
const cookie = await session();
const payee = new Ed25519Keypair();
const added = await call<{ signUrl: string; outcome: { nonce: string } }>(cookie, "POST", "/api/app/payees", { name: "Mara Lindqvist, design (UI test)", address: payee.toSuiAddress() });
await shoot(browser, "10-sign-onboarding", `${BASE}/sign/${added.outcome.nonce}`, null, "text=Sign once with this wallet");
const view = await call<{ message: string }>("", "GET", `/api/sign/${added.outcome.nonce}`);
await call("", "POST", `/api/sign/${added.outcome.nonce}`, { signature: (await payee.signPersonalMessage(new TextEncoder().encode(view.message))).signature });

const next = new Ed25519Keypair();
const change = await call<{ signUrl: string; outcome: { nonce: string } }>(cookie, "POST", "/api/app/payees/mara-lindqvist-design-ui-test/changes", { address: next.toSuiAddress() });
await shoot(browser, "11-sign-change-step1", `${BASE}/sign/${change.outcome.nonce}`, null, "text=Two signatures");
const changeView = await call<{ message: string }>("", "GET", `/api/sign/${change.outcome.nonce}`);
await call("", "POST", `/api/sign/${change.outcome.nonce}`, { role: "current", signature: (await payee.signPersonalMessage(new TextEncoder().encode(changeView.message))).signature });
await shoot(browser, "12-sign-change-step2", `${BASE}/sign/${change.outcome.nonce}`, null, "text=Signed");
await shoot(browser, "13-owner-change-pending", `${BASE}/app/payees/mara-lindqvist-design-ui-test`, cookie, "h3:has-text(\"Change waiting for proof\")");
await shoot(browser, "14-sign-unknown-link", `${BASE}/sign/${"0".repeat(32)}`, null, "text=This link can't be used");
await browser.close();
console.log(JSON.stringify({ problems }, null, 2));
