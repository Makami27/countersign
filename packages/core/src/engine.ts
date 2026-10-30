import { appearsVerbatim, imitatesAny, parseSuiAddress } from "./address.ts";
import { CHANGE_REQUEST_LIFETIME_MS, changeMessage } from "./changeMessage.ts";
import { checkContinuity, checkControl } from "./changeProofs.ts";
import { headOf, nextVersionNumber, payeeNamespace, receiptsNamespace } from "./payeeBook.ts";
import { indexRecord, restoreIndex, versionsFrom, type RestoreResult } from "./memoryBook.ts";
import { sealRecord } from "./records.ts";
import { CheckTrail, paymentOutcome } from "./receipts.ts";
import type { PaymentIntent } from "./payments.ts";
import type { EngineDeps } from "./engineDeps.ts";
import type { ContinuityProof, ControlProof, Evidence, InboundMessage, MemoryRecord, Outcome, PayeeHead, PayeeVersionRecord, Proposal, ReceiptRecord, ReceiptVerdict, Refused, SuiAddress } from "./types.ts";
import type { ReasonCode } from "./vocabulary.ts";

export type { RoundTripChecker, RoundTripResult } from "./changeProofs.ts";
export type { RestoreResult } from "./memoryBook.ts";
export type { Caps, EngineDeps } from "./engineDeps.ts";

export type ReceiptWrite = { readonly receipt: string; readonly blobId: string | null };

type Subject = { readonly ref: string; readonly payeeId: string | null; readonly address: SuiAddress | null; readonly amountBaseUnits?: string };

export class Countersign {
  readonly #d: EngineDeps;

  constructor(deps: EngineDeps) {
    this.#d = deps;
  }

  async onboardPayee(payeeId: string, address: string, ownerConfirmationId: string): Promise<Outcome> {
    const trail = new CheckTrail();
    const parsed = parseSuiAddress(address);
    const subject = { ref: payeeId, payeeId, address: parsed };
    if (!parsed) return this.#refuse("REFUSED", "ADDRESS_NOT_IN_MESSAGE", subject, trail);
    const versions = this.#d.index.payeeVersions(payeeId);
    if (headOf(versions).kind !== "none") return this.#refuse("REFUSED", "CONFLICT", subject, trail);
    trail.pass("OWNER_CONFIRMED");
    const record = this.#payeeVersion(payeeId, nextVersionNumber(versions), parsed, "VERIFIED", null, { kind: "owner_onboarding", ownerConfirmationId });
    const written = await this.#write(payeeNamespace(this.#d.ownerId, payeeId), record, `onboard:${payeeId}:${parsed}`);
    if (written.status !== "WRITTEN") return this.#refuse("REFUSED", "MEMORY_INCOMPLETE", subject, trail);
    this.#d.index.putPayeeVersion(record);
    const receipt = await this.#receipt("CHANGE_VERIFIED", null, subject, trail, [written.blobId], null);
    return { verdict: "CHANGE_VERIFIED", version: record.version, blobId: written.blobId, receipt: receipt.receipt };
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

  async handle(message: InboundMessage, proposal: Proposal): Promise<Outcome> {
    if (proposal.kind === "change_address") return this.#requestChange(message, proposal);
    if (proposal.kind === "pay") return this.#reservePayment(message, proposal);
    return { verdict: "NONE" };
  }

  async completeChange(nonce: string, continuity: ContinuityProof, control: ControlProof): Promise<Outcome> {
    const trail = new CheckTrail();
    const change = this.#d.index.pendingChange(nonce);
    if (!change) return this.#refuse("CHANGE_REJECTED", "NONCE_REUSED", { ref: nonce, payeeId: null, address: null }, trail);
    const subject = { ref: nonce, payeeId: change.payeeId, address: change.toAddress };
    if (new Date(change.expires) < this.#d.clock.now()) return this.#refuse("CHANGE_REJECTED", "EXPIRED", subject, trail);
    const head = headOf(this.#d.index.payeeVersions(change.payeeId));
    if (head.kind !== "verified" || head.version.address !== change.fromAddress) return this.#refuse("CHANGE_REJECTED", "CONFLICT", subject, trail);
    const message = changeMessage(change);
    const continuityStep = await checkContinuity(continuity, message, change.fromAddress, { signatures: this.#d.signatures, nowMs: this.#d.clock.now().getTime(), cooldownMs: this.#d.cooldownMs }, trail);
    if (!continuityStep.ok) return this.#refuse("CHANGE_REJECTED", continuityStep.reason, subject, trail);
    const controlStep = await checkControl(control, message, change.toAddress, { signatures: this.#d.signatures, roundTrips: this.#d.roundTrips }, trail);
    if (!controlStep.ok) return this.#refuse("CHANGE_REJECTED", controlStep.reason, subject, trail);

    const verifications = [continuityStep.verification, controlStep.verification].filter((v) => v !== null);
    const evidence: Evidence = continuity.kind === "signature"
      ? { kind: "continuity_signature", nonce, signature: continuity.signature, control, verifications }
      : { kind: "owner_confirmed_change", nonce, ownerConfirmationId: continuity.ownerConfirmationId, control, verifications };
    const record = this.#payeeVersion(change.payeeId, nextVersionNumber(this.#d.index.payeeVersions(change.payeeId)), change.toAddress, "VERIFIED", head.version.version, evidence);
    const written = await this.#write(payeeNamespace(this.#d.ownerId, change.payeeId), record, `change:${nonce}:verified`);
    if (written.status !== "WRITTEN") return this.#refuse("CHANGE_REJECTED", "MEMORY_INCOMPLETE", subject, trail);
    if (!this.#d.index.consumePendingChange(nonce)) return this.#refuse("CHANGE_REJECTED", "NONCE_REUSED", subject, trail);
    this.#d.index.putPayeeVersion(record);
    const receipt = await this.#receipt("CHANGE_VERIFIED", null, subject, trail, [written.blobId], null);
    return { verdict: "CHANGE_VERIFIED", version: record.version, blobId: written.blobId, receipt: receipt.receipt };
  }

  async recordPaymentOutcome(intent: PaymentIntent): Promise<ReceiptWrite | null> {
    if (intent.state !== "SETTLED" && intent.state !== "FAILED") return null;
    const { verdict, reason, trail } = paymentOutcome(intent.state, intent.reason);
    const subject = { ref: intent.id, payeeId: intent.payeeId, address: intent.address, amountBaseUnits: intent.amountBaseUnits.toString() };
    return this.#receipt(verdict, reason, subject, trail, intent.payeeBlobId ? [intent.payeeBlobId] : [], intent.digest, `rcpt_${intent.id.replace(/^pay_/, "")}`, intent.updatedAt);
  }

  restore(): Promise<RestoreResult> {
    return restoreIndex(this.#d);
  }

  async #requestChange(message: InboundMessage, proposal: Extract<Proposal, { kind: "change_address" }>): Promise<Outcome> {
    const trail = new CheckTrail();
    const toAddress = parseSuiAddress(proposal.newAddress);
    const subject = { ref: message.id, payeeId: proposal.payeeId, address: toAddress };
    if (!toAddress || !appearsVerbatim(toAddress, message.text)) return this.#refuse("REFUSED", "ADDRESS_NOT_IN_MESSAGE", { ...subject, address: null }, trail, "ADDRESS_IN_MESSAGE");
    trail.pass("ADDRESS_IN_MESSAGE");
    const versions = this.#d.index.payeeVersions(proposal.payeeId);
    const head = headOf(versions);
    if (head.kind === "none") return this.#refuse("REFUSED", "PAYEE_NOT_VERIFIED", subject, trail, "PAYEE_VERIFIED");
    if (head.kind === "conflict") return this.#refuse("REFUSED", "CONFLICT", subject, trail, "PAYEE_VERIFIED");
    trail.pass("PAYEE_VERIFIED");
    if (toAddress === head.version.address) return { verdict: "NONE" };
    const earlier = this.#d.index.earlierRefusalFor(toAddress);
    if (earlier) return this.#refuse("REFUSED", "KNOWN_ATTACK_PATTERN", subject, trail, "NOT_KNOWN_ATTACK", earlier.receipt);
    trail.pass("NOT_KNOWN_ATTACK");
    if (imitatesAny(toAddress, this.#d.index.verifiedAddresses())) return this.#refuse("REFUSED", "LOOKALIKE_ADDRESS", subject, trail, "NOT_LOOKALIKE");
    trail.pass("NOT_LOOKALIKE");

    const nonce = this.#d.nonces.next();
    const expires = new Date(this.#d.clock.now().getTime() + CHANGE_REQUEST_LIFETIME_MS).toISOString();
    const stated = this.#payeeVersion(proposal.payeeId, nextVersionNumber(versions), toAddress, "STATED", head.version.version, { kind: "stated", sourceMessageId: message.id, nonce });
    const written = await this.#write(payeeNamespace(this.#d.ownerId, proposal.payeeId), stated, `change:${nonce}:stated`);
    if (written.status === "WRITTEN") this.#d.index.putPayeeVersion(stated);
    this.#d.index.insertPendingChange({ nonce, payeeId: proposal.payeeId, fromAddress: head.version.address, toAddress, expires });
    return { verdict: "CHANGE_STARTED", nonce, expires, fromAddress: head.version.address, toAddress };
  }

  async #reservePayment(message: InboundMessage, proposal: Extract<Proposal, { kind: "pay" }>): Promise<Outcome> {
    const trail = new CheckTrail();
    const subject = { ref: message.id, payeeId: proposal.payeeId, address: null, amountBaseUnits: proposal.amountBaseUnits };
    const read = await this.#d.memory.readAll(payeeNamespace(this.#d.ownerId, proposal.payeeId));
    if (!read.complete) return this.#refuse("REFUSED", "MEMORY_INCOMPLETE", subject, trail, "MEMORY_COMPLETE");
    trail.pass("MEMORY_COMPLETE");
    const stored = versionsFrom(this.#d.signer, read.records, proposal.payeeId);
    if (stored.length === 0) return this.#refuse("REFUSED", "UNKNOWN_PAYEE", subject, trail, "PAYEE_VERIFIED");
    const head = headOf(stored.map((s) => s.record));
    if (head.kind === "none") return this.#refuse("REFUSED", "PAYEE_NOT_VERIFIED", subject, trail, "PAYEE_VERIFIED");
    if (head.kind === "conflict") return this.#refuse("REFUSED", "CONFLICT", subject, trail, "PAYEE_VERIFIED");
    trail.pass("PAYEE_VERIFIED");
    const payee = { ...subject, address: head.version.address };
    if (!/^[1-9]\d*$/.test(proposal.amountBaseUnits)) return this.#refuse("REFUSED", "AMOUNT_INVALID", payee, trail, "AMOUNT_VALID");
    trail.pass("AMOUNT_VALID");
    const amount = BigInt(proposal.amountBaseUnits);
    if (amount > this.#d.caps.perPaymentBaseUnits) return this.#refuse("REFUSED", "CAP_EXCEEDED", payee, trail, "WITHIN_CAPS");
    const now = this.#d.clock.now().toISOString();
    const payeeBlobId = stored.find((s) => s.record.version === head.version.version)?.blobId ?? null;
    const intent = { id: `pay_${this.#d.nonces.next()}`, payeeId: proposal.payeeId, payeeVersion: head.version.version, payeeBlobId, address: head.version.address, amountBaseUnits: amount, period: now.slice(0, 10), createdAt: now };
    if (!this.#d.payments.reservePayment(intent, this.#d.caps.perDayBaseUnits)) return this.#refuse("REFUSED", "CAP_EXCEEDED", payee, trail, "WITHIN_CAPS");
    return { verdict: "PAY_RESERVED", paymentId: intent.id, address: intent.address, amountBaseUnits: amount };
  }

  async #refuse(verdict: "REFUSED" | "CHANGE_REJECTED", reason: ReasonCode, subject: Subject, trail: CheckTrail, failed: Parameters<CheckTrail["fail"]>[0] | null = null, cites: string | null = null): Promise<Refused> {
    if (failed) trail.fail(failed);
    const written = await this.#receipt(verdict, reason, subject, trail, [], null);
    return { verdict: "REFUSED", reason, receipt: written.receipt, cites };
  }

  async #receipt(verdict: ReceiptVerdict, reason: ReasonCode | null, subject: Subject, trail: CheckTrail, memoryBlobIds: readonly string[], suiDigest: string | null, id: string = `rcpt_${this.#d.nonces.next()}`, at: string = this.#d.clock.now().toISOString()): Promise<ReceiptWrite> {
    const record: ReceiptRecord = {
      type: "receipt", receipt: id, verdict, reason, ref: subject.ref, payeeId: subject.payeeId, address: subject.address, amountBaseUnits: subject.amountBaseUnits ?? null,
      checks: trail.checks, memoryBlobIds, suiDigest, network: this.#d.network, createdAt: at,
    };
    const written = await this.#write(receiptsNamespace(this.#d.ownerId), record, `receipt:${id}`);
    indexRecord(this.#d.index, record);
    return { receipt: id, blobId: written.status === "WRITTEN" ? written.blobId : null };
  }

  #payeeVersion(payeeId: string, version: number, address: SuiAddress, status: PayeeVersionRecord["status"], supersedes: number | null, evidence: Evidence): PayeeVersionRecord {
    return { type: "payee_version", payeeId, version, address, status, supersedes, evidence, createdAt: this.#d.clock.now().toISOString() };
  }

  async #write(namespace: string, record: MemoryRecord, idempotencyKey: string) {
    return this.#d.memory.remember(namespace, sealRecord(this.#d.signer, record), idempotencyKey);
  }
}
