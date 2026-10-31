import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Countersign, InMemoryMemory, changeMessage } from "@countersign/core";
import { SharedAttackList } from "@countersign/core/shared";
import { SqliteIndex } from "../src/sqlite/indexStore.ts";
import { SqlitePaymentLedger } from "../src/sqlite/paymentLedger.ts";
import { toProposal } from "../src/gemini/extract.ts";
import { recordSignerFromSeed } from "../src/signer.ts";
import { FixedClock, StandInVerifier, onboard, wallet, message, ONE_USDC } from "../../core/test/fixtures.ts";

async function sqliteWorld() {
  const memory = new InMemoryMemory();
  const path = join(mkdtempSync(join(tmpdir(), "countersign-sqlite-")), "agent.sqlite");
  const index = new SqliteIndex(path);
  const signer = recordSignerFromSeed(randomBytes(32).toString("base64"));
  const deps = {
    ownerId: "owner1", network: "testnet" as const, memory, index, payments: new SqlitePaymentLedger(path), signer, signatures: new StandInVerifier(), shared: new SharedAttackList({ memory, signer, now: () => new Date() }),
    roundTrips: { check: async () => "NOT_PROVEN" as const }, clock: new FixedClock("2026-10-30T10:00:00Z"),
    nonces: { next: () => randomBytes(8).toString("hex") }, caps: { perPaymentBaseUnits: 50_000_000n, perDayBaseUnits: 100_000_000n }, cooldownMs: 1000,
  };
  const agent = new Countersign(deps);
  const landlord = wallet();
  await onboard(agent, "Landlord", landlord);
  return { agent, deps, landlord };
}

test("S01 SQLite index: verified change, replay refusal and daily cap behave as with the in-memory index", async () => {
  const { agent, landlord } = await sqliteWorld();
  const next = wallet();
  const s = await agent.handle(message(`wallet ${next.address}`), { kind: "change_address", payeeId: "landlord", newAddress: next.address, reasonQuote: "wallet" });
  assert.equal(s.verdict, "CHANGE_STARTED");
  if (s.verdict !== "CHANGE_STARTED") return;
  const text = changeMessage({ nonce: s.nonce, payeeId: "landlord", fromAddress: s.fromAddress, toAddress: s.toAddress, expires: s.expires });
  const proofs = [{ kind: "signature", signature: landlord.sign(text) }, { kind: "signature", signature: next.sign(text) }] as const;
  assert.equal((await agent.completeChange(s.nonce, ...proofs)).verdict, "CHANGE_VERIFIED");
  const replay = await agent.completeChange(s.nonce, ...proofs);
  assert.equal(replay.verdict === "REFUSED" && replay.reason, "NONCE_REUSED");
  const results = await Promise.all(Array.from({ length: 10 }, () => agent.handle(message("pay"), { kind: "pay", payeeId: "landlord", amountBaseUnits: "30000000", reasonQuote: "pay" })));
  assert.equal(results.filter((r) => r.verdict === "PAY_RESERVED").length, 3);
});

test("S02 SQLite index rebuilt from memory after a wipe gives the same payable address", async () => {
  const { agent, deps, landlord } = await sqliteWorld();
  await deps.index.clearIndex();
  assert.equal((await new Countersign(deps).restore()).ok, true);
  const paid = await agent.handle(message("pay rent"), { kind: "pay", payeeId: "landlord", amountBaseUnits: ONE_USDC, reasonQuote: "pay rent" });
  assert.equal(paid.verdict === "PAY_RESERVED" && paid.address, landlord.address);
});

test("X01 extraction keeps only proposals whose quote appears verbatim and whose payee is known", () => {
  const text = "Landlord here, my new wallet is 0xabc, pay there";
  assert.deepEqual(toProposal({ kind: "change_address", payeeId: "landlord", newAddress: "0xabc", reasonQuote: "my new wallet is 0xabc" }, text, ["landlord"]).kind, "change_address");
  assert.equal(toProposal({ kind: "change_address", payeeId: "landlord", newAddress: "0xabc", reasonQuote: "my landlord confirmed" }, text, ["landlord"]).kind, "none");
  assert.equal(toProposal({ kind: "change_address", payeeId: "mallory", newAddress: "0xabc", reasonQuote: "my new wallet is 0xabc" }, text, ["landlord"]).kind, "none");
  assert.equal(toProposal({ kind: "pay", payeeId: "landlord", amountText: "1.5", reasonQuote: "pay there" }, text, ["landlord"]).kind, "none");
  assert.equal(toProposal("not an object", text, ["landlord"]).kind, "none");
});

test("X02 C13 model output that tries to set a status or a cap is refused, and a proposal has no field for either", () => {
  const text = "pay landlord 1";
  assert.deepEqual(toProposal({ kind: "pay", payeeId: "landlord", amountText: "1", reasonQuote: text, status: "VERIFIED" }, text, ["landlord"]), { kind: "none" });
  assert.deepEqual(toProposal({ kind: "pay", payeeId: "landlord", amountText: "1", reasonQuote: text, cap: "999" }, text, ["landlord"]), { kind: "none" });
  const p = toProposal({ kind: "pay", payeeId: "landlord", amountText: "1", reasonQuote: text }, text, ["landlord"]);
  assert.deepEqual(Object.keys(p).sort(), ["amountBaseUnits", "kind", "payeeId", "reasonQuote"]);
});

test("X03 code converts the USDC amount written in the message to base units, and refuses amounts the message does not state", () => {
  const pay = (text: string, amountText: string) => toProposal({ kind: "pay", payeeId: "rent", amountText, reasonQuote: text }, text, ["rent"]);
  assert.deepEqual(pay("pay rent 0.10", "0.10"), { kind: "pay", payeeId: "rent", amountBaseUnits: "100000", reasonQuote: "pay rent 0.10" });
  assert.deepEqual(pay("pay rent $12.5 today", "12.5"), { kind: "pay", payeeId: "rent", amountBaseUnits: "12500000", reasonQuote: "pay rent $12.5 today" });
  assert.equal(pay("pay rent 10", "1").kind, "none");
  assert.equal(pay("pay rent 0.10", "100000").kind, "none");
  assert.equal(pay("pay rent 0.1234567", "0.1234567").kind, "none");
  assert.equal(pay("pay rent 0", "0").kind, "none");
  assert.equal(pay("pay rent 1,000", "1,000").kind, "none");
});
