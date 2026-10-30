import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NewPaymentIntent, SuiAddress } from "@countersign/core";
import { SqlitePaymentLedger } from "../src/sqlite/paymentLedger.ts";

const PAYEE = `0x${"b".repeat(64)}` as SuiAddress;
const AT = "2026-10-30T10:00:00Z";
let counter = 0;

function newIntent(amountBaseUnits = 30n): NewPaymentIntent {
  counter += 1;
  return { id: `pay_${counter}`, payeeId: "rent", payeeVersion: 1, address: PAYEE, amountBaseUnits, period: "2026-10-30", createdAt: AT };
}

function tempLedger(): { ledger: SqlitePaymentLedger; path: string } {
  const path = join(mkdtempSync(join(tmpdir(), "countersign-ledger-")), "ledger.sqlite");
  return { ledger: new SqlitePaymentLedger(path), path };
}

test("V07 C09 the SQLite ledger reserves the intent and the day's budget together, and ten simultaneous reservations respect the cap", async () => {
  const { ledger } = tempLedger();
  const results = await Promise.all(Array.from({ length: 10 }, async () => ledger.reservePayment(newIntent(30n), 100n)));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(ledger.reservedFor("2026-10-30"), 90n);
  const reserved = results.flatMap((ok, i) => (ok ? [i] : []));
  assert.equal(reserved.length, 3);
});

test("V07 a FAILED payment gives its reservation back; a SETTLED one keeps it", () => {
  const { ledger } = tempLedger();
  const failed = newIntent(40n);
  const settled = newIntent(50n);
  assert.ok(ledger.reservePayment(failed, 100n) && ledger.reservePayment(settled, 100n));
  assert.ok(ledger.movePayment(failed.id, { to: "FAILED", at: AT, detail: "build failed before sending; nothing was sent" }));
  assert.ok(ledger.movePayment(settled.id, { to: "SENDING", at: AT, detail: null, digest: "D-settled", validUntilEpoch: "100" }));
  assert.ok(ledger.movePayment(settled.id, { to: "SENT", at: AT, detail: null }));
  assert.ok(ledger.movePayment(settled.id, { to: "SETTLED", at: AT, detail: "credited" }));
  assert.equal(ledger.reservedFor("2026-10-30"), 50n);
  assert.equal(ledger.payment(settled.id)?.digest, "D-settled");
});

test("V07 C08 an UNKNOWN payment can't move back to SENDING through the ledger or through raw SQL", () => {
  const { ledger, path } = tempLedger();
  const payment = newIntent();
  ledger.reservePayment(payment, 100n);
  ledger.movePayment(payment.id, { to: "SENDING", at: AT, detail: null, digest: "D-unknown", validUntilEpoch: "100" });
  assert.ok(ledger.movePayment(payment.id, { to: "UNKNOWN", at: AT, detail: "execute timed out" }));
  assert.equal(ledger.movePayment(payment.id, { to: "SENDING", at: AT, detail: null }), false);
  const raw = new DatabaseSync(path);
  assert.throws(() => raw.prepare("UPDATE payment_intents SET state = 'SENDING' WHERE id = ?").run(payment.id), /payment state move not allowed/);
  raw.close();
  assert.equal(ledger.payment(payment.id)?.state, "UNKNOWN");
  assert.deepEqual(ledger.unresolvedPayments().map((p) => p.id), [payment.id]);
});

test("V07 a payment can't be marked SENDING without a stored digest, and two payments can't share one", () => {
  const { ledger, path } = tempLedger();
  const first = newIntent();
  const second = newIntent();
  ledger.reservePayment(first, 100n);
  ledger.reservePayment(second, 100n);
  const raw = new DatabaseSync(path);
  assert.throws(() => raw.prepare("UPDATE payment_intents SET state = 'SENDING' WHERE id = ?").run(first.id), /CHECK constraint failed/);
  raw.close();
  assert.ok(ledger.movePayment(first.id, { to: "SENDING", at: AT, detail: null, digest: "D-same", validUntilEpoch: "100" }));
  assert.throws(() => ledger.movePayment(second.id, { to: "SENDING", at: AT, detail: null, digest: "D-same", validUntilEpoch: "100" }), /UNIQUE constraint failed/);
  assert.equal(ledger.payment(second.id)?.state, "RESERVED");
});
