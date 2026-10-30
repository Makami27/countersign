import type { IndexStore, MemoryPort, MemoryRead, MemoryWrite, PaymentLedger, PendingChange, PendingOnboarding, StoredText } from "../ports.ts";
import { remembersAttack } from "../receipts.ts";
import { statesThatMayMoveTo, type NewPaymentIntent, type PaymentIntent, type PaymentMove } from "../payments.ts";
import type { PayeeVersionRecord, ReceiptRecord, SuiAddress } from "../types.ts";

export class InMemoryMemory implements MemoryPort {
  readonly spaces = new Map<string, StoredText[]>();
  readonly keys = new Map<string, string>();
  failNextWrite = false;
  dropOnRead: string | null = null;

  async remember(namespace: string, text: string, idempotencyKey: string): Promise<MemoryWrite> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return { status: "UNKNOWN" };
    }
    const existing = this.keys.get(`${namespace}:${idempotencyKey}`);
    if (existing) return { status: "WRITTEN", blobId: existing };
    const blobId = `blob_${this.keys.size + 1}`;
    this.keys.set(`${namespace}:${idempotencyKey}`, blobId);
    this.spaces.set(namespace, [...(this.spaces.get(namespace) ?? []), { text, blobId }]);
    return { status: "WRITTEN", blobId };
  }

  async readAll(namespace: string): Promise<MemoryRead> {
    if (this.dropOnRead === namespace) return { complete: false, why: "DROPPED" };
    return { complete: true, records: this.spaces.get(namespace) ?? [] };
  }

  async listNamespaces(prefix: string): Promise<readonly string[]> {
    return [...this.spaces.keys()].filter((ns) => ns.startsWith(prefix));
  }

  plant(namespace: string, text: string): void {
    const existing = this.spaces.get(namespace) ?? [];
    this.spaces.set(namespace, [...existing, { text, blobId: `planted_${namespace.length}_${existing.length + 1}` }]);
  }
}

export class InMemoryIndex implements IndexStore {
  #versions: PayeeVersionRecord[] = [];
  #receipts: ReceiptRecord[] = [];
  readonly #pending = new Map<string, { change: PendingChange; used: boolean }>();
  readonly #onboardings = new Map<string, { onboarding: PendingOnboarding; used: boolean }>();

  putPayeeVersion(record: PayeeVersionRecord): void {
    this.#versions = [...this.#versions.filter((v) => !(v.payeeId === record.payeeId && v.version === record.version)), record];
  }
  payeeVersions(payeeId: string): readonly PayeeVersionRecord[] {
    return this.#versions.filter((v) => v.payeeId === payeeId);
  }
  payeeIds(): readonly string[] {
    return [...new Set(this.#versions.map((v) => v.payeeId))].sort();
  }
  verifiedAddresses(): readonly SuiAddress[] {
    return [...new Set(this.#versions.filter((v) => v.status === "VERIFIED").map((v) => v.address))];
  }
  putReceipt(record: ReceiptRecord): void {
    this.#receipts = [...this.#receipts.filter((r) => r.receipt !== record.receipt), record];
  }
  receipt(id: string): ReceiptRecord | null {
    return this.#receipts.find((r) => r.receipt === id) ?? null;
  }
  earlierRefusalFor(address: SuiAddress): ReceiptRecord | null {
    return this.#receipts.find((r) => remembersAttack(r) && r.address === address) ?? null;
  }
  insertPendingChange(change: PendingChange): void {
    this.#pending.set(change.nonce, { change, used: false });
  }
  pendingChange(nonce: string): PendingChange | null {
    const entry = this.#pending.get(nonce);
    return entry && !entry.used ? entry.change : null;
  }
  consumePendingChange(nonce: string): boolean {
    const entry = this.#pending.get(nonce);
    if (!entry || entry.used) return false;
    entry.used = true;
    return true;
  }
  insertPendingOnboarding(onboarding: PendingOnboarding): void {
    this.#onboardings.set(onboarding.nonce, { onboarding, used: false });
  }
  pendingOnboarding(nonce: string): PendingOnboarding | null {
    const entry = this.#onboardings.get(nonce);
    return entry && !entry.used ? entry.onboarding : null;
  }
  consumePendingOnboarding(nonce: string): boolean {
    const entry = this.#onboardings.get(nonce);
    if (!entry || entry.used) return false;
    entry.used = true;
    return true;
  }
  clearIndex(): void {
    this.#versions = [];
    this.#receipts = [];
  }
}

export class InMemoryPaymentLedger implements PaymentLedger {
  readonly #payments = new Map<string, PaymentIntent>();
  readonly #reserved = new Map<string, bigint>();

  reservePayment(intent: NewPaymentIntent, perDayCapBaseUnits: bigint): boolean {
    const current = this.#reserved.get(intent.period) ?? 0n;
    if (this.#payments.has(intent.id) || current + intent.amountBaseUnits > perDayCapBaseUnits) return false;
    this.#reserved.set(intent.period, current + intent.amountBaseUnits);
    this.#payments.set(intent.id, { ...intent, state: "RESERVED", digest: null, validUntilEpoch: null, detail: null, reason: null, updatedAt: intent.createdAt });
    return true;
  }

  movePayment(id: string, move: PaymentMove): boolean {
    const payment = this.#payments.get(id);
    if (!payment || !statesThatMayMoveTo(move.to).includes(payment.state)) return false;
    if (move.to === "FAILED") this.#reserved.set(payment.period, (this.#reserved.get(payment.period) ?? 0n) - payment.amountBaseUnits);
    this.#payments.set(id, {
      ...payment,
      state: move.to,
      detail: move.detail,
      reason: move.reason ?? payment.reason,
      updatedAt: move.at,
      digest: move.digest ?? payment.digest,
      validUntilEpoch: move.validUntilEpoch === undefined ? payment.validUntilEpoch : move.validUntilEpoch,
    });
    return true;
  }

  payment(id: string): PaymentIntent | null {
    return this.#payments.get(id) ?? null;
  }

  unresolvedPayments(): readonly PaymentIntent[] {
    return [...this.#payments.values()].filter((p) => p.state === "SENDING" || p.state === "SENT" || p.state === "UNKNOWN");
  }

  reservedFor(period: string): bigint {
    return this.#reserved.get(period) ?? 0n;
  }
}
