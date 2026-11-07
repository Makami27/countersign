import { mkdirSync } from "node:fs";
import type { TestContext } from "node:test";
import { chromium, type BrowserContext, type Page } from "playwright";
import { PaymentRunner } from "../packages/adapters/src/payments/runner.ts";
import { lookalikeOf, message, wallet } from "../packages/core/test/fixtures.ts";
import { ScriptedChain } from "../apps/web/test/support/scheduleWorld.ts";
import { ownerServer } from "../apps/web/test/support/ownerServer.ts";

const out = process.argv[2] ?? "evidence/screens/signing-desk/ux";
const widths = (process.argv[3] ?? "390,1440").split(",").map(Number);
const schemes = (process.argv[4] ?? "light,dark").split(",") as ("light" | "dark")[];
mkdirSync(out, { recursive: true });

const cleanups: (() => void)[] = [];
async function seeded() {
  const s = await ownerServer({ after: (fn: () => void) => void cleanups.push(fn) } as unknown as TestContext);
  const world = s.owner as unknown as Record<string, unknown>;
  const runner = new PaymentRunner({ ledger: s.payments, chain: new ScriptedChain(), clock: { now: () => new Date() }, sleep: async () => undefined });
  world["balances"] = async () => ({ status: "KNOWN", usdcBaseUnits: 12_500_000n, suiBaseUnits: 421_000_000n });
  world["sendPayment"] = async (id: string) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const payment = await runner.send(id);
    await s.agent.recordPaymentOutcome(payment);
    return payment;
  };
  await s.agent.requestOnboarding("Flat 4B rent with a long name for squeezing", wallet().address, "owner-confirm-studio");
  const fake = lookalikeOf(s.designer.address);
  await s.agent.handle(message(`new wallet ${fake}`), { kind: "change_address", payeeId: "designer", newAddress: fake, reasonQuote: "new wallet" });
  const later = wallet();
  await s.agent.handle(message(`new wallet ${later.address}`), { kind: "change_address", payeeId: "landlord", newAddress: later.address, reasonQuote: "new wallet" });
  return s;
}

let s = await seeded();

const FAKE_WALLET = (address: string) => {
  const account = { address, publicKey: new Uint8Array(32), chains: ["sui:testnet"], features: ["sui:signPersonalMessage", "sui:signAndExecuteTransaction"] };
  const wallet = {
    version: "1.0.0", name: "Test wallet", icon: "data:image/svg+xml;base64,", chains: ["sui:testnet"], accounts: [] as unknown[],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "standard:events": { version: "1.0.0", on: () => () => undefined },
      "sui:signPersonalMessage": { version: "1.1.0", signPersonalMessage: async ({ message }: { message: Uint8Array }) => ({ bytes: "", signature: await (window as unknown as { fakeSign: (m: string) => Promise<string> }).fakeSign(new TextDecoder().decode(message)) }) },
      "sui:signAndExecuteTransaction": { version: "2.0.0", signAndExecuteTransaction: async () => ({ digest: "5Wg1fYqJ8sV4nK2mR7tP9xB3cD6eH1jL4oQ8uZ2aN5rT", effects: "", bytes: "", signature: "" }) },
    },
  };
  window.addEventListener("wallet-standard:app-ready", (event) => (event as unknown as { detail: { register: (w: unknown) => void } }).detail.register(wallet));
};

const problems: string[] = [];
function note(problem: string): void {
  problems.push(problem);
  console.log(`PROBLEM ${problem}`);
}

async function shot(page: Page, name: string, width: number, scheme: string): Promise<void> {
  await page.waitForTimeout(250);
  const sideways = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    const page = document.documentElement.scrollWidth > window.innerWidth;
    const inside = dialog ? dialog.scrollWidth > dialog.clientWidth : false;
    return { page, inside };
  });
  if (sideways.page) note(`page scrolls sideways: ${name} ${width} ${scheme}`);
  if (sideways.inside) note(`sheet scrolls sideways: ${name} ${width} ${scheme}`);
  await page.screenshot({ path: `${out}/${name}-${width}-${scheme}.png` });
}

async function closeSheet(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
}

async function context(width: number, scheme: "light" | "dark"): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
  const [name, value] = s.cookie.split("=");
  await ctx.addCookies([{ name: name ?? "", value: value ?? "", domain: "127.0.0.1", path: "/" }]);
  await ctx.exposeFunction("fakeSign", (text: string) => s.me.sign(text));
  await ctx.addInitScript(FAKE_WALLET, s.me.address);
  return ctx;
}

async function sweepColumns(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  await page.route("**/api/app/payees", (route) => (route.request().method() === "GET" ? route.fulfill({ json: { payees: [] } }) : route.continue()));
  for (const route of ["/app", "/app/settings"]) {
    await page.goto(`${s.base}${route}`);
    await page.waitForSelector(".facts");
    for (let width = 320; width <= 1920; width += 40) {
      await page.setViewportSize({ width, height: 800 });
      const squeezed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main dd, main p, main li, main dt")].filter((el) => {
        const text = el.textContent?.trim() ?? "";
        return text.includes(" ") && el.clientWidth > 0 && el.clientWidth < 150;
      }).map((el) => `${el.clientWidth}px "${(el.textContent ?? "").trim().slice(0, 40)}"`));
      if (squeezed.length) note(`squeezed text at ${width} on ${route}: ${squeezed.join("; ")}`);
    }
  }
  await page.close();
}

const browser = await chromium.launch();
const sweep = await context(1440, "light");
await sweepColumns(sweep);
await sweep.close();
for (const scheme of schemes) for (const width of widths) {
  s = await seeded();
  const ctx = await context(width, scheme);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => note(`page error ${width} ${scheme}: ${error.message}`));
  const visitor = await (await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" })).newPage();
  await visitor.context().exposeFunction("fakeSign", (text: string) => s.me.sign(text));
  await visitor.addInitScript(FAKE_WALLET, s.me.address);
  await visitor.goto(`${s.base}/app/login`);
  await visitor.waitForSelector("button:has-text('Continue with Google')");
  await shot(visitor, "sign-in", width, scheme);
  await visitor.click("button:has-text('Use another Sui wallet')");
  await shot(visitor, "sign-in-other", width, scheme);
  await visitor.click("button:has-text('Sign in with Test wallet')");
  await visitor.waitForSelector("button:has-text('Finish signing in')");
  await shot(visitor, "sign-in-finish", width, scheme);
  await visitor.click("button:has-text('Finish signing in')");
  await visitor.waitForSelector(".moment");
  await visitor.context().close();

  await page.goto(`${s.base}/app`);
  await page.waitForSelector(".wallet-panel");
  await page.waitForTimeout(500);
  await shot(page, "app", width, scheme);

  await page.click("button:has-text('Deposit from your wallet')");
  await shot(page, "deposit-amounts", width, scheme);
  await page.fill("#deposit-usdc", "5");
  await page.fill("#deposit-sui", "0.25");
  await page.click("dialog button[type=submit]");
  await page.waitForSelector("dialog button:has-text('Connect your wallet')");
  await shot(page, "deposit-connect", width, scheme);
  await page.click("dialog button:has-text('Connect your wallet')");
  await page.waitForSelector("dialog button:has-text('Sign in Test wallet')");
  await shot(page, "deposit-review", width, scheme);
  await page.click("dialog button:has-text('Sign in Test wallet')");
  await page.waitForFunction(() => document.querySelector("dialog")?.textContent?.includes("Deposit confirmed"));
  if (!(await page.locator(".moment").count())) note(`no moment after a deposit ${width} ${scheme}`);
  await shot(page, "deposit-done", width, scheme);
  await closeSheet(page);

  await page.click(".cheque-pay >> nth=0");
  await shot(page, "pay-amount", width, scheme);
  await page.fill("#amount", "99");
  await page.click("dialog button[type=submit]");
  await shot(page, "pay-amount-error", width, scheme);
  await page.click("dialog .amounts .btn >> nth=1");
  await shot(page, "pay-confirm", width, scheme);
  await page.click("dialog .btn.primary");
  await page.waitForSelector("dialog .pay-steps");
  await shot(page, "pay-progress", width, scheme);
  await page.waitForSelector(".moment");
  await shot(page, "moment", width, scheme);
  await page.waitForFunction(() => document.querySelector("dialog")?.textContent?.includes("View the receipt"), undefined, { timeout: 30_000 });
  await shot(page, "pay-settled", width, scheme);
  await closeSheet(page);

  await page.goto(`${s.base}/app/payees/landlord`);
  await page.waitForSelector(".pay-actions");
  await page.waitForTimeout(400);
  await shot(page, "app-payee", width, scheme);

  if (await page.locator(".schedule-panel").isVisible()) note("schedules open by default");
  await page.click(".schedule-toggle");
  await page.click("button:has-text('Schedule a payment')");
  await page.fill("#schedule-amount", "0.10");
  await shot(page, "schedule-open", width, scheme);
  await page.click(".schedule-panel form button[type=submit]");
  await page.waitForSelector("button:has-text('Connect your wallet')");
  await page.click("button:has-text('Connect your wallet')");
  await page.waitForSelector("button:has-text('Sign with your wallet')");
  await page.click("button:has-text('Sign with your wallet')");
  await page.waitForSelector(".moment");
  await page.waitForTimeout(500);
  await page.waitForSelector(".schedule-toggle");
  if (await page.locator(".schedule-panel").isVisible()) note("schedules stayed open after creating one");
  await shot(page, "schedule-created", width, scheme);

  const fullAddress = await page.locator(".payto .addr").getAttribute("title");
  await page.click(".payto button:has-text('Copy address')");
  await page.waitForTimeout(100);
  if ((await page.evaluate(() => navigator.clipboard.readText())) !== fullAddress) note(`copy button pasted something else ${width} ${scheme}`);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".payto .addr") as Node);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand("copy");
  });
  await page.waitForTimeout(100);
  if ((await page.evaluate(() => navigator.clipboard.readText())) !== fullAddress) note(`selecting and copying pasted something else ${width} ${scheme}`);
  const toggle = page.locator(".sound-toggle");
  await toggle.click();
  if ((await toggle.textContent()) !== "Sound off") note("sound toggle didn't switch");
  await page.reload();
  await page.waitForSelector(".pay-actions");
  if ((await page.locator(".sound-toggle").textContent()) !== "Sound off") note("mute wasn't remembered");
  await page.locator(".sound-toggle").click();

  await page.goto(`${s.base}/app/payees/designer`);
  await page.waitForSelector(".pay-actions");
  await page.click("button:has-text('Request an address change')");
  await shot(page, "change-request", width, scheme);
  await page.fill("#new-address", wallet().address);
  await page.click("dialog button[type=submit]");
  await page.waitForSelector("dialog .link-text");
  await shot(page, "change-link", width, scheme);
  await closeSheet(page);
  await page.waitForTimeout(600);
  await page.click("button:has-text('I confirm this change myself')");
  await shot(page, "change-confirm", width, scheme);
  await closeSheet(page);

  await page.goto(`${s.base}/app`);
  await page.click(".cheque-link:has-text('Flat 4B')");
  await page.waitForSelector(".detail .link-text");
  await page.waitForTimeout(300);
  await shot(page, "app-waiting", width, scheme);

  await page.goto(`${s.base}/app`);
  await page.waitForSelector("button:has-text('Add a payee')");
  await page.click("button:has-text('Add a payee')");
  await shot(page, "add-payee", width, scheme);
  await page.fill("#payee-name", `Studio ${width}${scheme}`);
  await page.fill("#payee-address", wallet().address);
  await page.click("dialog button[type=submit]");
  await page.waitForSelector("dialog button:has-text('Connect your wallet')");
  await page.click("dialog button:has-text('Connect your wallet')");
  await page.waitForSelector("dialog button:has-text('Sign with your wallet')");
  await page.click("dialog button:has-text('Sign with your wallet')");
  await page.waitForSelector("dialog .link-text");
  await shot(page, "add-payee-link", width, scheme);
  await closeSheet(page);

  await page.route("**/api/app/payees", (route) => (route.request().method() === "GET" ? route.fulfill({ json: { payees: [] } }) : route.continue()));
  await page.goto(`${s.base}/app`);
  await page.waitForSelector(".facts");
  await page.waitForTimeout(300);
  await shot(page, "app-first-run", width, scheme);
  await page.unroute("**/api/app/payees");

  await page.goto(`${s.base}/demo`);
  await page.waitForSelector("#own-letter");
  await page.waitForTimeout(400);
  await shot(page, "demo", width, scheme);
  await page.fill("#own-letter", "pay rent to landlord");
  await page.click("form button[type=submit]");
  await page.waitForSelector("text=How much should I pay Landlord?");
  await shot(page, "demo-ask", width, scheme);
  await page.click(".amounts .btn >> nth=1");
  await shot(page, "demo-preview", width, scheme);
  await ctx.close();
}
await browser.close();
for (const fn of cleanups) fn();
console.log(problems.length === 0 ? "walk clean" : `${problems.length} problems`);
process.exit(problems.length === 0 ? 0 : 1);
