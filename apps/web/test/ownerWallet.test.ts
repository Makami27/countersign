import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { message, wallet } from "../../../packages/core/test/fixtures.ts";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { ownerNamespace } from "@countersign/core";
import { OwnerWallets, OWNER_WALLET_WAIT_MS } from "../src/ownerWallet.ts";
import { ownerServer as setup, type Challenge } from "./support/ownerServer.ts";

test("V20 V23 adding a payee needs the owner wallet registered at sign-in: it asks for a signature, rejects another wallet, and can't be replayed", async (t) => {
  const s = await setup(t);
  const me = s.me;
  const payee = { name: "Plumber", address: wallet().address };
  assert.ok(s.extras.notices.some((n) => n.startsWith("Owner wallet registered by signing in")));
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
  const me = s.me;
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
  const me = s.me;
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
  const [first, second, third] = [s.me, wallet(), wallet()];
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
  const me = s.me;
  const freshRows = new SqliteRows(join(mkdtempSync(join(tmpdir(), "countersign-owner-")), "empty.sqlite"));
  const restored = await OwnerWallets.open({ rows: freshRows, memory: s.memory, signer: s.signer, ownerId: "owner1", now: Date.now });
  assert.equal(restored.current(), me.address);
  s.memory.dropOnRead = ownerNamespace("owner1");
  const blind = await OwnerWallets.open({ rows: new SqliteRows(join(mkdtempSync(join(tmpdir(), "countersign-owner-")), "blind.sqlite")), memory: s.memory, signer: s.signer, ownerId: "owner1", now: Date.now });
  assert.equal(blind.state().known, false);
  assert.equal(blind.current(), null);
});
