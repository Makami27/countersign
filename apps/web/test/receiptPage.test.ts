import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { ONE_USDC, lookalikeOf, message, world } from "../../../packages/core/test/fixtures.ts";
import { startWebServer } from "../src/server.ts";
import type { OwnerContext } from "../src/ownerContext.ts";
import type { OwnerDirectory } from "../src/ownerDirectory.ts";

async function serve(t: TestContext) {
  const w = await world();
  const owner = { index: w.index, memory: () => ({ relayer: "mainnet relayer", restored: true, restoredAt: null, legacyRecords: 0, ignoredRecords: 0 }) } as unknown as OwnerContext;
  const owners = { adminOwnerId: "owner1", all: () => [{ ctx: owner }], get: () => owner } as unknown as OwnerDirectory;
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owners });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { ...w, get: async (path: string) => { const r = await fetch(`${base}${path}`); return { status: r.status, text: await r.text(), csp: r.headers.get("content-security-policy") }; } };
}

function refusalOf(outcome: { verdict: string; receipt?: string }): string {
  if (outcome.verdict !== "REFUSED" || !outcome.receipt) throw new Error(`expected a refusal, got ${outcome.verdict}`);
  return outcome.receipt;
}

test("V14 a look-alike refusal's receipt page says no money moved, compares the addresses with a VOID stamp, lists the checks in order and has no transaction", async (t) => {
  const w = await serve(t);
  const fake = lookalikeOf(w.landlord.address);
  const receipt = refusalOf(await w.agent.handle(message(`Landlord: new wallet ${fake}`), { kind: "change_address", payeeId: "landlord", newAddress: fake, reasonQuote: "new wallet" }));
  const page = await w.get(`/r/${receipt}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Refused/);
  assert.match(page.text, /No money moved and nothing was changed\./);
  assert.match(page.text, />VOID</);
  assert.match(page.text, /class="g diff"/);
  assert.match(page.text, /No transaction: nothing was sent\./);
  const order = ["Address appears word for word", "Payee has exactly one verified address", "Never refused before", "Doesn&#39;t imitate an address on file"].map((words) => page.text.indexOf(words));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > (order[n - 1] ?? 0))), `checks out of order: ${order.join(",")}`);
  assert.match(page.text, /Failed<\/span> Doesn&#39;t imitate an address on file/);
  assert.match(page.text, /aggregator\.walrus-mainnet\.walrus\.space\/v1\/blobs\//);
  assert.match(page.text, /Sui testnet: test USDC, no real money\./);
  assert.match(page.csp ?? "", /script-src 'self'/);
  assert.doesNotMatch(page.text, /<script/);
});

test("V14 C04 the receipt for a repeated attack links to the first refusal's receipt", async (t) => {
  const w = await serve(t);
  const fake = lookalikeOf(w.landlord.address);
  const proposal = { kind: "change_address", payeeId: "landlord", newAddress: fake, reasonQuote: "new wallet" } as const;
  const first = refusalOf(await w.agent.handle(message(`new wallet ${fake}`), proposal));
  const second = refusalOf(await w.agent.handle(message(`new wallet ${fake}`), proposal));
  const page = await w.get(`/r/${second}`);
  assert.match(page.text, /matches an earlier refused attempt/);
  assert.ok(page.text.includes(`href="/r/${first}"`));
});

test("V14 a paid receipt names the amount and network, and links the Sui transaction", async (t) => {
  const w = await serve(t);
  const reserved = await w.agent.handle(message("pay rent"), { kind: "pay", payeeId: "landlord", amountBaseUnits: ONE_USDC, reasonQuote: "pay rent" });
  assert.equal(reserved.verdict, "PAY_RESERVED");
  if (reserved.verdict !== "PAY_RESERVED") return;
  await w.payments.movePayment(reserved.paymentId, { to: "SENDING", at: "2026-10-30T10:00:01Z", detail: null, digest: "DIGESTPAID1", validUntilEpoch: "100" });
  await w.payments.movePayment(reserved.paymentId, { to: "SENT", at: "2026-10-30T10:00:02Z", detail: null });
  await w.payments.movePayment(reserved.paymentId, { to: "SETTLED", at: "2026-10-30T10:00:03Z", detail: "credited" });
  const written = await w.agent.recordPaymentOutcome((await w.payments.payment(reserved.paymentId)) ?? assert.fail("no payment"));
  const page = await w.get(`/r/${written?.receipt ?? ""}`);
  assert.match(page.text, /1\.00 test USDC was paid to Landlord on Sui testnet\./);
  assert.match(page.text, /href="https:\/\/suiscan\.xyz\/testnet\/tx\/DIGESTPAID1"/);
  assert.match(page.text, /Payee record it relied on/);
});

test("V14 an unknown or malformed receipt id is a 404 page, never another receipt", async (t) => {
  const w = await serve(t);
  assert.equal((await w.get("/r/rcpt_doesnotexist")).status, 404);
  const odd = await w.get("/r/%3Cscript%3E");
  assert.equal(odd.status, 404);
  assert.doesNotMatch(odd.text, /<script>/);
});
