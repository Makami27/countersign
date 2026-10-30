import { appearsVerbatim, imitatesAny, parseSuiAddress } from "./address.ts";
import { CHANGE_REQUEST_LIFETIME_MS, changeMessage } from "./changeMessage.ts";
import { headOf, nextVersionNumber, payeeIdFromNamespace, payeeNamespace, refusalsNamespace } from "./payeeBook.ts";
import { openRecord, sealRecord } from "./records.ts";
import type { Clock, IndexStore, MemoryPort, NonceSource, PaymentLedger, RecordSigner, SignatureVerifier } from "./ports.ts";
import type { ContinuityProof, ControlProof, Evidence, InboundMessage, MemoryRecord, Outcome, PayeeVersionRecord, Proposal, Refused, SuiAddress } from "./types.ts";
import { REASONS, type ReasonCode } from "./vocabulary.ts";

export type RoundTripResult = "PROVEN" | "NOT_PROVEN" | "UNKNOWN";

export interface RoundTripChecker {
  check(proof: Extract<ControlProof, { kind: "round_trip" }>, toAddress: SuiAddress): Promise<RoundTripResult>;
}

export type Caps = { readonly perPaymentBaseUnits: bigint; readonly perDayBaseUnits: bigint };

export type EngineDeps = {
  readonly ownerId: string;
  readonly memory: MemoryPort & { listNamespaces(prefix: string): Promise<readonly string[] | null> };
  readonly index: IndexStore;
  readonly payments: PaymentLedger;
  readonly signer: RecordSigner;
  readonly signatures: SignatureVerifier;
  readonly roundTrips: RoundTripChecker;
  readonly clock: Clock;
  readonly nonces: NonceSource;
  readonly caps: Caps;
  readonly cooldownMs: number;
};

export type RestoreResult = { readonly ok: true; readonly ignored: number; readonly payees: number } | { readonly ok: false; readonly reason: "MEMORY_INCOMPLETE" };

export class Countersign {
  readonly #d: EngineDeps;

  constructor(deps: EngineDeps) {
    this.#d = deps;
  }

  async onboardPayee(payeeId: string, address: string, ownerConfirmationId: string): Promise<Outcome> {
    const parsed = parseSuiAddress(address);
    if (!parsed) return this.#refuse("ADDRESS_NOT_IN_MESSAGE", payeeId, payeeId, null);
    const versions = this.#d.index.payeeVersions(payeeId);
    if (headOf(versions).kind !== "none") return this.#refuse("CONFLICT", payeeId, payeeId, null);
    const record = this.#payeeVersion(payeeId, nextVersionNumber(versions), parsed, "VERIFIED", null, { kind: "owner_onboarding", ownerConfirmationId });
    const written = await this.#write(payeeNamespace(this.#d.ownerId, payeeId), record, `onboard:${payeeId}:${parsed}`);
    if (written.status !== "WRITTEN") return this.#refuse("MEMORY_INCOMPLETE", payeeId, payeeId, null);
    this.#d.index.putPayeeVersion(record);
    return { verdict: "CHANGE_VERIFIED", version: record.version, blobId: written.blobId };
  }

  payeeIds(): readonly string[] {
    return this.#d.index.payeeIds();
  }

  async handle(message: InboundMessage, proposal: Proposal): Promise<Outcome> {
    if (proposal.kind === "change_address") return this.#requestChange(message, proposal);
    if (proposal.kind === "pay") return this.#reservePayment(message, proposal);
    return { verdict: "NONE" };
  }

  async completeChange(nonce: string, continuity: ContinuityProof, control: ControlProof): Promise<Outcome> {
    const change = this.#d.index.pendingChange(nonce);
    if (!change) return this.#refuse("NONCE_REUSED", nonce, null, null);
    if (new Date(change.expires) < this.#d.clock.now()) return this.#refuse("EXPIRED", nonce, change.payeeId, change.toAddress);
    const head = headOf(this.#d.index.payeeVersions(change.payeeId));
    if (head.kind !== "verified" || head.version.address !== change.fromAddress) return this.#refuse("CONFLICT", nonce, change.payeeId, null);
    const message = changeMessage(change);

    const continuityReason = await this.#checkContinuity(continuity, message, change.fromAddress);
    if (continuityReason) return this.#refuse(continuityReason, nonce, change.payeeId, change.toAddress);
    const controlReason = await this.#checkControl(control, message, change.toAddress);
    if (controlReason) return this.#refuse(controlReason, nonce, change.payeeId, change.toAddress);

    const versions = this.#d.index.payeeVersions(change.payeeId);
    const evidence: Evidence = continuity.kind === "signature"
      ? { kind: "continuity_signature", nonce, signature: continuity.signature, control }
      : { kind: "owner_confirmed_change", nonce, ownerConfirmationId: continuity.ownerConfirmationId, control };
    const record = this.#payeeVersion(change.payeeId, nextVersionNumber(versions), change.toAddress, "VERIFIED", head.version.version, evidence);
    const written = await this.#write(payeeNamespace(this.#d.ownerId, change.payeeId), record, `change:${nonce}:verified`);
    if (written.status !== "WRITTEN") return this.#refuse("MEMORY_INCOMPLETE", nonce, change.payeeId, null);
    if (!this.#d.index.consumePendingChange(nonce)) return this.#refuse("NONCE_REUSED", nonce, change.payeeId, null);
    this.#d.index.putPayeeVersion(record);
    return { verdict: "CHANGE_VERIFIED", version: record.version, blobId: written.blobId };
  }

  async restore(): Promise<RestoreResult> {
    const prefix = `countersign:${this.#d.ownerId}:`;
    const namespaces = await this.#d.memory.listNamespaces(prefix);
    if (!namespaces) return { ok: false, reason: "MEMORY_INCOMPLETE" };
    const reads = await Promise.all(namespaces.map(async (ns) => ({ ns, read: await this.#d.memory.readAll(ns) })));
    if (reads.some((r) => !r.read.complete)) return { ok: false, reason: "MEMORY_INCOMPLETE" };
    this.#d.index.clearIndex();
    let ignored = 0;
    let payees = 0;
    for (const { ns, read } of reads) {
      if (!read.complete) continue;
      const payeeId = payeeIdFromNamespace(this.#d.ownerId, ns);
      if (payeeId) payees += 1;
      for (const text of read.texts) {
        const opened = openRecord(this.#d.signer, text);
        if (!opened.ok || !this.#belongs(opened.record, ns, payeeId)) {
          ignored += 1;
          continue;
        }
        this.#index(opened.record);
      }
    }
    return { ok: true, ignored, payees };
  }

  async #requestChange(message: InboundMessage, proposal: Extract<Proposal, { kind: "change_address" }>): Promise<Outcome> {
    const toAddress = parseSuiAddress(proposal.newAddress);
    if (!toAddress || !appearsVerbatim(toAddress, message.text)) return this.#refuse("ADDRESS_NOT_IN_MESSAGE", message.id, proposal.payeeId, null);
    const versions = this.#d.index.payeeVersions(proposal.payeeId);
    const head = headOf(versions);
    if (head.kind === "none") return this.#refuse("PAYEE_NOT_VERIFIED", message.id, proposal.payeeId, toAddress);
    if (head.kind === "conflict") return this.#refuse("CONFLICT", message.id, proposal.payeeId, toAddress);
    if (toAddress === head.version.address) return { verdict: "NONE" };
    const earlier = this.#d.index.earlierRefusalFor(toAddress);
    if (earlier) return this.#refuse("KNOWN_ATTACK_PATTERN", message.id, proposal.payeeId, toAddress, earlier.receipt);
    if (imitatesAny(toAddress, this.#d.index.verifiedAddresses())) return this.#refuse("LOOKALIKE_ADDRESS", message.id, proposal.payeeId, toAddress);

    const nonce = this.#d.nonces.next();
    const expires = new Date(this.#d.clock.now().getTime() + CHANGE_REQUEST_LIFETIME_MS).toISOString();
    const stated = this.#payeeVersion(proposal.payeeId, nextVersionNumber(versions), toAddress, "STATED", head.version.version, { kind: "stated", sourceMessageId: message.id, nonce });
    const written = await this.#write(payeeNamespace(this.#d.ownerId, proposal.payeeId), stated, `change:${nonce}:stated`);
    if (written.status === "WRITTEN") this.#d.index.putPayeeVersion(stated);
    this.#d.index.insertPendingChange({ nonce, payeeId: proposal.payeeId, fromAddress: head.version.address, toAddress, expires });
    return { verdict: "CHANGE_STARTED", nonce, expires, fromAddress: head.version.address, toAddress };
  }

  async #reservePayment(message: InboundMessage, proposal: Extract<Proposal, { kind: "pay" }>): Promise<Outcome> {
    const read = await this.#d.memory.readAll(payeeNamespace(this.#d.ownerId, proposal.payeeId));
    if (!read.complete) return this.#refuse("MEMORY_INCOMPLETE", message.id, proposal.payeeId, null);
    const versions = this.#versionsFrom(read.texts, proposal.payeeId);
    if (versions.length === 0) return this.#refuse("UNKNOWN_PAYEE", message.id, proposal.payeeId, null);
    const head = headOf(versions);
    if (head.kind === "none") return this.#refuse("PAYEE_NOT_VERIFIED", message.id, proposal.payeeId, null);
    if (head.kind === "conflict") return this.#refuse("CONFLICT", message.id, proposal.payeeId, null);
    if (!/^[1-9]\d*$/.test(proposal.amountBaseUnits)) return this.#refuse("AMOUNT_INVALID", message.id, proposal.payeeId, null);
    const amount = BigInt(proposal.amountBaseUnits);
    if (amount > this.#d.caps.perPaymentBaseUnits) return this.#refuse("CAP_EXCEEDED", message.id, proposal.payeeId, null);
    const now = this.#d.clock.now().toISOString();
    const intent = { id: `pay_${this.#d.nonces.next()}`, payeeId: proposal.payeeId, payeeVersion: head.version.version, address: head.version.address, amountBaseUnits: amount, period: now.slice(0, 10), createdAt: now };
    if (!this.#d.payments.reservePayment(intent, this.#d.caps.perDayBaseUnits)) return this.#refuse("CAP_EXCEEDED", message.id, proposal.payeeId, null);
    return { verdict: "PAY_RESERVED", paymentId: intent.id, address: intent.address, amountBaseUnits: amount };
  }

  async #checkContinuity(proof: ContinuityProof, message: string, fromAddress: SuiAddress): Promise<ReasonCode | null> {
    if (proof.kind === "owner_confirmed") {
      const readyAt = new Date(proof.confirmedAt).getTime() + this.#d.cooldownMs;
      return Number.isFinite(readyAt) && readyAt <= this.#d.clock.now().getTime() ? null : "COOLDOWN_ACTIVE";
    }
    const result = await this.#d.signatures.verifyPersonalMessage(message, proof.signature, fromAddress);
    return result === "VALID" ? null : result === "UNKNOWN" ? "CHAIN_UNKNOWN" : "NO_CONTINUITY";
  }

  async #checkControl(proof: ControlProof, message: string, toAddress: SuiAddress): Promise<ReasonCode | null> {
    if (proof.kind === "round_trip") {
      const result = await this.#d.roundTrips.check(proof, toAddress);
      return result === "PROVEN" ? null : result === "UNKNOWN" ? "CHAIN_UNKNOWN" : "CONTROL_NOT_PROVEN";
    }
    const result = await this.#d.signatures.verifyPersonalMessage(message, proof.signature, toAddress);
    return result === "VALID" ? null : result === "UNKNOWN" ? "CHAIN_UNKNOWN" : "CONTROL_NOT_PROVEN";
  }

  async #refuse(reason: ReasonCode, ref: string, payeeId: string | null, address: SuiAddress | null, cites: string | null = null): Promise<Refused> {
    const receipt = `rcpt_${this.#d.nonces.next()}`;
    const remembersAddress = !REASONS[reason].retryable && reason !== "KNOWN_ATTACK_PATTERN";
    const record: MemoryRecord = { type: "refusal", receipt, reason, ref, payeeId, address: remembersAddress ? address : null, createdAt: this.#d.clock.now().toISOString() };
    await this.#write(refusalsNamespace(this.#d.ownerId), record, `refusal:${receipt}`);
    this.#index(record);
    return { verdict: "REFUSED", reason, receipt, cites };
  }

  #payeeVersion(payeeId: string, version: number, address: SuiAddress, status: PayeeVersionRecord["status"], supersedes: number | null, evidence: Evidence): PayeeVersionRecord {
    return { type: "payee_version", payeeId, version, address, status, supersedes, evidence, createdAt: this.#d.clock.now().toISOString() };
  }

  async #write(namespace: string, record: MemoryRecord, idempotencyKey: string) {
    return this.#d.memory.remember(namespace, sealRecord(this.#d.signer, record), idempotencyKey);
  }

  #index(record: MemoryRecord): void {
    if (record.type === "payee_version") this.#d.index.putPayeeVersion(record);
    else this.#d.index.putRefusal(record);
  }

  #versionsFrom(texts: readonly string[], payeeId: string): PayeeVersionRecord[] {
    const versions: PayeeVersionRecord[] = [];
    for (const text of texts) {
      const opened = openRecord(this.#d.signer, text);
      if (opened.ok && opened.record.type === "payee_version" && opened.record.payeeId === payeeId) versions.push(opened.record);
    }
    return versions;
  }

  #belongs(record: MemoryRecord, namespace: string, payeeId: string | null): boolean {
    if (record.type === "payee_version") return payeeId !== null && record.payeeId === payeeId;
    return namespace === refusalsNamespace(this.#d.ownerId);
  }
}
