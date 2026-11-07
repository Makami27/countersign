import { chromium } from "playwright";

const base = process.argv[2] ?? "https://countersign.nittings.xyz";
const out = process.argv[3] ?? ".";
const browser = await chromium.launch();
let failed = 0;
for (const width of [390, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/app/login`);
  const button = page.locator("button:has-text('Continue with Google')");
  await button.waitFor();
  await page.screenshot({ path: `${out}/sign-in-live-${width}.png` });
  const opened = context.waitForEvent("page", { timeout: 15_000 });
  await button.click();
  const popup = await opened.catch(() => null);
  if (!popup) {
    failed += 1;
    console.log(`${width}: no window opened from the click`);
    continue;
  }
  await popup.waitForTimeout(6_000);
  const url = new URL(popup.url());
  console.log(`${width}: window opened at ${url.origin}${url.pathname}; page errors: ${errors.length}`);
  console.log(`${width}: it says: ${(await popup.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300)}`);
  await popup.screenshot({ path: `${out}/slush-popup-${width}.png` });
  if (url.origin !== "https://my.slush.app") failed += 1;
  await context.close();
}
await browser.close();
process.exit(failed === 0 ? 0 : 1);
