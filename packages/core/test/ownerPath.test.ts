import { test } from "node:test";
import assert from "node:assert/strict";
import { SharedAttackList } from "../src/sharedAttacks.ts";
import type { Outcome, SuiAddress } from "../src/types.ts";
import { DEFAULT_CAPS, lookalikeOf, message, onboard, recordSigner, wallet, world } from "./fixtures.ts";

const COOLDOWN_MS = 60_000;
type World = Awaited<ReturnType<typeof world>>;

async function ownerChange(w: World, address: SuiAddress) {
  const text = `Owner requested a new address for landlord: ${address}`;
  const started: Outcome = await w.agent.handle({ ...message(text), channel: "web" }, { kind: "change_address", payeeId: "landlord", newAddress: address, reasonQuote: text });
  if (started.verdict !== "CHANGE_STARTED") throw new Error(`expected CHANGE_STARTED, got ${started.verdict}`);
  const confirmedAt = w.clock.now().toISOString();
  const complete = () => w.agent.completeChange(started.nonce, { kind: "owner_confirmed", ownerConfirmationId: "owner:test", confirmedAt }, { kind: "signature", signature: "not-checked-before-the-screen" });
  return { nonce: started.nonce, complete };
}

async function headAddress(w: World): Promise<string | null> {
  const head = await w.agent.payeeHead("landlord");
  return head.kind === "verified" ? head.version.address : null;
}

test("V12 an owner-confirmed change to an address that became a look-alike during the waiting period is refused when it would take effect, then remembered as an attack", async () => {
  const w = await world(DEFAULT_CAPS, "2026-10-30T10:00:00Z", COOLDOWN_MS);
  const studio = wallet();
  const imitation = lookalikeOf(studio.address);
  const change = await ownerChange(w, imitation);
  await onboard(w.agent, "Studio", studio);
  w.clock.advance(COOLDOWN_MS + 1000);
  const first = await change.complete();
  assert.equal(first.verdict === "REFUSED" && first.reason, "LOOKALIKE_ADDRESS");
  assert.equal(await headAddress(w), w.landlord.address);
  const again = await change.complete();
  assert.equal(again.verdict === "REFUSED" && again.reason, "KNOWN_ATTACK_PATTERN");
  assert.equal(again.verdict === "REFUSED" && again.cites, first.verdict === "REFUSED" ? first.receipt : "");
  assert.equal(await headAddress(w), w.landlord.address);
});

test("V12 V22 the owner's confirmation is screened before it counts: a clean address passes, a look-alike or an address other agents refused is refused with a receipt", async () => {
  const w = await world(DEFAULT_CAPS, "2026-10-30T10:00:00Z", COOLDOWN_MS);
  const clean = await ownerChange(w, wallet().address);
  assert.equal(await w.agent.screenOwnerConfirmation(clean.nonce), null);
  const studio = wallet();
  const lookalike = await ownerChange(w, lookalikeOf(studio.address));
  await onboard(w.agent, "Studio", studio);
  const refused = await w.agent.screenOwnerConfirmation(lookalike.nonce);
  assert.equal(refused?.reason, "LOOKALIKE_ADDRESS");
  assert.ok((await w.agent.receiptRecord(refused?.receipt ?? ""))?.verdict === "CHANGE_REJECTED");
  const scam = wallet().address;
  const shared = await ownerChange(w, scam);
  await new SharedAttackList({ memory: w.memory, signer: recordSigner(), now: () => w.clock.now() }).report({ address: scam, reason: "LOOKALIKE_ADDRESS", receipt: "rcpt_other001" });
  await w.shared.refresh();
  assert.equal((await w.agent.screenOwnerConfirmation(shared.nonce))?.reason, "SEEN_BY_OTHER_AGENT");
  w.clock.advance(COOLDOWN_MS + 1000);
  const completed = await shared.complete();
  assert.equal(completed.verdict === "REFUSED" && completed.reason, "SEEN_BY_OTHER_AGENT");
});

test("V12 the owner can cancel a waiting change: it can never complete, the payee keeps the verified address, and the address is not marked as an attack", async () => {
  const w = await world(DEFAULT_CAPS, "2026-10-30T10:00:00Z", COOLDOWN_MS);
  const next = wallet().address;
  const change = await ownerChange(w, next);
  const cancelled = await w.agent.cancelChange(change.nonce);
  assert.equal(cancelled?.reason, "CANCELLED_BY_OWNER");
  assert.equal(await w.agent.cancelChange(change.nonce), null);
  w.clock.advance(COOLDOWN_MS + 1000);
  const late = await change.complete();
  assert.equal(late.verdict === "REFUSED" && late.reason, "NONCE_REUSED");
  assert.equal(await headAddress(w), w.landlord.address);
  const retried = await w.agent.handle({ ...message(`new wallet ${next}`), channel: "web" }, { kind: "change_address", payeeId: "landlord", newAddress: next, reasonQuote: `new wallet ${next}` });
  assert.equal(retried.verdict, "CHANGE_STARTED");
});
