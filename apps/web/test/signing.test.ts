import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { changeMessage, type Outcome } from "@countersign/core";
import { DEFAULT_CAPS, message, wallet, world } from "../../../packages/core/test/fixtures.ts";
import { startWebServer } from "../src/server.ts";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { OwnerAuth } from "../src/ownerAuth.ts";
import { OwnerSettings } from "../src/ownerSettings.ts";
import { ChangeSteps } from "../src/changeSteps.ts";
import { tryCompleteChange } from "../src/changeCompletion.ts";
import type { OwnerContext } from "../src/ownerContext.ts";
import { ownerExtras } from "./support/ownerExtras.ts";

async function setup(t: TestContext, start = new Date().toISOString(), cooldownSeconds = 0) {
  const w = await world(DEFAULT_CAPS, start, cooldownSeconds * 1000);
  const path = join(mkdtempSync(join(tmpdir(), "countersign-sign-")), "web.sqlite");
  const rows = new SqliteRows(path);
  const settings = await OwnerSettings.open(rows, { perPaymentBaseUnits: 50_000_000n, perDayBaseUnits: 100_000_000n, cooldownSeconds });
  const owner: OwnerContext = {
    ownerId: "owner1", network: "testnet", agentAddress: wallet().address, publicUrl: null, engine: w.agent, index: w.index, ledger: w.payments, auth: await OwnerAuth.open(rows), settings,
    balances: async () => ({ status: "UNKNOWN", detail: "test" }), memory: () => ({ relayer: "sandbox (not Walrus Memory)", restored: true, restoredAt: null, legacyRecords: 0, ignoredRecords: 0 }),
    memoryCounts: async () => null, sendPayment: async () => assert.fail("no payments here"), steps: await ChangeSteps.open(rows), cooldownMs: () => w.deps.cooldownMs,
    verifySignature: (m, s, a) => w.signatures.verifyPersonalMessage(m, s, a),
    ...(await ownerExtras(rows, w)),
  };
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owner });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { ...w, owner, server, base };
}

async function startChange(agent: OwnerContext["engine"], to: ReturnType<typeof wallet>) {
  const outcome: Outcome = await agent.handle(message(`new wallet ${to.address}`), { kind: "change_address", payeeId: "landlord", newAddress: to.address, reasonQuote: "x" });
  if (outcome.verdict !== "CHANGE_STARTED") throw new Error(`expected CHANGE_STARTED, got ${outcome.verdict}`);
  return { ...outcome, text: changeMessage({ nonce: outcome.nonce, payeeId: "landlord", fromAddress: outcome.fromAddress, toAddress: outcome.toAddress, expires: outcome.expires }) };
}

const post = (base: string, nonce: string, body: unknown) => fetch(`${base}/api/sign/${nonce}`, { method: "POST", headers: { "content-type": "application/json", "x-countersign": "1" }, body: JSON.stringify(body) });

test("V11 the payee signs the change with the current wallet, then the new one, and the next payment goes to the new wallet", async (t) => {
  const { agent, landlord, server, base } = await setup(t);
  const next = wallet();
  const change = await startChange(agent, next);
  const view = (await (await fetch(`${base}/api/sign/${change.nonce}`)).json()) as { kind: string; message: string; steps: { current: unknown } };
  assert.equal(view.kind, "change");
  assert.equal(view.message, change.text);
  const first = (await (await post(base, change.nonce, { role: "current", signature: landlord.sign(change.text) })).json()) as { completion: { state: string; waitingFor: string } };
  assert.deepEqual([first.completion.state, first.completion.waitingFor], ["WAITING", "new_wallet"]);
  const second = (await (await post(base, change.nonce, { role: "new", signature: next.sign(change.text) })).json()) as { completion: { state: string; outcome: Outcome } };
  assert.equal(second.completion.state, "COMPLETED");
  assert.equal(second.completion.outcome.verdict, "CHANGE_VERIFIED");
  const paid = await agent.handle(message("pay rent"), { kind: "pay", payeeId: "landlord", amountBaseUnits: "1000000", reasonQuote: "pay" });
  assert.equal(paid.verdict === "PAY_RESERVED" && paid.address, next.address);
});

test("V13 the signing page names a wrong wallet, an unknown link and an expired request, and changes nothing", async (t) => {
  const { agent, base } = await setup(t);
  const change = await startChange(agent, wallet());
  const wrong = await post(base, change.nonce, { role: "current", signature: wallet().sign(change.text) });
  assert.equal(wrong.status, 422);
  assert.equal(((await wrong.json()) as { refusal: { reason: string } }).refusal.reason, "WRONG_WALLET");
  const unknown = await fetch(`${base}/api/sign/${"0".repeat(32)}`);
  assert.equal(((await unknown.json()) as { refusal: { reason: string } }).refusal.reason, "NONCE_REUSED");
  const old = await setup(t, new Date(Date.now() - 25 * 3600 * 1000).toISOString());
  const stale = await startChange(old.agent, wallet());
  const expired = await post(old.base, stale.nonce, { role: "current", signature: old.landlord.sign(stale.text) });
  assert.equal(expired.status, 410);
  assert.equal(((await expired.json()) as { refusal: { reason: string } }).refusal.reason, "EXPIRED");
});

test("V12 an owner-confirmed change waits for the cooldown, refuses a current-wallet step, and then needs only the new wallet", async (t) => {
  const waiting = await setup(t, new Date().toISOString(), 3600);
  const next = wallet();
  const change = await startChange(waiting.agent, next);
  await waiting.owner.steps.confirmByOwner(change.nonce, "owner:test", new Date().toISOString());
  assert.equal((await post(waiting.base, change.nonce, { role: "current", signature: waiting.landlord.sign(change.text) })).status, 409);
  const signed = (await (await post(waiting.base, change.nonce, { role: "new", signature: next.sign(change.text) })).json()) as { completion: { state: string; waitingFor: string } };
  assert.deepEqual([signed.completion.state, signed.completion.waitingFor], ["WAITING", "cooldown"]);

  const ready = await setup(t, new Date().toISOString(), 0);
  const later = wallet();
  const quick = await startChange(ready.agent, later);
  await ready.owner.steps.confirmByOwner(quick.nonce, "owner:test", new Date(Date.now() - 1000).toISOString());
  await ready.owner.steps.record(quick.nonce, "new", later.sign(quick.text), new Date().toISOString());
  const done = await tryCompleteChange(ready.owner, quick.nonce, Date.now());
  assert.ok(done.state === "COMPLETED" && done.outcome.verdict === "CHANGE_VERIFIED");
  const head = await ready.agent.payeeHead("landlord");
  assert.ok(head.kind === "verified" && head.version.address === later.address && head.version.evidence.kind === "owner_confirmed_change");
});
