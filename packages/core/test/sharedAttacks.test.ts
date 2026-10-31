import { test } from "node:test";
import assert from "node:assert/strict";
import { changeMessage } from "../src/changeMessage.ts";
import { canonicalJson } from "../src/records.ts";
import { SHARED_ATTACKS_NAMESPACE, SHARED_REPORT_LIFETIME_MS, SharedAttackList } from "../src/sharedAttacks.ts";
import type { Outcome, SuiAddress } from "../src/types.ts";
import { lookalikeOf, message, onboard, recordSigner, wallet, world } from "./fixtures.ts";

type World = Awaited<ReturnType<typeof world>>;

function otherAgent(w: World) {
  return new SharedAttackList({ memory: w.memory, signer: recordSigner(), now: () => w.clock.now() });
}

function changeTo(w: World, address: SuiAddress, channel: "lab" | "web" = "lab"): Promise<Outcome> {
  return w.agent.handle({ ...message(`please pay ${address} from now on`), channel }, { kind: "change_address", payeeId: "landlord", newAddress: address, reasonQuote: "x" });
}

async function sharedTexts(w: World): Promise<string[]> {
  const read = await w.memory.readAll(SHARED_ATTACKS_NAMESPACE);
  return read.complete ? read.records.map((r) => r.text) : [];
}

test("V22 a look-alike refusal shares a signed attack_seen record with the address, reason, receipt, agent key and time, and nothing about the victim", async () => {
  const w = await world();
  const fake = lookalikeOf(w.landlord.address);
  const refused = await changeTo(w, fake);
  assert.equal(refused.verdict === "REFUSED" && refused.reason, "LOOKALIKE_ADDRESS");
  const [text, ...rest] = await sharedTexts(w);
  assert.equal(rest.length, 0);
  const record = (JSON.parse(text ?? "{}") as { record: Record<string, unknown> }).record;
  assert.deepEqual(Object.keys(record).sort(), ["address", "agentKey", "reason", "receipt", "seenAt", "type"]);
  assert.equal(record["address"], fake);
  assert.equal(record["agentKey"], w.signer.agentKey);
  assert.ok(!text?.includes(w.landlord.address) && !text?.includes("landlord") && !text?.includes("owner1"));
  const again = await changeTo(w, fake);
  assert.equal(again.verdict === "REFUSED" && again.reason, "KNOWN_ATTACK_PATTERN");
  assert.equal((await sharedTexts(w)).length, 2);
});

test("V22 an address other agents refused is SEEN_BY_OTHER_AGENT, citing the first receipt and counting distinct agent keys; it is not re-shared or remembered as our own attack", async () => {
  const w = await world();
  const scam = wallet().address;
  const [first, second] = [otherAgent(w), otherAgent(w)];
  await first.report({ address: scam, reason: "LOOKALIKE_ADDRESS", receipt: "rcpt_first0001" });
  w.clock.advance(60_000);
  await first.report({ address: scam, reason: "KNOWN_ATTACK_PATTERN", receipt: "rcpt_first0002" });
  await second.report({ address: scam, reason: "LOOKALIKE_ADDRESS", receipt: "rcpt_second001" });
  await w.shared.refresh();
  const refused = await changeTo(w, scam);
  if (refused.verdict !== "REFUSED") return assert.fail("expected a refusal");
  assert.equal(refused.reason, "SEEN_BY_OTHER_AGENT");
  assert.deepEqual(refused.seenElsewhere, { firstReceipt: "rcpt_first0001", agents: 2 });
  assert.deepEqual((await w.agent.receiptRecord(refused.receipt))?.seenElsewhere, { firstReceipt: "rcpt_first0001", agents: 2 });
  assert.equal((await sharedTexts(w)).filter((t) => t.includes(w.signer.agentKey)).length, 0);
  assert.equal(await w.index.earlierRefusalFor(scam), null);
  const onboarding = await w.agent.requestOnboarding("Plumber", scam, "owner-confirm-plumber");
  assert.equal(onboarding.verdict === "REFUSED" && onboarding.reason, "SEEN_BY_OTHER_AGENT");
});

test("V22 a flag never blocks a VERIFIED payee, a continuity signature overrides it, and the owner-confirmed path cannot", async () => {
  const w = await world(undefined, undefined, 0);
  const reporter = otherAgent(w);
  await reporter.report({ address: w.designer.address, reason: "LOOKALIKE_ADDRESS", receipt: "rcpt_designer1" });
  const moved = wallet();
  const ownerPath = wallet();
  await reporter.report({ address: moved.address, reason: "LOOKALIKE_ADDRESS", receipt: "rcpt_moved0001" });
  await reporter.report({ address: ownerPath.address, reason: "LOOKALIKE_ADDRESS", receipt: "rcpt_owner0001" });
  await w.shared.refresh();
  assert.equal(await w.agent.seenElsewhere(w.designer.address), null);
  const pay = await w.agent.handle(message("pay designer 1"), { kind: "pay", payeeId: "designer", amountBaseUnits: "1000000", reasonQuote: "x" });
  assert.equal(pay.verdict, "PAY_RESERVED");

  const started = await changeTo(w, moved.address, "web");
  if (started.verdict !== "CHANGE_STARTED") return assert.fail("the owner app may start a change to a flagged address");
  const text = changeMessage({ nonce: started.nonce, payeeId: "landlord", fromAddress: started.fromAddress, toAddress: started.toAddress, expires: started.expires });
  const signed = await w.agent.completeChange(started.nonce, { kind: "signature", signature: w.landlord.sign(text) }, { kind: "signature", signature: moved.sign(text) });
  assert.equal(signed.verdict, "CHANGE_VERIFIED");

  const byOwner = await changeTo(w, ownerPath.address, "web");
  if (byOwner.verdict !== "CHANGE_STARTED") return assert.fail("expected a started change");
  const ownerText = changeMessage({ nonce: byOwner.nonce, payeeId: "landlord", fromAddress: byOwner.fromAddress, toAddress: byOwner.toAddress, expires: byOwner.expires });
  const confirmed = await w.agent.completeChange(byOwner.nonce, { kind: "owner_confirmed", ownerConfirmationId: "c1", confirmedAt: "2026-10-30T09:00:00Z" }, { kind: "signature", signature: ownerPath.sign(ownerText) });
  assert.equal(confirmed.verdict === "REFUSED" && confirmed.reason, "SEEN_BY_OTHER_AGENT");
});

test("V22 reports expire after 90 days, a signed retraction removes only its own agent's report, forged or re-signed records are ignored, and our own reports never count", async () => {
  const w = await world();
  const scam = wallet().address;
  const [reporter, stranger] = [otherAgent(w), otherAgent(w)];
  await reporter.report({ address: scam, reason: "LOOKALIKE_ADDRESS", receipt: "rcpt_report001" });
  await w.shared.report({ address: wallet().address, reason: "LOOKALIKE_ADDRESS", receipt: "rcpt_ownrep001" });
  const forged = { type: "attack_seen" as const, address: wallet().address, reason: "LOOKALIKE_ADDRESS" as const, receipt: "rcpt_forged001", agentKey: recordSigner().agentKey, seenAt: w.clock.now().toISOString() };
  w.memory.plant(SHARED_ATTACKS_NAMESPACE, JSON.stringify({ record: forged, sig: recordSigner().sign(canonicalJson(forged)) }));
  await stranger.retract({ address: scam, receipt: "rcpt_report001" });
  await w.shared.refresh();
  assert.equal(w.shared.flag(scam).status, "SEEN");
  assert.equal(w.shared.flag(forged.address).status, "CLEAR");
  const own = await sharedTexts(w);
  assert.ok(own.some((t) => t.includes(w.signer.agentKey)));
  assert.equal(w.shared.flag((JSON.parse(own.find((t) => t.includes(w.signer.agentKey)) ?? "{}") as { record: { address: SuiAddress } }).record.address).status, "CLEAR");

  await reporter.retract({ address: scam, receipt: "rcpt_report001" });
  await w.shared.refresh();
  assert.equal(w.shared.flag(scam).status, "CLEAR");

  const later = wallet().address;
  await reporter.report({ address: later, reason: "KNOWN_ATTACK_PATTERN", receipt: "rcpt_report002" });
  await w.shared.refresh();
  w.clock.advance(SHARED_REPORT_LIFETIME_MS - 1000);
  assert.equal(w.shared.flag(later).status, "SEEN");
  w.clock.advance(2000);
  assert.equal(w.shared.flag(later).status, "CLEAR");
});

test("V22 unreadable shared memory means local checks only: a flagged address goes on to the normal proofs instead of being refused", async () => {
  const w = await world();
  const scam = wallet().address;
  await otherAgent(w).report({ address: scam, reason: "LOOKALIKE_ADDRESS", receipt: "rcpt_unknown01" });
  w.memory.dropOnRead = SHARED_ATTACKS_NAMESPACE;
  assert.equal(await w.shared.refresh(), false);
  assert.equal(w.shared.flag(scam).status, "UNKNOWN");
  assert.equal((await changeTo(w, scam)).verdict, "CHANGE_STARTED");
  assert.equal((await onboard(w.agent, "Gardener", wallet())).verdict, "CHANGE_VERIFIED");
});
