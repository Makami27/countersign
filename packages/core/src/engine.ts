import { appearsVerbatim, imitatesAny, parseSuiAddress } from "./address.ts";
import { CHANGE_REQUEST_LIFETIME_MS, changeMessage } from "./changeMessage.ts";
import { checkContinuity, checkControl } from "./changeProofs.ts";
import { headOf, nextVersionNumber, payeeNamespace } from "./payeeBook.ts";
import { restoreIndex, versionsFrom, type RestoreResult } from "./memoryBook.ts";
import { CheckTrail, paymentOutcome } from "./receipts.ts";
import { payeeVersion, refuse, writeReceipt, writeRecord, type ReceiptWrite, type Subject } from "./engineWrites.ts";
import { completeOnboarding, requestOnboarding } from "./onboarding.ts";
import type { PaymentIntent } from "./payments.ts";
import type { EngineDeps } from "./engineDeps.ts";
import type { ContinuityProof, ControlProof, Evidence, InboundMessage, Outcome, PayeeHead, Proposal, ReceiptRecord, Refused, SuiAddress } from "./types.ts";

export type { RoundTripChecker, RoundTripResult } from "./changeProofs.ts";
export type { RestoreResult } from "./memoryBook.ts";
export type { Caps, EngineDeps } from "./engineDeps.ts";
export type { ReceiptWrite } from "./engineWrites.ts";

export type PaymentPreview = { readonly verdict: "PAY_PREVIEW"; readonly payeeId: string; readonly name: string; readonly address: SuiAddress; readonly amountBaseUnits: bigint };
type CheckedPayment = { readonly name: string; readonly version: number; readonly address: SuiAddress; readonly amount: bigint; readonly payeeBlobId: string | null; readonly subject: Subject; readonly trail: CheckTrail };

export class Countersign {
  readonly #d: EngineDeps;

  constructor(deps: EngineDeps) {
    this.#d = deps;
  }

  requestOnboarding(name: string, address: string, ownerConfirmationId: string): Promise<Outcome> {
    return requestOnboarding(this.#d, name, address, ownerConfirmationId);
  }

  completeOnboarding(nonce: string, control: ControlProof): Promise<Outcome> {
    return completeOnboarding(this.#d, nonce, control);
  }

  payeeIds(): readonly string[] {
    return this.#d.index.payeeIds();
  }

  payeeHead(payeeId: string): PayeeHead {
    return headOf(this.#d.index.payeeVersions(payeeId));
  }

  receiptRecord(id: string): ReceiptRecord | null {
    return this.#d.index.receipt(id);
  }

  restore(): Promise<RestoreResult> {
    return restoreIndex(this.#d);
  }

  async handle(message: InboundMessage, proposal: Proposal): Promise<Outcome> {
    if (proposal.kind === "change_address") return this.#requestChange(message, proposal);
    if (proposal.kind === "pay") return this.#reservePayment(message, proposal);
    return { verdict: "NONE" };
  }

  async completeChange(nonce: string, continuity: ContinuityProof, control: ControlProof): Promise<Outcome> {
    const d = this.#d;
    const trail = new CheckTrail();
    const change = d.index.pendingChange(nonce);
    if (!change) return refuse(d, "CHANGE_REJECTED", "NONCE_REUSED", { ref: nonce, payeeId: null, address: null }, trail);
    const subject = { ref: nonce, payeeId: change.payeeId, address: change.toAddress };
    if (new Date(change.expires) < d.clock.now()) return refuse(d, "CHANGE_REJECTED", "EXPIRED", subject, trail);
    const head = headOf(d.index.payeeVersions(change.payeeId));
    if (head.kind !== "verified" || head.version.address !== change.fromAddress) return refuse(d, "CHANGE_REJECTED", "CONFLICT", subject, trail);
    const message = changeMessage(change);
    const continuityStep = await checkContinuity(continuity, message, change.fromAddress, { signatures: d.signatures, nowMs: d.clock.now().getTime(), cooldownMs: d.cooldownMs }, trail);
    if (!continuityStep.ok) return refuse(d, "CHANGE_REJECTED", continuityStep.reason, subject, trail);
    const controlStep = await checkControl(control, message, change.toAddress, { signatures: d.signatures, roundTrips: d.roundTrips }, trail);
    if (!controlStep.ok) return refuse(d, "CHANGE_REJECTED", controlStep.reason, subject, trail);

    const verifications = [continuityStep.verification, controlStep.verification].filter((v) => v !== null);
    const evidence: Evidence = continuity.kind === "signature"
      ? { kind: "continuity_signature", nonce, signature: continuity.signature, control, verifications }
      : { kind: "owner_confirmed_change", nonce, ownerConfirmationId: continuity.ownerConfirmationId, control, verifications };
    const record = payeeVersion(d, change.payeeId, head.version.name, nextVersionNumber(d.index.payeeVersions(change.payeeId)), change.toAddress, "VERIFIED", head.version.version, evidence);
    const written = await writeRecord(d, payeeNamespace(d.ownerId, change.payeeId), record, `change:${nonce}:verified`);
    if (written.status !== "WRITTEN") return refuse(d, "CHANGE_REJECTED", "MEMORY_WRITE_UNCONFIRMED", subject, trail);
    if (!d.index.consumePendingChange(nonce)) return refuse(d, "CHANGE_REJECTED", "NONCE_REUSED", subject, trail);
    d.index.putPayeeVersion(record);
    const receipt = await writeReceipt(d, "CHANGE_VERIFIED", null, subject, trail, [written.blobId], null);
    return { verdict: "CHANGE_VERIFIED", version: record.version, blobId: written.blobId, receipt: receipt.receipt };
  }

  async recordPaymentOutcome(intent: PaymentIntent): Promise<ReceiptWrite | null> {
    if (intent.state !== "SETTLED" && intent.state !== "FAILED") return null;
    const { verdict, reason, trail } = paymentOutcome(intent.state, intent.reason);
    const subject = { ref: intent.id, payeeId: intent.payeeId, address: intent.address, amountBaseUnits: intent.amountBaseUnits.toString() };
    return writeReceipt(this.#d, verdict, reason, subject, trail, intent.payeeBlobId ? [intent.payeeBlobId] : [], intent.digest, `rcpt_${intent.id.replace(/^pay_/, "")}`, intent.updatedAt);
  }

  async #requestChange(message: InboundMessage, proposal: Extract<Proposal, { kind: "change_address" }>): Promise<Outcome> {
    const d = this.#d;
    const trail = new CheckTrail();
    const toAddress = parseSuiAddress(proposal.newAddress);
    const subject = { ref: message.id, payeeId: proposal.payeeId, address: toAddress };
    if (!toAddress || !appearsVerbatim(toAddress, message.text)) return refuse(d, "REFUSED", "ADDRESS_NOT_IN_MESSAGE", { ...subject, address: null }, trail, "ADDRESS_IN_MESSAGE");
    trail.pass("ADDRESS_IN_MESSAGE");
    const versions = d.index.payeeVersions(proposal.payeeId);
    const head = headOf(versions);
    if (head.kind === "none") return refuse(d, "REFUSED", "PAYEE_NOT_VERIFIED", subject, trail, "PAYEE_VERIFIED");
    if (head.kind === "conflict") return refuse(d, "REFUSED", "CONFLICT", subject, trail, "PAYEE_VERIFIED");
    trail.pass("PAYEE_VERIFIED");
    if (toAddress === head.version.address) return { verdict: "NONE" };
    const earlier = d.index.earlierRefusalFor(toAddress);
    if (earlier) return refuse(d, "REFUSED", "KNOWN_ATTACK_PATTERN", subject, trail, "NOT_KNOWN_ATTACK", earlier.receipt);
    trail.pass("NOT_KNOWN_ATTACK");
    if (imitatesAny(toAddress, d.index.verifiedAddresses())) return refuse(d, "REFUSED", "LOOKALIKE_ADDRESS", subject, trail, "NOT_LOOKALIKE");
    trail.pass("NOT_LOOKALIKE");

    const nonce = d.nonces.next();
    const expires = new Date(d.clock.now().getTime() + CHANGE_REQUEST_LIFETIME_MS).toISOString();
    const stated = payeeVersion(d, proposal.payeeId, head.version.name, nextVersionNumber(versions), toAddress, "STATED", head.version.version, { kind: "stated", sourceMessageId: message.id, nonce });
    const written = await writeRecord(d, payeeNamespace(d.ownerId, proposal.payeeId), stated, `change:${nonce}:stated`);
    if (written.status === "WRITTEN") d.index.putPayeeVersion(stated);
    d.index.insertPendingChange({ nonce, payeeId: proposal.payeeId, fromAddress: head.version.address, toAddress, expires });
    return { verdict: "CHANGE_STARTED", nonce, expires, fromAddress: head.version.address, toAddress };
  }

  async previewPayment(message: InboundMessage, proposal: Extract<Proposal, { kind: "pay" }>): Promise<PaymentPreview | Refused> {
    const checked = await this.#checkPayment(message, proposal);
    if (!("payeeBlobId" in checked)) return checked;
    return { verdict: "PAY_PREVIEW", payeeId: proposal.payeeId, name: checked.name, address: checked.address, amountBaseUnits: checked.amount };
  }

  async #reservePayment(message: InboundMessage, proposal: Extract<Proposal, { kind: "pay" }>): Promise<Outcome> {
    const d = this.#d;
    const checked = await this.#checkPayment(message, proposal);
    if (!("payeeBlobId" in checked)) return checked;
    const now = d.clock.now().toISOString();
    const intent = { id: `pay_${d.nonces.next()}`, payeeId: proposal.payeeId, payeeVersion: checked.version, payeeBlobId: checked.payeeBlobId, address: checked.address, amountBaseUnits: checked.amount, period: now.slice(0, 10), createdAt: now };
    if (!d.payments.reservePayment(intent, d.caps.perDayBaseUnits)) return refuse(d, "REFUSED", "CAP_EXCEEDED", checked.subject, checked.trail, "WITHIN_CAPS");
    return { verdict: "PAY_RESERVED", paymentId: intent.id, address: intent.address, amountBaseUnits: checked.amount };
  }

  async #checkPayment(message: InboundMessage, proposal: Extract<Proposal, { kind: "pay" }>): Promise<CheckedPayment | Refused> {
    const d = this.#d;
    const trail = new CheckTrail();
    const subject = { ref: message.id, payeeId: proposal.payeeId, address: null, amountBaseUnits: proposal.amountBaseUnits };
    const read = await d.memory.readAll(payeeNamespace(d.ownerId, proposal.payeeId));
    if (!read.complete) return refuse(d, "REFUSED", "MEMORY_INCOMPLETE", subject, trail, "MEMORY_COMPLETE");
    trail.pass("MEMORY_COMPLETE");
    const stored = versionsFrom(d.signer, read.records, proposal.payeeId);
    if (stored.length === 0) return refuse(d, "REFUSED", "UNKNOWN_PAYEE", subject, trail, "PAYEE_VERIFIED");
    const head = headOf(stored.map((s) => s.record));
    if (head.kind === "none") return refuse(d, "REFUSED", "PAYEE_NOT_VERIFIED", subject, trail, "PAYEE_VERIFIED");
    if (head.kind === "conflict") return refuse(d, "REFUSED", "CONFLICT", subject, trail, "PAYEE_VERIFIED");
    trail.pass("PAYEE_VERIFIED");
    const payee = { ...subject, address: head.version.address };
    if (!/^[1-9]\d*$/.test(proposal.amountBaseUnits)) return refuse(d, "REFUSED", "AMOUNT_INVALID", payee, trail, "AMOUNT_VALID");
    trail.pass("AMOUNT_VALID");
    const amount = BigInt(proposal.amountBaseUnits);
    if (amount > d.caps.perPaymentBaseUnits) return refuse(d, "REFUSED", "CAP_EXCEEDED", payee, trail, "WITHIN_CAPS");
    const payeeBlobId = stored.find((s) => s.record.version === head.version.version)?.blobId ?? null;
    return { name: head.version.name, version: head.version.version, address: head.version.address, amount, payeeBlobId, subject: payee, trail };
  }
}
