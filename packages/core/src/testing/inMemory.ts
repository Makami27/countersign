import type { IndexStore, MemoryPort, MemoryRead, MemoryWrite, PaymentLedger, PendingChange } from "../ports.ts";
import { statesThatMayMoveTo, type NewPaymentIntent, type PaymentIntent, type PaymentMove } from "../payments.ts";
import type { PayeeVersionRecord, RefusalRecord, SuiAddress } from "../types.ts";

export class InMemoryMemory implements MemoryPort {
  readonly spaces = new Map<string, string[]>();
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
    this.spaces.set(namespace, [...(this.spaces.get(namespace) ?? []), text]);
    return { status: "WRITTEN", blobId };
  }

  async readAll(namespace: string): Promise<MemoryRead> {
    if (this.dropOnRead === namespace) return { complete: false, why: "DROPPED" };
    return { complete: true, texts: this.spaces.get(namespace) ?? [] };
  }

  async listNamespaces(prefix: string): Promise<readonly string[]> {
    return [...this.spaces.keys()].filter((ns) => ns.startsWith(prefix));
  }

  plant(namespace: string, text: string): void {
    this.spaces.set(namespace, [...(this.spaces.get(namespace) ?? []), text]);
  }
}

export class InMemoryIndex implements IndexStore {
  #versions: PayeeVersionRecord[] = [];
  #refusals: RefusalRecord[] = [];
  readonly #pending = new Map<string, { change: PendingChange; used: boolean }>();

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
  putRefusal(record: RefusalRecord): void {
    this.#refusals.push(record);
  }
  earlierRefusalFor(address: SuiAddress): RefusalRecord | null {
    return this.#refusals.find((r) => r.address === address) ?? null;
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
  clearIndex(): void {
    this.#versions = [];
    this.#refusals = [];
  }
}

export class InMemoryPaymentLedger implements PaymentLedger {
  readonly #payments = new Map<string, PaymentIntent>();
  readonly #reserved = new Map<string, bigint>();

  reservePayment(intent: NewPaymentIntent, perDayCapBaseUnits: bigint): boolean {
    const current = this.#reserved.get(intent.period) ?? 0n;
    if (this.#payments.has(intent.id) || current + intent.amountBaseUnits > perDayCapBaseUnits) return false;
    this.#reserved.set(intent.period, current + intent.amountBaseUnits);
    this.#payments.set(intent.id, { ...intent, state: "RESERVED", digest: null, validUntilEpoch: null, detail: null, updatedAt: intent.createdAt });
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
