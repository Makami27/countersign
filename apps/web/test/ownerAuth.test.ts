import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODE_ALPHABET, CODE_LIFETIME_MS, OwnerAuth, normalizeCode } from "../src/ownerAuth.ts";
import { OwnerSettings } from "../src/ownerSettings.ts";
import { SqliteRows } from "@countersign/adapters/sqlite";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "countersign-auth-")), "auth.sqlite");
}

function rows(path: string = tempPath()): SqliteRows {
  return new SqliteRows(path);
}

test("V01 a login code works once, then never again", async () => {
  const auth = await OwnerAuth.open(rows());
  const code = await auth.issueCode();
  const first = await auth.redeemCode(code);
  assert.equal(first.ok, true);
  assert.equal(first.ok && (await auth.sessionValid(first.token)), true);
  assert.deepEqual(await auth.redeemCode(code), { ok: false });
});

test("V01 a login code expires after ten minutes", async () => {
  let now = 1_000_000;
  const auth = await OwnerAuth.open(rows(), () => now);
  const code = await auth.issueCode();
  now += CODE_LIFETIME_MS + 1;
  assert.deepEqual(await auth.redeemCode(code), { ok: false });
});

test("V01 Q06 codes are stored only as hashes, use an alphabet that divides 256, and sessions can be ended", async () => {
  const path = tempPath();
  const auth = await OwnerAuth.open(rows(path));
  const code = await auth.issueCode();
  assert.equal(256 % CODE_ALPHABET.length, 0);
  assert.equal(readFileSync(path).includes(Buffer.from(normalizeCode(code))), false);
  const session = await auth.redeemCode(code.toLowerCase());
  assert.ok(session.ok);
  if (!session.ok) return;
  await auth.endSession(session.token);
  assert.equal(await auth.sessionValid(session.token), false);
  assert.equal(await auth.sessionValid(null), false);
});

test("V08 settings caps are read live by the engine and refuse nonsense values", async () => {
  const settings = await OwnerSettings.open(rows(), { perPaymentBaseUnits: 100_000n, perDayBaseUnits: 500_000n, cooldownSeconds: 86_400 });
  const caps = settings.caps();
  assert.equal(caps.perPaymentBaseUnits, 100_000n);
  assert.deepEqual(await settings.update({ perPaymentBaseUnits: "600000", perDayBaseUnits: "500000", cooldownSeconds: "60" }), { ok: false, problem: "The per-payment cap can't be above the daily cap." });
  assert.equal((await settings.update({ perPaymentBaseUnits: "200000", perDayBaseUnits: "500000", cooldownSeconds: "60" })).ok, true);
  assert.equal(caps.perPaymentBaseUnits, 200_000n);
  assert.equal(settings.values().cooldownSeconds, 60);
});
