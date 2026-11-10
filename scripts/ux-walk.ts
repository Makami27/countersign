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
  const refuse = (what: string) => {
    const flags = window as unknown as { refuseOnce?: string };
    if (flags.refuseOnce !== what) return;
    flags.refuseOnce = "";
    throw new Error("User closed the wallet window");
  };
  const wallet = {
    version: "1.0.0", name: "Test wallet", icon: "data:image/svg+xml;base64,", chains: ["sui:testnet"], accounts: [] as unknown[],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { refuse("connect"); return { accounts: [account] }; } },
      "standard:events": { version: "1.0.0", on: () => () => undefined },
      "sui:signPersonalMessage": { version: "1.1.0", signPersonalMessage: async ({ message }: { message: Uint8Array }) => (refuse("sign"), { bytes: "", signature: await (window as unknown as { fakeSign: (m: string) => Promise<string> }).fakeSign(new TextDecoder().decode(message)) }) },
      "sui:signAndExecuteTransaction": { version: "2.0.0", signAndExecuteTransaction: async () => (refuse("deposit"), { digest: "5Wg1fYqJ8sV4nK2mR7tP9xB3cD6eH1jL4oQ8uZ2aN5rT", effects: "", bytes: "", signature: "" }) },
    },
  };
  window.addEventListener("wallet-standard:app-ready", (event) => (event as unknown as { detail: { register: (w: unknown) => void } }).detail.register(wallet));
};

const problems: string[] = [];
function note(problem: string): void {
  problems.push(problem);
  console.log(`PROBLEM ${problem}`);
}

const RAW_CODE = /\b[A-Z]{2,}(?:_[A-Z]+)+\b|\b(?:PAID|FAILED|SETTLED|REFUSED|UNKNOWN|STATED|VERIFIED|RESERVED|SENDING|SENT|CONFIRMED|NOT_FOUND|KNOWN)\b/;

async function shot(page: Page, name: string, width: number, scheme: string): Promise<void> {
  await page.waitForTimeout(250);
  const raw = await page.evaluate((pattern) => {
    const skip = ".demo-letter, .message, .stamp, .moment-stamp, script, style, details:not([open])";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      if (node.parentElement?.closest(skip) || !(node.parentElement?.offsetParent ?? node.parentElement?.closest("dialog[open]"))) continue;
      const match = new RegExp(pattern).exec(text);
      if (match) found.push(match[0]);
    }
    return found;
  }, RAW_CODE.source);
  if (raw.length) note(`raw code on screen ${name} ${width} ${scheme}: ${[...new Set(raw)].join(", ")}`);
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

const ACTIVITY_NOW = "2026-11-05T23:30:00Z";
const receiptAt = (at: string, receipt: string) => ({ kind: "receipt", at, receipt, verdict: "PAID", reason: null, payeeId: "landlord", address: `0x${"ab".repeat(32)}`, amountBaseUnits: "100000", suiDigest: "DIGEST1", network: "testnet" });
const ACTIVITY_ITEMS = [
  ...Array.from({ length: 14 }, (_, i) => receiptAt(`2026-11-05T23:${String(15 - i).padStart(2, "0")}:00Z`, `rcpt_late${i}`)),
  receiptAt("2026-11-05T22:45:00Z", "rcpt_before"),
  ...Array.from({ length: 12 }, (_, i) => receiptAt(`2026-11-04T1${i % 10}:05:00Z`, `rcpt_yday${i}`)),
  receiptAt("2026-11-02T14:32:00Z", "rcpt_older"),
  receiptAt("2025-12-30T08:01:00Z", "rcpt_lastyear"),
];

async function activityChecks(width: number, scheme: "light" | "dark"): Promise<void> {
  const expected: Record<string, { readonly headings: readonly string[]; readonly firstTime: string }> = {
    "Africa/Lagos": { headings: ["Today", "Yesterday", "Wed 4 Nov", "Mon 2 Nov", "Tue 30 Dec 2025"], firstTime: "00:15" },
    "Pacific/Auckland": { headings: ["Today", "Yesterday", "Wed 4 Nov", "Tue 3 Nov", "Tue 30 Dec 2025"], firstTime: "12:15" },
  };
  for (const [timezoneId, want] of Object.entries(expected)) {
    const ctx = await browser.newContext({ viewport: { width, height: 700 }, colorScheme: scheme, reducedMotion: "reduce", timezoneId });
    const [name, value] = s.cookie.split("=");
    await ctx.addCookies([{ name: name ?? "", value: value ?? "", domain: "127.0.0.1", path: "/" }]);
    const page = await ctx.newPage();
    await page.clock.setFixedTime(ACTIVITY_NOW);
    await page.route("**/api/app/activity", (route) => route.fulfill({ json: { items: ACTIVITY_ITEMS } }));
    await page.goto(`${s.base}/app/activity`);
    await page.waitForSelector(".day-heading");
    const headings = await page.locator(".day-heading").allTextContents();
    if (JSON.stringify(headings) !== JSON.stringify(want.headings)) note(`activity headings ${timezoneId}: ${headings.join(", ")}`);
    const first = (await page.locator(".day-group .meta").first().textContent()) ?? "";
    if (!first.startsWith(want.firstTime)) note(`first time ${timezoneId}: ${first}`);
    if (await page.locator(".day-group .meta a[href^='/r/rcpt_']").count() !== ACTIVITY_ITEMS.length) note("an entry lost its receipt link");
    const firstRow = (await page.locator(".day-group li").first().textContent()) ?? "";
    const landlord = ((await (await page.request.get(`${s.base}/api/app/payees`)).json()) as { payees: { id: string; name: string }[] }).payees.find((p) => p.id === "landlord")?.name ?? "";
    if (!landlord || !firstRow.includes(`Payee: ${landlord}.`)) note(`activity row doesn't name the payee: ${firstRow}`);
    if (/rcpt_|DIGEST1/.test(firstRow) || !/, Receipt, Transaction, testnet$/.test(firstRow.trim())) note(`activity row shows raw ids or lost its links: ${firstRow}`);
    if (await page.locator(".day-group .meta a[href='https://suiscan.xyz/testnet/tx/DIGEST1']").count() !== ACTIVITY_ITEMS.length) note("an entry lost its Suiscan link");
    if (timezoneId === "Africa/Lagos") {
      await shot(page, "activity", width, scheme);
      await page.evaluate(() => document.querySelectorAll(".day-group li")[8]?.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(100);
      const stuck = await page.evaluate(() => {
        const top = Math.max(0, document.querySelector("#main-col")?.getBoundingClientRect().top ?? 0);
        return [...document.querySelectorAll<HTMLElement>(".day-heading")].filter((el) => Math.abs(el.getBoundingClientRect().top - top) < 1).map((el) => el.textContent);
      });
      if (stuck.length !== 1) note(`sticky heading ${width}: ${stuck.join(", ") || "none at the top"}`);
      await shot(page, "activity-scrolled", width, scheme);
    }
    await ctx.close();
  }
}

async function shellChecks(page: Page, width: number, scheme: string): Promise<void> {
  const layout = await page.evaluate(() => {
    const side = document.querySelector<HTMLElement>(".side");
    const main = document.querySelector<HTMLElement>("#main-col");
    const nav = document.querySelector<HTMLElement>("#nav");
    const scrolls = (el: HTMLElement | null) => (el ? getComputedStyle(el).overflowY === "auto" : false);
    return { side: scrolls(side), main: scrolls(main), page: document.documentElement.scrollHeight > window.innerHeight + 1, navFixed: nav ? getComputedStyle(nav).position === "fixed" : false, band: Boolean(document.querySelector(".wallet-panel")) };
  });
  if (layout.band) note("the old wallet panel is back");
  const wallet = await page.evaluate(() => ({ inSidebar: Boolean(document.querySelector(".side .balance-band.main, .side .wallet-block")), shown: [...document.querySelectorAll<HTMLElement>(".balance-band")].filter((el) => el.offsetParent !== null).map((el) => (el.closest("#main-col") ? "main" : "side")), bars: getComputedStyle(document.querySelector(".side") as Element).scrollbarWidth }));
  if (wallet.inSidebar || wallet.shown.length !== 1 || wallet.shown[0] !== (width >= 960 ? "main" : "side")) note(`balance band in the wrong place at ${width}: ${wallet.shown.join(",")}`);
  if (wallet.bars !== "none") note(`sidebar scrollbar shows at ${width}`);
  if (width >= 960 && !(layout.side && layout.main && !layout.page)) note(`sidebar and main don't scroll on their own at ${width} ${scheme}`);
  if (width < 960 && !layout.navFixed) note(`no bottom tab bar at ${width} ${scheme}`);
  const order = await page.evaluate(() => {
    const focusables = [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary")].filter((el) => el.offsetParent !== null || el.classList.contains("skip"));
    const firstMain = focusables.findIndex((el) => el.closest("#main-col"));
    const lastSide = focusables.map((el) => Boolean(el.closest(".side"))).lastIndexOf(true);
    return { firstMain, lastSide, second: focusables[1]?.closest(".side-top") ? "wordmark" : (focusables[1]?.textContent ?? "").trim().slice(0, 30) };
  });
  if (order.second !== "wordmark") note(`focus after the skip link isn't the wordmark at ${width}: ${order.second}`);
  if (order.lastSide > order.firstMain && order.firstMain >= 0) note(`main comes before the sidebar in focus order at ${width}`);
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
  await visitor.goto(`${s.base}/app`);
  await visitor.waitForSelector("button:has-text('Continue with Slush')");
  if (!(await visitor.locator("main").textContent())?.includes("You can use your Google account. No crypto experience needed.")) note("the line under Continue with Slush");
  if (await visitor.locator("text=×").count()) note("the signing line still shows ×");
  if (await visitor.locator("text=Your session ended").count()) note("a visitor with no cookie was told their session ended");
  if (!(await visitor.locator("h1").textContent())?.includes("Sign in or create your agent")) note("sign-in heading");
  if (!(await visitor.locator("main").textContent())?.includes("Slush not available where you are? Use another Sui wallet.")) note("the line under the buttons");
  await shot(visitor, "sign-in", width, scheme);
  await visitor.click("button:has-text('Use another Sui wallet')");
  await shot(visitor, "sign-in-other", width, scheme);
  if (await visitor.locator("button:has-text('Sign in with Slush')").count()) note("the chooser still offers Slush on the web");
  await visitor.evaluate(() => { (window as unknown as { refuseOnce: string }).refuseOnce = "connect"; });
  await visitor.click("button:has-text('Sign in with Test wallet')");
  await visitor.waitForSelector("text=Couldn't connect to your wallet. Nothing was signed. Try again.");
  await visitor.click("button:has-text('Sign in with Test wallet')");
  await visitor.waitForSelector("button:has-text('Finish signing in')");
  await shot(visitor, "sign-in-finish", width, scheme);
  await visitor.evaluate(() => { (window as unknown as { refuseOnce: string }).refuseOnce = "sign"; });
  await visitor.click("button:has-text('Finish signing in')");
  await visitor.waitForSelector("text=You didn't approve the sign-in, so nothing changed. Click Finish signing in to try again.");
  await visitor.click("button:has-text('Finish signing in')");
  await visitor.waitForSelector(".moment");
  await visitor.context().close();

  const stale = await (await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" })).newPage();
  await stale.context().addCookies([{ name: "cs_owner", value: "expired-or-made-up", domain: "127.0.0.1", path: "/" }]);
  await stale.goto(`${s.base}/app`);
  await stale.waitForSelector("text=Your session ended. Sign in again to continue.");
  await shot(stale, "sign-in-session-ended", width, scheme);
  await stale.context().close();

  const lonely = await (await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" })).newPage();
  await lonely.goto(`${s.base}/app/login?other`);
  await lonely.waitForSelector("text=No other Sui wallet found in this browser. Install one, for example Phantom or Suiet, then reload.");
  if (await lonely.locator(".no-other-wallet a[href='https://phantom.com/'], .no-other-wallet a[href='https://suiet.app/']").count() !== 2) note("the no-wallet line lost its links");
  await shot(lonely, "sign-in-no-wallet", width, scheme);
  await lonely.context().close();

  await page.goto(`${s.base}/app`);
  await page.waitForSelector(".balance-band:visible");
  await page.waitForTimeout(500);
  await shot(page, "app", width, scheme);
  await shellChecks(page, width, scheme);

  await page.click(".balance-band:visible button:has-text('Deposit')");
  await shot(page, "deposit-amounts", width, scheme);
  await page.fill("#deposit-usdc", "5");
  await page.fill("#deposit-sui", "0.25");
  await page.click("dialog button[type=submit]");
  await page.waitForSelector("dialog button:has-text('Connect your wallet')");
  await shot(page, "deposit-connect", width, scheme);
  await page.click("dialog button:has-text('Connect your wallet')");
  await page.waitForSelector("dialog button:has-text('Sign in Test wallet')");
  await shot(page, "deposit-review", width, scheme);
  await page.evaluate(() => { (window as unknown as { refuseOnce: string }).refuseOnce = "deposit"; });
  await page.click("dialog button:has-text('Sign in Test wallet')");
  await page.waitForSelector("text=The wallet didn't send the deposit. Nothing was sent. Try again from Deposit.");
  await page.click("dialog button:has-text('Sign in Test wallet')");
  await page.waitForFunction(() => document.querySelector("dialog")?.textContent?.includes("Deposit confirmed"));
  if (!(await page.locator(".moment").count())) note(`no moment after a deposit ${width} ${scheme}`);
  await shot(page, "deposit-done", width, scheme);
  await closeSheet(page);

  await page.locator(".cheque-pay:visible, .pay-actions .btn.primary:visible").first().click();
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
  await page.click(".schedule-toggle");
  const row = (await page.locator(".schedule-panel .rows li").first().textContent()) ?? "";
  if (!/0\.10 USDC\. Runs on the 1st of every month at 00:00 UTC \(\d\d:\d\d( the day (before|after))? your time\)\./.test(row)) note(`schedule row reads: ${row}`);
  if (!/Next run [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d\d:\d\d your time\./.test(row)) note(`next run isn't a 24-hour local time: ${row}`);
  await shot(page, "schedule-row", width, scheme);
  await page.click(".schedule-toggle");

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
  if (await page.locator(".side-top [data-sound]").count()) note("the header still has a sound toggle");
  await page.goto(`${s.base}/app/settings`);
  const toggle = page.locator("[data-sound]");
  await toggle.waitFor();
  await toggle.click();
  if ((await toggle.textContent()) !== "Sounds: off") note("sound toggle didn't switch");
  await page.reload();
  await toggle.waitFor();
  if ((await toggle.textContent()) !== "Sounds: off") note("mute wasn't remembered");
  await toggle.click();
  await shot(page, "settings", width, scheme);
  await page.click("button:has-text('Save limits')");
  if (!(await page.getByText("Saved. New limits apply from the next payment.").waitFor({ timeout: 3000 }).then(() => true, () => false))) note(`settings saved without saying so ${width} ${scheme}`);

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
  await page.getByRole("button", { name: "Add a payee" }).click();
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

  await activityChecks(width, scheme);

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
  if (width < 960) await page.click(".demo-tabs button:has-text('Activity')");
  await page.waitForSelector(".day-heading");
  if ((await page.locator(".day-heading").first().textContent()) !== "Today") note("demo activity isn't under Today");
  if (!/\d\d:\d\d$/.test((await page.locator(".day-group .meta").first().textContent()) ?? "")) note("demo activity has no 24-hour time");
  await shot(page, "demo-activity", width, scheme);
  await ctx.close();
}
await browser.close();
for (const fn of cleanups) fn();
console.log(problems.length === 0 ? "walk clean" : `${problems.length} problems`);
process.exit(problems.length === 0 ? 0 : 1);
