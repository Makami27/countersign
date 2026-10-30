import { mkdirSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { chromium, type Page } from "playwright";
import { OwnerAuth } from "@countersign/web/ownerAuth";

const BASE = process.argv[2] ?? "http://localhost:8788";
const DATABASE = process.argv[3] ?? "";
const OUT = process.argv[4] ?? "evidence/screens/phase2";
const WIDTHS = [["phone", 390], ["desktop", 1440]] as const;
if (!DATABASE) throw new Error("Usage: uiCheck.ts <base url> <database path> [out dir]");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const shots: string[] = [];
const problems: string[] = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`); });

async function shoot(name: string, target: Page = page): Promise<void> {
  for (const [label, width] of WIDTHS) {
    await target.setViewportSize({ width, height: 900 });
    await target.waitForTimeout(250);
    const overflow = Number(await target.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"));
    if (overflow > 0) problems.push(`${name} @${width}: horizontal overflow ${overflow}px`);
    const path = `${OUT}/${name}-${label}.png`;
    await target.screenshot({ path, fullPage: true });
    shots.push(path);
  }
  await target.setViewportSize({ width: 1440, height: 900 });
}

await page.goto(`${BASE}/app`);
await page.waitForURL(`${BASE}/app/login`);
await shoot("01-login");
await page.fill("#code", new OwnerAuth(DATABASE).issueCode());
await page.click("button[type=submit]");
await page.waitForSelector("text=Your agent is ready", { timeout: 30_000 });
await shoot("02-first-run");

const payee = new Ed25519Keypair();
await page.click("text=Add a payee");
await page.fill("#payee-name", "Flat 4B rent (UI test)");
await page.fill("#payee-address", payee.toSuiAddress());
await shoot("03-add-payee-sheet");
await page.click("text=Add and get a signing link");
await page.waitForSelector("text=Added. Nothing can be paid to it yet.", { timeout: 90_000 });
const signUrl = (await page.locator("dialog .addr").first().textContent()) ?? "";
await page.click("text=Done");
await page.waitForSelector(".status.stated");
await page.click(".cheque");
await page.waitForSelector("text=Waiting for the payee's wallet");
await shoot("04-payee-waiting");

const nonce = signUrl.split("/sign/")[1] ?? "";
const signing = (await (await fetch(`${BASE}/api/sign/${nonce}`)).json()) as { message: string };
const { signature } = await payee.signPersonalMessage(new TextEncoder().encode(signing.message));
const signed = await fetch(`${BASE}/api/sign/${nonce}`, { method: "POST", headers: { "content-type": "application/json", "x-countersign": "1" }, body: JSON.stringify({ signature }) });
if (!signed.ok) problems.push(`signing failed: ${signed.status} ${await signed.text()}`);

await page.reload();
await page.waitForSelector(".payto", { timeout: 30_000 });
await shoot("05-payee-verified");
await page.click("text=Pay Flat 4B rent (UI test)");
await page.fill("#amount", "0.01");
await page.click("text=Continue");
await page.waitForSelector("text=Nothing has been sent yet.");
await shoot("06-pay-confirm");
await page.getByRole("button", { name: "Pay 0.01 USDC", exact: true }).click();
await page.waitForSelector("text=/Receipt rcpt_.* is stored|No USDC moved|Not sure yet/", { timeout: 120_000 });
await shoot("07-pay-outcome");
await page.getByRole("button", { name: "Close", exact: true }).click();
await page.goto(`${BASE}/app/activity`);
await page.waitForSelector("#activity-title");
await shoot("08-activity");
await page.goto(`${BASE}/app/settings`);
await page.waitForSelector("#settings-title");
await shoot("09-settings");

await browser.close();
console.log(JSON.stringify({ shots: shots.length, problems }, null, 2));
