import { test } from "node:test";
import assert from "node:assert/strict";
import { Countersign } from "../src/engine.ts";
import { onboardingMessage } from "../src/changeMessage.ts";
import { payeeNamespace } from "../src/payeeBook.ts";
import { canonicalJson } from "../src/records.ts";
import type { Outcome } from "../src/types.ts";
import { ONE_USDC, lookalikeOf, message, wallet, world, type TestWallet } from "./fixtures.ts";

const payRent = { kind: "pay", payeeId: "flat-4b-rent", amountBaseUnits: ONE_USDC, reasonQuote: "pay" } as const;

async function start(agent: Countersign, name: string, payee: TestWallet) {
  const started: Outcome = await agent.requestOnboarding(name, payee.address, "owner-c");
  if (started.verdict !== "ONBOARDING_STARTED") throw new Error(`expected ONBOARDING_STARTED, got ${JSON.stringify(started)}`);
  return { ...started, text: onboardingMessage({ nonce: started.nonce, payeeId: started.payeeId, name, address: started.address, expires: started.expires }) };
}

const reasonOf = (o: Outcome) => (o.verdict === "REFUSED" ? o.reason : o.verdict);

test("V03 a new payee stays unpayable until its own wallet signs the onboarding message, then becomes VERIFIED with the signature details", async () => {
  const { agent, deps } = await world();
  const flat = wallet();
  const s = await start(agent, "Flat 4B rent", flat);
  assert.equal(s.payeeId, "flat-4b-rent");
  assert.equal(reasonOf(await agent.handle(message("pay rent"), payRent)), "PAYEE_NOT_VERIFIED");
  const done = await agent.completeOnboarding(s.nonce, { kind: "signature", signature: flat.sign(s.text) });
  assert.equal(done.verdict, "CHANGE_VERIFIED");
  const head = await agent.payeeHead("flat-4b-rent");
  assert.ok(head.kind === "verified" && head.version.name === "Flat 4B rent" && head.version.evidence.kind === "payee_onboarding");
  if (head.kind === "verified" && head.version.evidence.kind === "payee_onboarding") assert.equal(head.version.evidence.verifications[0]?.role, "control");
  const paid = await agent.handle(message("pay rent"), payRent);
  assert.equal(paid.verdict === "PAY_RESERVED" && paid.address, flat.address);
  assert.equal((await deps.index.payeeVersions("flat-4b-rent")).length, 2);
});

test("V03 adding a payee is refused when its address imitates a verified address or was refused before", async () => {
  const { agent, landlord } = await world();
  assert.equal(reasonOf(await agent.requestOnboarding("Copycat", lookalikeOf(landlord.address), "c1")), "LOOKALIKE_ADDRESS");
  const scam = lookalikeOf(landlord.address);
  await agent.handle(message(`new wallet ${scam}`), { kind: "change_address", payeeId: "landlord", newAddress: scam, reasonQuote: "x" });
  assert.equal(reasonOf(await agent.requestOnboarding("Second try", scam, "c2")), "KNOWN_ATTACK_PATTERN");
  assert.equal(reasonOf(await agent.requestOnboarding("   ", wallet().address, "c3")), "NAME_INVALID");
});

test("V03 V13 an onboarding signed by another wallet is WRONG_WALLET, an expired one EXPIRED, a reused one NONCE_REUSED", async () => {
  const { agent, clock } = await world();
  const flat = wallet();
  const s = await start(agent, "Flat 4B rent", flat);
  assert.equal(reasonOf(await agent.completeOnboarding(s.nonce, { kind: "signature", signature: wallet().sign(s.text) })), "WRONG_WALLET");
  assert.equal((await agent.completeOnboarding(s.nonce, { kind: "signature", signature: flat.sign(s.text) })).verdict, "CHANGE_VERIFIED");
  assert.equal(reasonOf(await agent.completeOnboarding(s.nonce, { kind: "signature", signature: flat.sign(s.text) })), "NONCE_REUSED");
  const late = await start(agent, "Designer two", wallet());
  clock.advance(25 * 3600 * 1000);
  assert.equal(reasonOf(await agent.completeOnboarding(late.nonce, { kind: "signature", signature: "AAAA" })), "EXPIRED");
});

test("V03 a payee added the old way, without its wallet's signature, is never payable, even though the agent signed the record", async () => {
  const { agent, memory, signer } = await world();
  const old = wallet();
  const record = { type: "payee_version", payeeId: "old-payee", version: 1, address: old.address, status: "VERIFIED", supersedes: null, evidence: { kind: "owner_onboarding", ownerConfirmationId: "x" }, createdAt: "2026-10-30T10:00:00Z" };
  memory.plant(payeeNamespace("owner1", "old-payee"), JSON.stringify({ record, sig: signer.sign(canonicalJson(record)) }));
  const restored = await agent.restore();
  assert.ok(restored.ok && restored.legacy === 1);
  assert.equal(reasonOf(await agent.handle(message("pay old"), { ...payRent, payeeId: "old-payee" })), "UNKNOWN_PAYEE");
});
