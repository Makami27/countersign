import { test } from "node:test";
import assert from "node:assert/strict";
import { Countersign } from "../src/engine.ts";
import { changeMessage } from "../src/changeMessage.ts";
import { payeeNamespace, receiptsNamespace } from "../src/payeeBook.ts";
import { canonicalJson, sealRecord } from "../src/records.ts";
import type { Outcome, PayeeVersionRecord } from "../src/types.ts";
import { ONE_USDC, lookalikeOf, message, wallet, world, type TestWallet } from "./fixtures.ts";

const pay = { kind: "pay", payeeId: "landlord", amountBaseUnits: ONE_USDC, reasonQuote: "pay rent" } as const;

async function startChange(agent: Countersign, to: TestWallet) {
  const outcome: Outcome = await agent.handle(message(`new wallet ${to.address}`), { kind: "change_address", payeeId: "landlord", newAddress: to.address, reasonQuote: "x" });
  if (outcome.verdict !== "CHANGE_STARTED") throw new Error(`expected CHANGE_STARTED, got ${outcome.verdict}`);
  return { ...outcome, text: changeMessage({ nonce: outcome.nonce, payeeId: "landlord", fromAddress: outcome.fromAddress, toAddress: outcome.toAddress, expires: outcome.expires }) };
}

function refusedReason(outcome: Outcome) {
  return outcome.verdict === "REFUSED" ? outcome.reason : outcome.verdict;
}

test("V13 an expired request is EXPIRED, a reused one NONCE_REUSED, and a step signed by the wrong wallet WRONG_WALLET, each with a CHANGE_REJECTED receipt", async () => {
  const { agent, index, clock, landlord } = await world();
  const next = wallet();
  const stranger = wallet();
  const wrongContinuity = await startChange(agent, next);
  const r1 = await agent.completeChange(wrongContinuity.nonce, { kind: "signature", signature: stranger.sign(wrongContinuity.text) }, { kind: "signature", signature: next.sign(wrongContinuity.text) });
  const r2 = await agent.completeChange(wrongContinuity.nonce, { kind: "signature", signature: landlord.sign(wrongContinuity.text) }, { kind: "signature", signature: stranger.sign(wrongContinuity.text) });
  assert.equal(refusedReason(r1), "WRONG_WALLET");
  assert.equal(refusedReason(r2), "WRONG_WALLET");
  const done = await agent.completeChange(wrongContinuity.nonce, { kind: "signature", signature: landlord.sign(wrongContinuity.text) }, { kind: "signature", signature: next.sign(wrongContinuity.text) });
  assert.equal(done.verdict, "CHANGE_VERIFIED");
  const reused = await agent.completeChange(wrongContinuity.nonce, { kind: "signature", signature: landlord.sign(wrongContinuity.text) }, { kind: "signature", signature: next.sign(wrongContinuity.text) });
  assert.equal(refusedReason(reused), "NONCE_REUSED");
  const later = await startChange(agent, wallet());
  clock.advance(25 * 3600 * 1000);
  const expired = await agent.completeChange(later.nonce, { kind: "signature", signature: next.sign(later.text) }, { kind: "signature", signature: next.sign(later.text) });
  assert.equal(refusedReason(expired), "EXPIRED");
  for (const r of [r1, r2, reused, expired]) assert.equal(r.verdict === "REFUSED" && (await index.receipt(r.receipt))?.verdict, "CHANGE_REJECTED");
});

test("V14 a refused scam gets a receipt with its checks in order, the failing check last, and no transaction", async () => {
  const { agent, index, memory, landlord } = await world();
  const fake = lookalikeOf(landlord.address);
  const r = await agent.handle(message(`landlord here, new wallet ${fake}`), { kind: "change_address", payeeId: "landlord", newAddress: fake, reasonQuote: "new wallet" });
  assert.equal(r.verdict, "REFUSED");
  if (r.verdict !== "REFUSED") return;
  const receipt = await index.receipt(r.receipt);
  assert.deepEqual(receipt?.checks, [
    { check: "ADDRESS_IN_MESSAGE", result: "PASS" }, { check: "PAYEE_VERIFIED", result: "PASS" }, { check: "NOT_KNOWN_ATTACK", result: "PASS" }, { check: "NOT_LOOKALIKE", result: "FAIL" },
  ]);
  assert.equal(receipt?.reason, "LOOKALIKE_ADDRESS");
  assert.equal(receipt?.suiDigest, null);
  assert.equal(receipt?.address, fake);
  assert.equal(memory.spaces.get(receiptsNamespace("owner1"))?.length, 3);
});

test("V12 V14 a verified change's receipt records CONTINUITY and CONTROL with the new version's blob; the owner path records OWNER_CONFIRMED and COOLDOWN_ELAPSED", async () => {
  const { agent, index, clock, landlord } = await world();
  const next = wallet();
  const signed = await startChange(agent, next);
  const ok = await agent.completeChange(signed.nonce, { kind: "signature", signature: landlord.sign(signed.text) }, { kind: "signature", signature: next.sign(signed.text) });
  assert.ok(ok.verdict === "CHANGE_VERIFIED");
  assert.deepEqual((await index.receipt(ok.receipt))?.checks, [{ check: "CONTINUITY", result: "PASS" }, { check: "CONTROL", result: "PASS" }]);
  assert.deepEqual((await index.receipt(ok.receipt))?.memoryBlobIds, [ok.blobId]);
  const third = wallet();
  const owner = await startChange(agent, third);
  const waiting = await agent.completeChange(owner.nonce, { kind: "owner_confirmed", ownerConfirmationId: "c9", confirmedAt: clock.now().toISOString() }, { kind: "signature", signature: third.sign(owner.text) });
  assert.ok(waiting.verdict === "REFUSED" && waiting.reason === "COOLDOWN_ACTIVE");
  assert.deepEqual((await index.receipt(waiting.receipt))?.checks, [{ check: "NOT_KNOWN_ATTACK", result: "PASS" }, { check: "NOT_LOOKALIKE", result: "PASS" }, { check: "NOT_SEEN_ELSEWHERE", result: "PASS" }, { check: "OWNER_CONFIRMED", result: "PASS" }, { check: "COOLDOWN_ELAPSED", result: "FAIL" }]);
});

test("V14 a settled payment's receipt cites the payee-version blob it paid from and the Sui digest; a failed one names its reason; an UNKNOWN one gets no receipt", async () => {
  const { agent, payments, index } = await world();
  const reserved = await agent.handle(message("pay rent"), pay);
  assert.ok(reserved.verdict === "PAY_RESERVED");
  assert.equal(await agent.recordPaymentOutcome((await payments.payment(reserved.paymentId)) ?? assert.fail("no intent")), null);
  await payments.movePayment(reserved.paymentId, { to: "SENDING", at: "2026-10-30T10:00:01Z", detail: null, digest: "DIGEST_OK", validUntilEpoch: "100" });
  await payments.movePayment(reserved.paymentId, { to: "UNKNOWN", at: "2026-10-30T10:00:02Z", detail: "timeout" });
  assert.equal(await agent.recordPaymentOutcome((await payments.payment(reserved.paymentId)) ?? assert.fail("no intent")), null);
  await payments.movePayment(reserved.paymentId, { to: "SETTLED", at: "2026-10-30T10:00:03Z", detail: "credited" });
  const paid = await agent.recordPaymentOutcome((await payments.payment(reserved.paymentId)) ?? assert.fail("no intent"));
  const receipt = await index.receipt(paid?.receipt ?? "");
  assert.equal(receipt?.verdict, "PAID");
  assert.equal(receipt?.suiDigest, "DIGEST_OK");
  assert.equal(receipt?.memoryBlobIds.length, 1);
  assert.match(receipt?.memoryBlobIds[0] ?? "", /^blob_/);
  assert.deepEqual(receipt?.checks.at(-1), { check: "SETTLED_ON_CHAIN", result: "PASS" });
  const second = await agent.handle(message("pay rent"), pay);
  assert.ok(second.verdict === "PAY_RESERVED");
  await payments.movePayment(second.paymentId, { to: "FAILED", at: "2026-10-30T10:00:04Z", detail: "could not build", reason: "PAYMENT_NOT_BUILT" });
  const failed = await index.receipt((await agent.recordPaymentOutcome((await payments.payment(second.paymentId)) ?? assert.fail("no intent")))?.receipt ?? "");
  assert.equal(failed?.verdict, "PAYMENT_FAILED");
  assert.equal(failed?.reason, "PAYMENT_NOT_BUILT");
});

test("D13 a zkLogin-verified payee stays payable after the signature's maxEpoch, including after a restore, because payee signatures are verified once and never again", async () => {
  const { agent, deps, signatures, landlord } = await world();
  signatures.scheme = "ZKLOGIN";
  signatures.maxEpoch = "1298";
  signatures.epoch = "1296";
  const next = wallet();
  const s = await startChange(agent, next);
  const ok = await agent.completeChange(s.nonce, { kind: "signature", signature: landlord.sign(s.text) }, { kind: "signature", signature: next.sign(s.text) });
  assert.equal(ok.verdict, "CHANGE_VERIFIED");
  const head = (await deps.index.payeeVersions("landlord")).find((v) => v.status === "VERIFIED" && v.address === next.address) as PayeeVersionRecord;
  assert.ok(head.evidence.kind === "continuity_signature");
  if (head.evidence.kind !== "continuity_signature") return;
  assert.deepEqual(head.evidence.verifications.map((v) => [v.role, v.scheme, v.maxEpoch, v.checkedAtEpoch]), [["continuity", "ZKLOGIN", "1298", "1296"], ["control", "ZKLOGIN", "1298", "1296"]]);
  signatures.rejectEverything = true;
  signatures.epoch = "1400";
  await deps.index.clearIndex();
  const fresh = new Countersign(deps);
  assert.equal((await fresh.restore()).ok, true);
  const paid = await fresh.handle(message("pay rent"), pay);
  assert.equal(paid.verdict === "PAY_RESERVED" && paid.address, next.address);
});

function sealLegacy(signer: { sign(canonical: string): string }, record: Record<string, unknown>): string {
  return JSON.stringify({ record, sig: signer.sign(canonicalJson(record)) });
}

test("restore skips old 'refusal' records left in memory instead of crashing or calling them forgeries", async () => {
  const { agent, memory, signer } = await world();
  memory.plant(receiptsNamespace("owner1"), sealLegacy(signer, { type: "refusal", receipt: "rcpt_old", reason: "LOOKALIKE_ADDRESS", ref: "m1", payeeId: "landlord", address: null, createdAt: "2026-10-29T10:00:00Z" }));
  memory.plant(payeeNamespace("owner1", "landlord"), sealRecord(signer, { type: "payee_version", payeeId: "landlord", name: "Landlord", version: 7, address: wallet().address, status: "STATED", supersedes: 1, evidence: { kind: "stated", sourceMessageId: "m1", nonce: "n" }, createdAt: "2026-10-29T10:00:00Z" }));
  const restored = await agent.restore();
  assert.deepEqual(restored.ok && { legacy: restored.legacy, ignored: restored.ignored }, { legacy: 1, ignored: 0 });
});
