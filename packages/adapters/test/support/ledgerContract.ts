import { test } from "node:test";
import assert from "node:assert/strict";
import type { IndexStore, NewPaymentIntent, PaymentLedger, Reservation } from "@countersign/core";
import { PAYEE_A, PAYEE_B, verifiedVersion } from "./payees.ts";

export type LedgerWorld = {
  readonly ledger: PaymentLedger & { reservedFor(period: string): Promise<bigint> };
  readonly index: IndexStore;
  readonly raw: (sql: string) => Promise<void>;
  readonly close: () => Promise<void>;
};

const AT = "2026-10-30T10:00:00Z";
const PERIOD = "2026-10-30";
let counter = 0;

function newIntent(amountBaseUnits = 30n, payeeVersion = 1, address = PAYEE_A): NewPaymentIntent {
  counter += 1;
  return { id: `pay_${process.pid}_${counter}`, payeeId: "rent", payeeVersion, payeeBlobId: null, address, amountBaseUnits, period: PERIOD, createdAt: AT };
}

export function ledgerContract(label: string, open: () => Promise<LedgerWorld>): void {
  async function world(t: { after: (fn: () => Promise<void>) => void }): Promise<LedgerWorld> {
    const w = await open();
    t.after(() => w.close());
    await w.index.putPayeeVersion(verifiedVersion("rent", 1, PAYEE_A, null));
    return w;
  }

  test(`V07 C09 ${label}: ten simultaneous reservations never take the day past its cap`, async (t) => {
    const { ledger } = await world(t);
    const results = await Promise.all(Array.from({ length: 10 }, () => ledger.reservePayment(newIntent(30n), 100n)));
    assert.equal(results.filter((r) => r === "RESERVED").length, 3);
    assert.deepEqual([...new Set(results.filter((r) => r !== "RESERVED"))], ["CAP_EXCEEDED"]);
    assert.equal(await ledger.reservedFor(PERIOD), 90n);
  });

  test(`V07 ${label}: a FAILED payment gives its reservation back; a SETTLED one keeps it`, async (t) => {
    const { ledger } = await world(t);
    const failed = newIntent(40n);
    const settled = newIntent(50n);
    assert.equal(await ledger.reservePayment(failed, 100n), "RESERVED");
    assert.equal(await ledger.reservePayment(settled, 100n), "RESERVED");
    assert.ok(await ledger.movePayment(failed.id, { to: "FAILED", at: AT, detail: "build failed before sending; nothing was sent" }));
    assert.ok(await ledger.movePayment(settled.id, { to: "SENDING", at: AT, detail: null, digest: `D-settled-${settled.id}`, validUntilEpoch: "100" }));
    assert.ok(await ledger.movePayment(settled.id, { to: "SENT", at: AT, detail: null }));
    assert.ok(await ledger.movePayment(settled.id, { to: "SETTLED", at: AT, detail: "credited" }));
    assert.equal(await ledger.reservedFor(PERIOD), 50n);
    assert.equal((await ledger.payment(settled.id))?.digest, `D-settled-${settled.id}`);
  });

  test(`V07 C08 ${label}: an UNKNOWN payment can't move back to SENDING through the ledger or through raw SQL`, async (t) => {
    const { ledger, raw } = await world(t);
    const payment = newIntent();
    await ledger.reservePayment(payment, 100n);
    await ledger.movePayment(payment.id, { to: "SENDING", at: AT, detail: null, digest: `D-unknown-${payment.id}`, validUntilEpoch: "100" });
    assert.ok(await ledger.movePayment(payment.id, { to: "UNKNOWN", at: AT, detail: "execute timed out" }));
    assert.equal(await ledger.movePayment(payment.id, { to: "SENDING", at: AT, detail: null }), false);
    await assert.rejects(raw(`UPDATE payment_intents SET state = 'SENDING' WHERE id = '${payment.id}'`), /payment state move not allowed/);
    assert.equal((await ledger.payment(payment.id))?.state, "UNKNOWN");
    assert.deepEqual((await ledger.unresolvedPayments()).map((p) => p.id), [payment.id]);
  });

  test(`V07 ${label}: a payment can't be marked SENDING without a stored digest, and two payments can't share one`, async (t) => {
    const { ledger, raw } = await world(t);
    const first = newIntent();
    const second = newIntent();
    await ledger.reservePayment(first, 100n);
    await ledger.reservePayment(second, 100n);
    await assert.rejects(raw(`UPDATE payment_intents SET state = 'SENDING' WHERE id = '${first.id}'`), /CHECK constraint failed|violates check constraint/);
    const digest = `D-same-${first.id}`;
    assert.ok(await ledger.movePayment(first.id, { to: "SENDING", at: AT, detail: null, digest, validUntilEpoch: "100" }));
    await assert.rejects(ledger.movePayment(second.id, { to: "SENDING", at: AT, detail: null, digest, validUntilEpoch: "100" }), /UNIQUE constraint failed|duplicate key value/);
    assert.equal((await ledger.payment(second.id))?.state, "RESERVED");
  });

  test(`V07 C01 ${label}: a reservation is refused unless it pays the payee's current verified head`, async (t) => {
    const { ledger, index } = await world(t);
    assert.equal(await ledger.reservePayment(newIntent(10n, 1, PAYEE_B), 100n), "PAYEE_CHANGED");
    assert.equal(await ledger.reservePayment({ ...newIntent(10n), payeeId: "nobody" }, 100n), "PAYEE_CHANGED");
    await index.putPayeeVersion(verifiedVersion("rent", 2, PAYEE_B, 1));
    assert.equal(await ledger.reservePayment(newIntent(10n, 1, PAYEE_A), 100n), "PAYEE_CHANGED");
    assert.equal(await ledger.reservePayment(newIntent(10n, 2, PAYEE_B), 100n), "RESERVED");
    assert.equal(await ledger.reservedFor(PERIOD), 10n);
  });

  test(`V07 C01 ${label}: payments racing an address change are paid to the head verified when they were reserved, or refused`, async (t) => {
    const { ledger, index } = await world(t);
    const early = Array.from({ length: 6 }, () => ledger.reservePayment(newIntent(1n, 1, PAYEE_A), 1_000n));
    const change = index.putPayeeVersion(verifiedVersion("rent", 2, PAYEE_B, 1));
    const during = Array.from({ length: 6 }, () => ledger.reservePayment(newIntent(1n, 1, PAYEE_A), 1_000n));
    await change;
    const after: Reservation[] = [];
    for (let i = 0; i < 5; i++) after.push(await ledger.reservePayment(newIntent(1n, 1, PAYEE_A), 1_000n));
    const raced = [...(await Promise.all(early)), ...(await Promise.all(during))];
    assert.ok(raced.every((r) => r === "RESERVED" || r === "PAYEE_CHANGED"));
    assert.deepEqual(after, Array(5).fill("PAYEE_CHANGED"));
    const reserved = (await ledger.recentPayments(100, "rent")).filter((p) => p.state === "RESERVED");
    assert.ok(reserved.every((p) => p.address === PAYEE_A && p.payeeVersion === 1));
    assert.equal(await ledger.reservedFor(PERIOD), BigInt(raced.filter((r) => r === "RESERVED").length));
  });
}
