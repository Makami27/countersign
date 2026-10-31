import { imitatesAny, parseSuiAddress } from "./address.ts";
import { CHANGE_REQUEST_LIFETIME_MS, onboardingMessage } from "./changeMessage.ts";
import { checkControl } from "./changeProofs.ts";
import { headOf, payeeNamespace } from "./payeeBook.ts";
import { CheckTrail } from "./receipts.ts";
import { payeeVersion, refuse, writeReceipt, writeRecord } from "./engineWrites.ts";
import { seenElsewhere } from "./sharedFlags.ts";
import { repeatOf } from "./knownAttacks.ts";
import type { EngineDeps } from "./engineDeps.ts";
import type { ControlProof, Outcome } from "./types.ts";

const MAX_NAME_CHARS = 60;
const MAX_ID_CHARS = 40;

export function payeeIdFor(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_CHARS) return null;
  const id = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_ID_CHARS);
  return id.length > 0 ? id : null;
}

export async function requestOnboarding(d: EngineDeps, name: string, address: string, ownerConfirmationId: string): Promise<Outcome> {
  const trail = new CheckTrail();
  const payeeId = payeeIdFor(name);
  const parsed = parseSuiAddress(address);
  const subject = { ref: ownerConfirmationId, payeeId, address: parsed };
  if (!payeeId) return refuse(d, "REFUSED", "NAME_INVALID", subject, trail);
  if (!parsed) return refuse(d, "REFUSED", "ADDRESS_NOT_IN_MESSAGE", subject, trail, "ADDRESS_IN_MESSAGE");
  trail.pass("ADDRESS_IN_MESSAGE");
  if ((await d.index.payeeVersions(payeeId)).length > 0) return refuse(d, "REFUSED", "CONFLICT", subject, trail, "OWNER_CONFIRMED");
  trail.pass("OWNER_CONFIRMED");
  const repeat = await repeatOf(d.index, parsed, false);
  if (repeat) return refuse(d, "REFUSED", repeat.reason, { ...subject, ...repeat.seen }, trail, "NOT_KNOWN_ATTACK", repeat.cites);
  trail.pass("NOT_KNOWN_ATTACK");
  if (imitatesAny(parsed, await d.index.verifiedAddresses())) return refuse(d, "REFUSED", "LOOKALIKE_ADDRESS", subject, trail, "NOT_LOOKALIKE");
  trail.pass("NOT_LOOKALIKE");
  const flagged = await seenElsewhere(d, parsed);
  if (flagged) return refuse(d, "REFUSED", "SEEN_BY_OTHER_AGENT", { ...subject, seenElsewhere: flagged }, trail, "NOT_SEEN_ELSEWHERE");

  const nonce = d.nonces.next();
  const expires = new Date(d.clock.now().getTime() + CHANGE_REQUEST_LIFETIME_MS).toISOString();
  const stated = payeeVersion(d, payeeId, name.trim(), 1, parsed, "STATED", null, { kind: "onboarding_requested", ownerConfirmationId, nonce, expires });
  const written = await writeRecord(d, payeeNamespace(d.ownerId, payeeId), stated, `onboard:${nonce}:requested`);
  if (written.status !== "WRITTEN") return refuse(d, "REFUSED", "MEMORY_WRITE_UNCONFIRMED", subject, trail);
  await d.index.putPayeeVersion(stated);
  await d.index.insertPendingOnboarding({ nonce, payeeId, name: stated.name, address: parsed, expires });
  return { verdict: "ONBOARDING_STARTED", payeeId, nonce, expires, address: parsed };
}

export async function completeOnboarding(d: EngineDeps, nonce: string, control: ControlProof): Promise<Outcome> {
  const trail = new CheckTrail();
  const pending = await d.index.pendingOnboarding(nonce);
  if (!pending) return refuse(d, "CHANGE_REJECTED", "NONCE_REUSED", { ref: nonce, payeeId: null, address: null }, trail);
  const subject = { ref: nonce, payeeId: pending.payeeId, address: pending.address };
  if (new Date(pending.expires) < d.clock.now()) return refuse(d, "CHANGE_REJECTED", "EXPIRED", subject, trail);
  const versions = await d.index.payeeVersions(pending.payeeId);
  const requested = versions.find((v) => v.evidence.kind === "onboarding_requested" && v.evidence.nonce === nonce);
  if (!requested || requested.evidence.kind !== "onboarding_requested" || headOf(versions).kind !== "none") return refuse(d, "CHANGE_REJECTED", "CONFLICT", subject, trail);
  if (imitatesAny(pending.address, await d.index.verifiedAddresses())) return refuse(d, "CHANGE_REJECTED", "LOOKALIKE_ADDRESS", subject, trail, "NOT_LOOKALIKE");
  trail.pass("NOT_LOOKALIKE");
  const step = await checkControl(control, onboardingMessage(pending), pending.address, { signatures: d.signatures, roundTrips: d.roundTrips }, trail);
  if (!step.ok) return refuse(d, "CHANGE_REJECTED", step.reason, subject, trail);

  const verifications = step.verification ? [step.verification] : [];
  const evidence = { kind: "payee_onboarding" as const, ownerConfirmationId: requested.evidence.ownerConfirmationId, nonce, control, verifications };
  const record = payeeVersion(d, pending.payeeId, pending.name, requested.version + 1, pending.address, "VERIFIED", null, evidence);
  const written = await writeRecord(d, payeeNamespace(d.ownerId, pending.payeeId), record, `onboard:${nonce}:verified`);
  if (written.status !== "WRITTEN") return refuse(d, "CHANGE_REJECTED", "MEMORY_WRITE_UNCONFIRMED", subject, trail);
  if (!await d.index.consumePendingOnboarding(nonce)) return refuse(d, "CHANGE_REJECTED", "NONCE_REUSED", subject, trail);
  await d.index.putPayeeVersion(record);
  const receipt = await writeReceipt(d, "CHANGE_VERIFIED", null, subject, trail, [written.blobId], null);
  return { verdict: "CHANGE_VERIFIED", version: record.version, blobId: written.blobId, receipt: receipt.receipt };
}
