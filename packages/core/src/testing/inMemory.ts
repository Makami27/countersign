import type { IndexStore, MemoryPort, MemoryRead, MemoryWrite, PaymentLedger, PendingChange, PendingOnboarding, Reservation, StoredText } from "../ports.ts";
import { isPayeeHead } from "../payeeBook.ts";
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

  async putPayeeVersion(record: PayeeVersionRecord): Promise<void> {
    this.#versions = [...this.#versions.filter((v) => !(v.payeeId === record.payeeId && v.version === record.version)), record];
  }
  async payeeVersions(payeeId: string): Promise<readonly PayeeVersionRecord[]> {
    return this.versionsNow(payeeId);
  }
  versionsNow(payeeId: string): readonly PayeeVersionRecord[] {
    return this.#versions.filter((v) => v.payeeId === payeeId);
  }
  async payeeIds(): Promise<readonly string[]> {
    return [...new Set(this.#versions.map((v) => v.payeeId))].sort();
  }
  async verifiedAddresses(): Promise<readonly SuiAddress[]> {
    return [...new Set(this.#versions.filter((v) => v.status === "VERIFIED").map((v) => v.address))];
  }
  async putReceipt(record: ReceiptRecord): Promise<void> {
    this.#receipts = [...this.#receipts.filter((r) => r.receipt !== record.receipt), record];
  }
  async receipt(id: string): Promise<ReceiptRecord | null> {
    return this.#receipts.find((r) => r.receipt === id) ?? null;
  }
  async earlierRefusalFor(address: SuiAddress): Promise<ReceiptRecord | null> {
    return this.#receipts.find((r) => remembersAttack(r) && r.address === address) ?? null;
  }
  async insertPendingChange(change: PendingChange): Promise<void> {
    this.#pending.set(change.nonce, { change, used: false });
  }
  async pendingChange(nonce: string): Promise<PendingChange | null> {
    const entry = this.#pending.get(nonce);
    return entry && !entry.used ? entry.change : null;
  }
  async consumePendingChange(nonce: string): Promise<boolean> {
    const entry = this.#pending.get(nonce);
    if (!entry || entry.used) return false;
    entry.used = true;
    return true;
  }
  async insertPendingOnboarding(onboarding: PendingOnboarding): Promise<void> {
    this.#onboardings.set(onboarding.nonce, { onboarding, used: false });
  }
  async pendingOnboarding(nonce: string): Promise<PendingOnboarding | null> {
    const entry = this.#onboardings.get(nonce);
    return entry && !entry.used ? entry.onboarding : null;
  }
  async consumePendingOnboarding(nonce: string): Promise<boolean> {
    const entry = this.#onboardings.get(nonce);
    if (!entry || entry.used) return false;
    entry.used = true;
    return true;
  }
  async receiptsFor(payeeId: string | null, limit: number): Promise<readonly ReceiptRecord[]> {
    return this.#receipts.filter((r) => payeeId === null || r.payeeId === payeeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async pendingChangesFor(payeeId: string): Promise<readonly PendingChange[]> {
    return [...this.#pending.values()].filter((e) => !e.used && e.change.payeeId === payeeId).map((e) => e.change);
  }
  async pendingOnboardingFor(payeeId: string): Promise<PendingOnboarding | null> {
    return [...this.#onboardings.values()].find((e) => !e.used && e.onboarding.payeeId === payeeId)?.onboarding ?? null;
  }
  async clearIndex(): Promise<void> {
    this.#versions = [];
    this.#receipts = [];
  }
}

export class InMemoryPaymentLedger implements PaymentLedger {
  readonly #payments = new Map<string, PaymentIntent>();
  readonly #reserved = new Map<string, bigint>();
  readonly #index: InMemoryIndex;

  constructor(index: InMemoryIndex) {
    this.#index = index;
  }

  async reservePayment(intent: NewPaymentIntent, perDayCapBaseUnits: bigint): Promise<Reservation> {
    if (!isPayeeHead(this.#index.versionsNow(intent.payeeId), intent)) return "PAYEE_CHANGED";
    const current = this.#reserved.get(intent.period) ?? 0n;
    if (this.#payments.has(intent.id)) return "DUPLICATE";
    if (current + intent.amountBaseUnits > perDayCapBaseUnits) return "CAP_EXCEEDED";
    this.#reserved.set(intent.period, current + intent.amountBaseUnits);
    this.#payments.set(intent.id, { ...intent, state: "RESERVED", digest: null, validUntilEpoch: null, detail: null, reason: null, updatedAt: intent.createdAt });
    return "RESERVED";
  }

  async movePayment(id: string, move: PaymentMove): Promise<boolean> {
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

  async payment(id: string): Promise<PaymentIntent | null> {
    return this.#payments.get(id) ?? null;
  }

  async unresolvedPayments(): Promise<readonly PaymentIntent[]> {
    return [...this.#payments.values()].filter((p) => p.state === "SENDING" || p.state === "SENT" || p.state === "UNKNOWN");
  }

  async recentPayments(limit: number, payeeId: string | null): Promise<readonly PaymentIntent[]> {
    return [...this.#payments.values()].filter((p) => payeeId === null || p.payeeId === payeeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async reservedFor(period: string): Promise<bigint> {
    return this.#reserved.get(period) ?? 0n;
  }
}
