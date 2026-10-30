import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPaymentLedger, type ChainSighting, type NewPaymentIntent, type SuiAddress } from "@countersign/core";
import { PaymentRunner } from "../src/payments/runner.ts";
import type { PaymentChain, Prepared, Submitted } from "../src/tatum/payments.ts";

const PAYEE = `0x${"c".repeat(64)}` as SuiAddress;
const clock = { now: () => new Date("2026-10-30T10:00:00Z") };
const noWait = async () => undefined;

class FakeChain implements PaymentChain {
  submits = 0;
  prepared: Prepared = { ok: true, payment: { bytes: new Uint8Array([1]), signature: "sig", digest: "DIGEST1", validUntilEpoch: "100" } };
  submitted: Submitted = { state: "SENT" };
  sightings: ChainSighting[] = [];
  async prepare(): Promise<Prepared> {
    return this.prepared;
  }
  async submit(): Promise<Submitted> {
    this.submits += 1;
    return this.submitted;
  }
  async sight(): Promise<ChainSighting> {
    return this.sightings.shift() ?? { kind: "NOT_FOUND", currentEpoch: 100n };
  }
}

function setup(amount = 100_000n) {
  const ledger = new InMemoryPaymentLedger();
  const chain = new FakeChain();
  const intent: NewPaymentIntent = { id: "pay_1", payeeId: "rent", payeeVersion: 1, address: PAYEE, amountBaseUnits: amount, period: "2026-10-30", createdAt: "2026-10-30T10:00:00Z" };
  assert.ok(ledger.reservePayment(intent, 1_000_000n));
  return { ledger, chain, runner: new PaymentRunner({ ledger, chain, clock, sleep: noWait }) };
}

test("V07 C08 a payment whose submission times out is held UNKNOWN and is never submitted again, across send, settle and restart recovery", async () => {
  const { ledger, chain, runner } = setup();
  chain.submitted = { state: "UNKNOWN", detail: "deadline exceeded" };
  const after = await runner.send("pay_1");
  assert.equal(after.state, "UNKNOWN");
  assert.equal(after.digest, "DIGEST1");
  await runner.send("pay_1");
  await runner.settleSoon("pay_1");
  await new PaymentRunner({ ledger, chain, clock, sleep: noWait }).recoverInterrupted();
  assert.equal(chain.submits, 1);
  assert.equal(ledger.payment("pay_1")?.state, "UNKNOWN");
  assert.equal(ledger.reservedFor("2026-10-30"), 100_000n);
});

test("V07 a payment that can't be built is FAILED with nothing submitted, and its reservation is given back", async () => {
  const { ledger, chain, runner } = setup();
  chain.prepared = { ok: false, detail: "insufficient USDC" };
  const after = await runner.send("pay_1");
  assert.equal(after.state, "FAILED");
  assert.match(after.detail ?? "", /^Nothing was sent/);
  assert.equal(chain.submits, 0);
  assert.equal(ledger.reservedFor("2026-10-30"), 0n);
});

test("V07 an executed payment settles once the chain shows the exact credit to the payee", async () => {
  const { ledger, chain, runner } = setup();
  chain.sightings = [{ kind: "NOT_FOUND", currentEpoch: 100n }, { kind: "FOUND", success: true, creditedPayee: true }];
  const after = await runner.send("pay_1");
  assert.equal(after.state, "SETTLED");
  assert.equal(chain.submits, 1);
  assert.equal(ledger.reservedFor("2026-10-30"), 100_000n);
});

test("V07 a payment interrupted while SENDING becomes UNKNOWN on restart and is settled by digest, never resent", async () => {
  const { ledger, chain } = setup();
  assert.ok(ledger.movePayment("pay_1", { to: "SENDING", at: "2026-10-30T10:00:01Z", detail: null, digest: "DIGEST1", validUntilEpoch: "100" }));
  chain.sightings = [{ kind: "FOUND", success: true, creditedPayee: true }];
  const [recovered] = await new PaymentRunner({ ledger, chain, clock, sleep: noWait }).recoverInterrupted();
  assert.equal(recovered?.state, "SETTLED");
  assert.equal(chain.submits, 0);
});

test("V07 an UNKNOWN payment that never reached the chain is FAILED only after its validity window ends, and its reservation is given back", async () => {
  const { ledger, chain, runner } = setup();
  chain.submitted = { state: "UNKNOWN", detail: "connection reset" };
  await runner.send("pay_1");
  chain.sightings = [{ kind: "NOT_FOUND", currentEpoch: 100n }];
  assert.equal((await runner.reconcile("pay_1")).state, "UNKNOWN");
  chain.sightings = [{ kind: "NOT_FOUND", currentEpoch: 101n }];
  assert.equal((await runner.reconcile("pay_1")).state, "FAILED");
  assert.equal(ledger.reservedFor("2026-10-30"), 0n);
  assert.equal(chain.submits, 1);
});
