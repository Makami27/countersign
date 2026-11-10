import { themed } from "./themed.ts";
import type { TestContext } from "node:test";
import { chromium } from "playwright";
import { multiOwnerServer } from "../apps/web/test/support/multiOwner.ts";
import { signInAs } from "../apps/web/test/support/signIn.ts";

const out = process.argv[2] ?? "evidence/screens/discord";
const cleanups: (() => void)[] = [];
const t = { after: (fn: () => void) => void cleanups.push(fn) } as unknown as TestContext;
const s = await multiOwnerServer(t);
const { cookie } = await signInAs(s.base, s.admin);
await s.discordLinks.dmRefused("admin1", "Owner wallet change requested.");
const browser = await chromium.launch();
for (const [width, scheme] of [[390, "light"], [1440, "dark"]] as const) {
  const ctx = await themed(await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" }), scheme, s.base);
  const [name, value] = cookie.split("=");
  await ctx.addCookies([{ name: name ?? "", value: value ?? "", domain: "127.0.0.1", path: "/" }]);
  const page = await ctx.newPage();
  await page.goto(`${s.base}/app/settings`);
  await page.waitForSelector("#discord-title");
  await page.click("button:has-text('Connect Discord')");
  await page.waitForSelector("#discord-title ~ .link-text:not([hidden])");
  if ((await page.locator("button:has-text('Make a new code')").count()) !== 1) console.log("button kept its first label");
  await page.locator("section[aria-labelledby=discord-title]").screenshot({ path: `${out}/discord-panel-${width}-${scheme}.png` });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (wide) console.log(`sideways scroll at ${width}`);
  await page.goto(`${s.base}/app/activity`);
  await page.waitForSelector(".day-group");
  await page.locator(".day-group").first().screenshot({ path: `${out}/discord-notice-${width}-${scheme}.png` });
  await ctx.close();
}
await browser.close();
for (const fn of cleanups) fn();
console.log("done");
