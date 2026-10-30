import { test } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { PAYMENT_STATES, PAYMENT_TRANSITIONS, canMovePayment, reconcilePayment, type ChainSighting, type PaymentIntent, type PaymentState } from "../src/payments.ts";
import type { SuiAddress } from "../src/types.ts";

function intent(state: PaymentState, validUntilEpoch: string | null = "100", digest: string | null = "D1"): PaymentIntent {
  return {
    id: "pay_1", payeeId: "rent", payeeVersion: 1, address: `0x${"a".repeat(64)}` as SuiAddress, amountBaseUnits: 100_000n, period: "2026-10-30",
    createdAt: "2026-10-30T10:00:00Z", state, digest, validUntilEpoch, detail: null, updatedAt: "2026-10-30T10:00:00Z",
  };
}

test("V07 C08 the payment state machine matches the PRD and has no edge back to SENDING or out of SETTLED and FAILED", () => {
  const edges = PAYMENT_STATES.flatMap((from) => PAYMENT_STATES.filter((to) => canMovePayment(from, to)).map((to) => `${from}>${to}`));
  assert.deepEqual(edges.sort(), ["RESERVED>FAILED", "RESERVED>SENDING", "SENDING>FAILED", "SENDING>SENT", "SENDING>UNKNOWN", "SENT>FAILED", "SENT>SETTLED", "UNKNOWN>FAILED", "UNKNOWN>SETTLED"]);
  for (const from of PAYMENT_STATES) assert.equal(canMovePayment(from, "SENDING"), from === "RESERVED", from);
  assert.deepEqual([...PAYMENT_TRANSITIONS.SETTLED, ...PAYMENT_TRANSITIONS.FAILED], []);
});

test("V07 reconciliation settles a found credit, fails a found failure or an expired unseen payment, holds everything else, and never acts on a payment still marked SENDING", () => {
  const cases: readonly [PaymentIntent, ChainSighting, string][] = [
    [intent("UNKNOWN"), { kind: "FOUND", success: true, creditedPayee: true }, "MOVE SETTLED"],
    [intent("SENT"), { kind: "FOUND", success: true, creditedPayee: true }, "MOVE SETTLED"],
    [intent("UNKNOWN"), { kind: "FOUND", success: false, creditedPayee: false }, "MOVE FAILED"],
    [intent("UNKNOWN"), { kind: "FOUND", success: true, creditedPayee: false }, "HOLD"],
    [intent("UNKNOWN"), { kind: "NOT_FOUND", currentEpoch: 100n }, "HOLD"],
    [intent("UNKNOWN"), { kind: "NOT_FOUND", currentEpoch: 101n }, "MOVE FAILED"],
    [intent("SENDING"), { kind: "NOT_FOUND", currentEpoch: 101n }, "HOLD"],
    [intent("SENDING"), { kind: "FOUND", success: true, creditedPayee: true }, "HOLD"],
    [intent("SENT"), { kind: "NOT_FOUND", currentEpoch: 500n }, "HOLD"],
    [intent("UNKNOWN", null), { kind: "NOT_FOUND", currentEpoch: 500n }, "HOLD"],
    [intent("UNKNOWN"), { kind: "UNKNOWN", detail: "429" }, "HOLD"],
    [intent("RESERVED", null, null), { kind: "FOUND", success: true, creditedPayee: true }, "HOLD"],
    [intent("SETTLED"), { kind: "FOUND", success: false, creditedPayee: false }, "HOLD"],
  ];
  for (const [payment, sighting, expected] of cases) {
    const result = reconcilePayment(payment, sighting);
    assert.equal(result.kind === "MOVE" ? `MOVE ${result.to}` : "HOLD", expected, `${payment.state} + ${JSON.stringify(sighting, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`);
  }
});

test("V07 property: across 2,000 random sightings a payment only fails when the chain proves nothing moved", () => {
  const failures: string[] = [];
  for (let i = 0; i < 2000; i++) {
    const state = PAYMENT_STATES[randomInt(PAYMENT_STATES.length)] ?? "UNKNOWN";
    const validUntil = randomInt(3) === 0 ? null : String(randomInt(50, 60));
    const payment = intent(state, validUntil, randomInt(5) === 0 ? null : "D1");
    const roll = randomInt(3);
    const sighting: ChainSighting = roll === 0 ? { kind: "FOUND", success: randomInt(2) === 0, creditedPayee: randomInt(2) === 0 } : roll === 1 ? { kind: "NOT_FOUND", currentEpoch: BigInt(randomInt(45, 65)) } : { kind: "UNKNOWN", detail: "timeout" };
    const result = reconcilePayment(payment, sighting);
    if (result.kind !== "MOVE") continue;
    const reconcilable = (state === "SENT" || state === "UNKNOWN") && payment.digest !== null;
    const provenFailed = sighting.kind === "FOUND" ? !sighting.success : sighting.kind === "NOT_FOUND" && state !== "SENT" && validUntil !== null && sighting.currentEpoch > BigInt(validUntil);
    const provenSettled = sighting.kind === "FOUND" && sighting.success && sighting.creditedPayee;
    const ok = reconcilable && canMovePayment(state, result.to) && (result.to === "FAILED" ? provenFailed : provenSettled);
    if (!ok) failures.push(`#${i} ${state} digest=${payment.digest} until=${validUntil} ${sighting.kind} -> ${result.to}`);
  }
  assert.deepEqual(failures, []);
});
