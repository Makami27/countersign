import { test } from "node:test";
import assert from "node:assert/strict";
import { Countersign } from "../src/engine.ts";
import { InMemoryIndex, InMemoryPaymentLedger } from "../src/testing/inMemory.ts";
import { remembersAttack } from "../src/receipts.ts";
import { SHARED_ATTACKS_NAMESPACE } from "../src/sharedAttacks.ts";
import { REASON_CODES } from "../src/vocabulary.ts";
import type { ReceiptRecord } from "../src/types.ts";
import { message, wallet, world } from "./fixtures.ts";

const PAYMENT_REASONS = ["CAP_EXCEEDED", "AMOUNT_INVALID", "PAYEE_NOT_VERIFIED", "UNKNOWN_PAYEE", "MEMORY_INCOMPLETE", "PAYEE_CHANGED", "CONFLICT", "PAYMENT_NOT_BUILT", "PAYMENT_FAILED_ON_CHAIN", "PAYMENT_EXPIRED", "CHAIN_UNKNOWN"] as const;

function receipt(reason: ReceiptRecord["reason"], verdict: ReceiptRecord["verdict"] = "REFUSED"): ReceiptRecord {
  return { type: "receipt", receipt: `rcpt_${reason ?? "none"}`, verdict, reason, ref: "m1", payeeId: "landlord", address: wallet().address, amountBaseUnits: null, checks: [], memoryBlobIds: [], suiDigest: null, network: "testnet", createdAt: "2026-10-30T10:00:00Z" };
}

test("C17 a cap refusal never marks the payee's verified address as an attack: a later message with it isn't KNOWN_ATTACK_PATTERN, nothing is shared, and a restore keeps it that way", async () => {
  const w = await world();
  const over = await w.agent.handle(message("pay landlord 60"), { kind: "pay", payeeId: "landlord", amountBaseUnits: "60000000", reasonQuote: "x" });
  assert.equal(over.verdict === "REFUSED" && over.reason, "CAP_EXCEEDED");
  assert.equal(await w.index.earlierRefusalFor(w.landlord.address), null);
  const later = await w.agent.handle(message(`designer now uses ${w.landlord.address}`), { kind: "change_address", payeeId: "designer", newAddress: w.landlord.address, reasonQuote: "x" });
  assert.notEqual(later.verdict === "REFUSED" && later.reason, "KNOWN_ATTACK_PATTERN");
  assert.deepEqual(await w.memory.readAll(SHARED_ATTACKS_NAMESPACE), { complete: true, records: [] });
  const index = new InMemoryIndex();
  const fresh = new Countersign({ ...w.deps, index, payments: new InMemoryPaymentLedger(index) });
  assert.equal((await fresh.restore()).ok, true);
  assert.equal(await index.earlierRefusalFor(w.landlord.address), null);
});

test("C17 only attack refusals feed known-attack memory: payment refusals never do, and a change refusal only for a bad signature on the unproven address", () => {
  for (const reason of PAYMENT_REASONS) assert.equal(remembersAttack(receipt(reason)), false, reason);
  for (const reason of ["LOOKALIKE_ADDRESS", "KNOWN_ATTACK_PATTERN", "SEEN_BY_OTHER_AGENT"] as const) assert.equal(remembersAttack(receipt(reason)), true, reason);
  assert.equal(remembersAttack(receipt("SIGNATURE_INVALID", "CHANGE_REJECTED")), true);
  for (const reason of ["EXPIRED", "NONCE_REUSED", "WRONG_WALLET", "NO_CONTINUITY", "COOLDOWN_ACTIVE", "CONTROL_NOT_PROVEN"] as const) assert.equal(remembersAttack(receipt(reason, "CHANGE_REJECTED")), false, reason);
  assert.equal(REASON_CODES.filter((r) => remembersAttack(receipt(r))).length, 3);
});

test("C17 a VERIFIED payee's current address never matches known-attack memory, even if a refusal on record names it", async () => {
  const w = await world();
  await w.index.putReceipt({ ...receipt("LOOKALIKE_ADDRESS"), address: w.designer.address }, null);
  const outcome = await w.agent.handle(message(`landlord moved to ${w.designer.address}`), { kind: "change_address", payeeId: "landlord", newAddress: w.designer.address, reasonQuote: "x" });
  assert.notEqual(outcome.verdict === "REFUSED" && outcome.reason, "KNOWN_ATTACK_PATTERN");
});
