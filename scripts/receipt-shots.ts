import { chromium } from "playwright";
import type { AddressInfo } from "node:net";
import { ONE_USDC, lookalikeOf, message, world } from "../packages/core/test/fixtures.ts";
import { startWebServer } from "../apps/web/src/server.ts";
import type { OwnerContext } from "../apps/web/src/ownerContext.ts";

const out = process.argv[2] ?? "evidence/screens/phase4";
const w = await world();
const owner = { index: w.index, memory: () => ({ relayer: "sandbox (not Walrus Memory)", restored: true, restoredAt: null, legacyRecords: 0, ignoredRecords: 0 }) } as unknown as OwnerContext;
const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owner });
await new Promise<void>((r) => server.once("listening", () => r()));
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
const fake = lookalikeOf(w.landlord.address);
const proposal = { kind: "change_address", payeeId: "landlord", newAddress: fake, reasonQuote: "new wallet" } as const;
const first = await w.agent.handle(message(`new wallet ${fake}`), proposal);
const repeat = await w.agent.handle(message(`new wallet ${fake}`), proposal);
const reserved = await w.agent.handle(message("pay rent"), { kind: "pay", payeeId: "landlord", amountBaseUnits: ONE_USDC, reasonQuote: "pay rent" });
if (first.verdict !== "REFUSED" || repeat.verdict !== "REFUSED" || reserved.verdict !== "PAY_RESERVED") throw new Error("setup failed");
for (const [to, extra] of [["SENDING", { digest: "SANDBOXDIGEST", validUntilEpoch: "100" }], ["SENT", {}], ["SETTLED", {}]] as const) await w.payments.movePayment(reserved.paymentId, { to, at: new Date().toISOString(), detail: null, ...extra });
const settled = await w.payments.payment(reserved.paymentId);
if (!settled) throw new Error("setup failed");
const paid = await w.agent.recordPaymentOutcome(settled);
const browser = await chromium.launch();
const pages: [string, string][] = [["refused", first.receipt], ["repeat", repeat.receipt], ["paid", paid?.receipt ?? ""]];
for (const scheme of ["dark", "light"] as const) for (const width of [360, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
  for (const [name, id] of pages) {
    await page.goto(`${base}/r/${id}`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/receipt-${name}-${width}-${scheme}.png`, fullPage: true });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) console.log(`overflow at ${width} ${scheme}`);
  await page.close();
}
await browser.close();
server.closeAllConnections();
server.close();
console.log("done");
