import type { IndexStore, MemoryPort, MemoryRead, MemoryWrite, PendingChange } from "../ports.ts";
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
  readonly #budget = new Map<string, bigint>();

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
  reserveBudget(period: string, amount: bigint, cap: bigint): boolean {
    const current = this.#budget.get(period) ?? 0n;
    if (current + amount > cap) return false;
    this.#budget.set(period, current + amount);
    return true;
  }
  clearIndex(): void {
    this.#versions = [];
    this.#refusals = [];
  }
}
