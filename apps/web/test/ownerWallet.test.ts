import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DEFAULT_CAPS, message, wallet, world, type TestWallet } from "../../../packages/core/test/fixtures.ts";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { ownerNamespace } from "@countersign/core";
import { startWebServer } from "../src/server.ts";
import { OwnerAuth } from "../src/ownerAuth.ts";
import { OwnerSettings } from "../src/ownerSettings.ts";
import { ChangeSteps } from "../src/changeSteps.ts";
import { OwnerWallets, OWNER_WALLET_WAIT_MS } from "../src/ownerWallet.ts";
import type { OwnerContext } from "../src/ownerContext.ts";
import { ownerExtras } from "./support/ownerExtras.ts";

type Challenge = { field: string; nonce: string; message: string; signer: string };

async function setup(t: TestContext) {
  const w = await world(DEFAULT_CAPS, new Date().toISOString());
  let now = Date.now();
  const rows = new SqliteRows(join(mkdtempSync(join(tmpdir(), "countersign-owner-")), "web.sqlite"));
  const auth = await OwnerAuth.open(rows);
  const extras = await ownerExtras(rows, w, () => now);
  const owner: OwnerContext = {
    ownerId: "owner1", network: "testnet", agentAddress: wallet().address, publicUrl: "https://example.test", engine: w.agent, index: w.index, ledger: w.payments, auth,
    settings: await OwnerSettings.open(rows, { perPaymentBaseUnits: 50_000_000n, perDayBaseUnits: 100_000_000n, cooldownSeconds: 0 }),
    balances: async () => ({ status: "UNKNOWN", detail: "test" }), memory: () => ({ relayer: "sandbox (not Walrus Memory)", restored: true, restoredAt: null, legacyRecords: 0, ignoredRecords: 0 }),
    memoryCounts: async () => null, sendPayment: async () => assert.fail("no payments here"), steps: await ChangeSteps.open(rows), cooldownMs: () => 0,
    verifySignature: (m, s, a) => w.signatures.verifyPersonalMessage(m, s, a), ...extras,
  };
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owner });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json", "x-countersign": "1" }, body: JSON.stringify({ code: await auth.issueCode() }) });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const call = async (method: string, path: string, body: Record<string, unknown>) => {
    const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-countersign": "1", cookie }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const signedBy = async (method: string, path: string, body: Record<string, unknown>, signers: readonly TestWallet[]) => {
    const first = await call(method, path, body);
    if (first.status !== 428) return first;
    const approvals: Record<string, { nonce: string; signature: string }> = {};
    for (const c of first.body["approvals"] as Challenge[]) {
      const by = signers.find((s) => s.address === c.signer) ?? signers[0];
      if (!by) throw new Error("no signer");
      approvals[c.field] = { nonce: c.nonce, signature: by.sign(c.message) };
    }
    return call(method, path, { ...body, approvals });
  };
  return { ...w, owner, rows, extras, call, signedBy, advance: (ms: number) => void (now += ms) };
}

test("V20 adding a payee needs the owner wallet: refused before one is registered, registration sends a Telegram notice, asks for a signature, rejects another wallet, and can't be replayed", async (t) => {
  const s = await setup(t);
  const me = wallet();
  const payee = { name: "Plumber", address: wallet().address };
  assert.equal((await s.call("POST", "/api/app/payees", payee)).status, 409);
  assert.equal((await s.signedBy("POST", "/api/app/owner/wallet", { address: me.address }, [me])).status, 200);
  assert.ok(s.extras.notices.some((n) => n.startsWith("Owner wallet registered")));
  const asked = await s.call("POST", "/api/app/payees", payee);
  assert.equal(asked.status, 428);
  assert.match((asked.body["approvals"] as Challenge[])[0]?.message ?? "", /action:add_payee\nmeaning:add a payee\naddress:0x[0-9a-f]{64}\nname:Plumber/);
  assert.deepEqual(await s.index.payeeVersions("plumber"), []);
  const stranger = wallet();
  const forged = await s.signedBy("POST", "/api/app/payees", payee, [stranger]);
  assert.equal(forged.status, 403);
  assert.equal((forged.body["approval"] as { problem: string }).problem, "WRONG_WALLET");
  assert.deepEqual(await s.index.payeeVersions("plumber"), []);
  const challenge = (await s.call("POST", "/api/app/payees", payee)).body["approvals"] as Challenge[];
  const approvals = { owner: { nonce: challenge[0]?.nonce ?? "", signature: me.sign(challenge[0]?.message ?? "") } };
  assert.equal((await s.call("POST", "/api/app/payees", { ...payee, approvals })).status, 200);
  assert.equal((await s.index.payeeVersions("plumber")).length, 1);
  const replay = await s.call("POST", "/api/app/payees", { name: "Other", address: wallet().address, approvals });
  assert.equal(replay.status, 403);
  assert.ok(s.extras.notices.some((n) => n.includes("Payee \"Plumber\" was added")));
});

test("V20 loosening limits needs the owner wallet; tightening them doesn't; both send a Telegram notice", async (t) => {
  const s = await setup(t);
  const me = wallet();
  await s.signedBy("POST", "/api/app/owner/wallet", { address: me.address }, [me]);
  assert.equal((await s.call("PUT", "/api/app/settings", { perPaymentBaseUnits: "10000000", perDayBaseUnits: "20000000", cooldownSeconds: "3600" })).status, 200);
  const raise = { perPaymentBaseUnits: "60000000", perDayBaseUnits: "200000000", cooldownSeconds: "3600" };
  assert.equal((await s.call("PUT", "/api/app/settings", raise)).status, 428);
  assert.equal(s.owner.settings.values().perPaymentBaseUnits, 10_000_000n);
  assert.equal((await s.call("PUT", "/api/app/settings", { ...raise, perPaymentBaseUnits: "10000000", perDayBaseUnits: "20000000", cooldownSeconds: "0" })).status, 428);
  assert.equal((await s.signedBy("PUT", "/api/app/settings", raise, [me])).status, 200);
  assert.equal(s.owner.settings.values().perPaymentBaseUnits, 60_000_000n);
  assert.equal(s.extras.notices.filter((n) => n.startsWith("Limits changed")).length, 2);
});

test("V20 V12 confirming an address change yourself needs the owner wallet's signature, not a Telegram code", async (t) => {
  const s = await setup(t);
  const me = wallet();
  await s.signedBy("POST", "/api/app/owner/wallet", { address: me.address }, [me]);
  const next = wallet();
  const started = await s.agent.handle(message(`new wallet ${next.address}`), { kind: "change_address", payeeId: "landlord", newAddress: next.address, reasonQuote: "x" });
  if (started.verdict !== "CHANGE_STARTED") return assert.fail("expected a change");
  const unsigned = await s.call("POST", `/api/app/changes/${started.nonce}/confirm`, { code: "ABCDE-FGH23" });
  assert.equal(unsigned.status, 428);
  assert.equal((await s.owner.steps.progress(started.nonce)).owner, null);
  assert.equal((await s.signedBy("POST", `/api/app/changes/${started.nonce}/confirm`, {}, [me])).status, 200);
  assert.ok((await s.owner.steps.progress(started.nonce)).owner);
});

test("V20 replacing the owner wallet: the old wallet's signature switches now; without it the change waits 72 h, can be cancelled by the old wallet, and notices go out", async (t) => {
  const s = await setup(t);
  const [first, second, third] = [wallet(), wallet(), wallet()];
  await s.signedBy("POST", "/api/app/owner/wallet", { address: first.address }, [first]);
  assert.equal((await s.signedBy("POST", "/api/app/owner/wallet", { address: second.address }, [second, third])).status, 403);
  assert.equal(s.owner.wallets.current(), first.address);
  assert.equal((await s.signedBy("POST", "/api/app/owner/wallet", { address: second.address }, [second, first])).status, 200);
  assert.equal(s.owner.wallets.current(), second.address);
  assert.equal((await s.signedBy("POST", "/api/app/owner/wallet", { address: third.address, waitInstead: true }, [third])).status, 202);
  assert.ok(s.extras.notices.some((n) => n.startsWith("Warning: someone signed in")));
  assert.equal((await s.signedBy("POST", "/api/app/owner/wallet/cancel", {}, [third])).status, 403);
  s.advance(OWNER_WALLET_WAIT_MS - 1000);
  assert.equal(await s.owner.wallets.applyDue(), null);
  s.advance(2000);
  assert.equal((await s.owner.wallets.applyDue())?.address, third.address);
  assert.equal(s.owner.wallets.current(), third.address);
  assert.equal((await s.signedBy("POST", "/api/app/owner/wallet", { address: first.address, waitInstead: true }, [first])).status, 202);
  assert.equal((await s.signedBy("POST", "/api/app/owner/wallet/cancel", {}, [third])).status, 200);
  s.advance(OWNER_WALLET_WAIT_MS + 1000);
  assert.equal(await s.owner.wallets.applyDue(), null);
  assert.equal(s.owner.wallets.current(), third.address);
});

test("V20 V18 the owner wallet comes back from Walrus Memory on an empty database, and an unreadable memory blocks registration instead of reopening it", async (t) => {
  const s = await setup(t);
  const me = wallet();
  await s.signedBy("POST", "/api/app/owner/wallet", { address: me.address }, [me]);
  const freshRows = new SqliteRows(join(mkdtempSync(join(tmpdir(), "countersign-owner-")), "empty.sqlite"));
  const restored = await OwnerWallets.open({ rows: freshRows, memory: s.memory, signer: s.signer, ownerId: "owner1", now: Date.now });
  assert.equal(restored.current(), me.address);
  s.memory.dropOnRead = ownerNamespace("owner1");
  const blind = await OwnerWallets.open({ rows: new SqliteRows(join(mkdtempSync(join(tmpdir(), "countersign-owner-")), "blind.sqlite")), memory: s.memory, signer: s.signer, ownerId: "owner1", now: Date.now });
  assert.equal(blind.state().known, false);
  assert.equal(blind.current(), null);
});
