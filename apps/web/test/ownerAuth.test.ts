import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownerNamespace } from "@countersign/core";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { wallet } from "../../../packages/core/test/fixtures.ts";
import { OwnerAuth, SIGN_IN_LIFETIME_MS } from "../src/ownerAuth.ts";
import { OwnerSettings } from "../src/ownerSettings.ts";
import { ownerServer } from "./support/ownerServer.ts";
import { signInAs } from "./support/signIn.ts";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "countersign-auth-")), "auth.sqlite");
}

test("V23 the first wallet to sign in becomes the owner wallet with a Telegram notice; it opens the same owner again; any other wallet is refused", async (t) => {
  const s = await ownerServer(t);
  assert.equal(s.owner.wallets.current(), s.me.address);
  assert.equal(s.extras.notices.filter((n) => n.startsWith("Owner wallet registered by signing in")).length, 1);
  assert.equal((await signInAs(s.base, s.me)).status, 200);
  const stranger = await signInAs(s.base, wallet());
  assert.equal(stranger.status, 403);
  assert.equal(stranger.setCookie, "");
  assert.equal(s.owner.wallets.current(), s.me.address);
});

test("V23 a sign-in message names this domain, its nonce works once, and a signature by another wallet or over another message is refused", async (t) => {
  const s = await ownerServer(t);
  const me = s.me;
  const once = await signInAs(s.base, me);
  assert.match(once.challenge.message, /^Countersign sign-in v1\ndomain:example\.test\npurpose:sign in to your Countersign agent\naddress:0x[0-9a-f]{64}\nnonce:[0-9a-f]{32}\nexpires:/);
  const replay = await fetch(`${s.base}/api/session`, { method: "POST", headers: { "content-type": "application/json", "x-countersign": "1" }, body: JSON.stringify({ address: me.address, nonce: once.challenge.nonce, signature: me.sign(once.challenge.message) }) });
  assert.equal(replay.status, 401);
  const other = wallet();
  assert.equal((await signInAs(s.base, me, (m) => other.sign(m))).status, 401);
  assert.equal((await signInAs(s.base, me, (m) => me.sign(m.replace("domain:example.test", "domain:evil.test")))).status, 401);
});

test("V23 V20 unreadable owner-wallet memory blocks sign-in instead of letting a new wallet register", async (t) => {
  const s = await ownerServer(t, { signIn: false });
  s.memory.dropOnRead = ownerNamespace("owner1");
  await s.owner.wallets.restore();
  assert.equal((await signInAs(s.base, wallet())).status, 503);
  assert.equal(s.owner.wallets.current(), null);
});

test("V23 a sign-in expires after ten minutes; nonces and sessions are stored only as hashes; sessions carry the owner and can be ended", async () => {
  const path = tempPath();
  let now = 1_000_000;
  const auth = await OwnerAuth.open(new SqliteRows(path), "example.test", () => now);
  const me = wallet();
  const challenge = await auth.challenge(me.address);
  assert.equal((await auth.pending(me.address, challenge.nonce)).ok, true);
  assert.deepEqual(await auth.pending(wallet().address, challenge.nonce), { ok: false, problem: "WRONG_ADDRESS" });
  now += SIGN_IN_LIFETIME_MS + 1;
  assert.deepEqual(await auth.pending(me.address, challenge.nonce), { ok: false, problem: "EXPIRED" });
  const session = await auth.startSession("owner1", me.address);
  assert.equal(readFileSync(path).includes(Buffer.from(challenge.nonce)), false);
  assert.equal(readFileSync(path).includes(Buffer.from(session.token)), false);
  assert.deepEqual(await auth.session(session.token), { ownerId: "owner1", address: me.address });
  await auth.endSession(session.token);
  assert.equal(await auth.session(session.token), null);
  assert.equal(await auth.session(null), null);
});

test("V08 settings caps are read live by the engine and refuse nonsense values", async () => {
  const settings = await OwnerSettings.open(new SqliteRows(tempPath()), { perPaymentBaseUnits: 100_000n, perDayBaseUnits: 500_000n, cooldownSeconds: 86_400 });
  const caps = settings.caps();
  assert.equal(caps.perPaymentBaseUnits, 100_000n);
  assert.deepEqual(await settings.update({ perPaymentBaseUnits: "600000", perDayBaseUnits: "500000", cooldownSeconds: "60" }), { ok: false, problem: "The per-payment cap can't be above the daily cap." });
  assert.equal((await settings.update({ perPaymentBaseUnits: "200000", perDayBaseUnits: "500000", cooldownSeconds: "60" })).ok, true);
  assert.equal(caps.perPaymentBaseUnits, 200_000n);
  assert.equal(settings.values().cooldownSeconds, 60);
});
