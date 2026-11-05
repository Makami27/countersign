import { openRecord, ownerNamespace, sealRecord, type MemoryPort, type OwnerWalletRecord, type RecordSigner, type SignatureVerification, type SuiAddress } from "@countersign/core";
import type { SqlRows } from "@countersign/adapters/sql";

export const OWNER_WALLET_WAIT_MS = 72 * 3600 * 1000;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS owner_wallet_versions (version INTEGER PRIMARY KEY, address TEXT NOT NULL, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS owner_wallet_waiting (address TEXT PRIMARY KEY, ready_at BIGINT NOT NULL, proofs TEXT NOT NULL, verifications TEXT NOT NULL);
`;

export type Proof = OwnerWalletRecord["proofs"][number];
export type OwnerWalletState =
  | { readonly known: true; readonly current: { readonly address: SuiAddress; readonly version: number; readonly since: string } | null; readonly waiting: { readonly address: SuiAddress; readonly readyAt: string } | null }
  | { readonly known: false; readonly why: string };

export type OwnerWalletDeps = { readonly rows: SqlRows; readonly memory: MemoryPort; readonly signer: RecordSigner; readonly ownerId: string; readonly now: () => number };

export class OwnerWallets {
  readonly #d: OwnerWalletDeps;
  #versions: OwnerWalletRecord[] = [];
  #waiting: { address: SuiAddress; readyAt: number; proofs: Proof[]; verifications: SignatureVerification[] } | null = null;
  #known = false;

  private constructor(deps: OwnerWalletDeps) {
    this.#d = deps;
  }

  static async open(deps: OwnerWalletDeps): Promise<OwnerWallets> {
    await deps.rows.exec(SCHEMA);
    const wallets = new OwnerWallets(deps);
    await wallets.restore();
    return wallets;
  }

  async restore(): Promise<void> {
    const cached = (await this.#d.rows.all("SELECT record FROM owner_wallet_versions ORDER BY version")).map((row) => JSON.parse(String(row["record"])) as OwnerWalletRecord);
    const waiting = await this.#d.rows.get("SELECT address, ready_at, proofs, verifications FROM owner_wallet_waiting");
    this.#waiting = waiting ? { address: String(waiting["address"]) as SuiAddress, readyAt: Number(waiting["ready_at"]), proofs: JSON.parse(String(waiting["proofs"])) as Proof[], verifications: JSON.parse(String(waiting["verifications"])) as SignatureVerification[] } : null;
    const read = await this.#d.memory.readAll(ownerNamespace(this.#d.ownerId));
    if (!read.complete) {
      this.#versions = cached;
      this.#known = cached.length > 0;
      return;
    }
    const restored: OwnerWalletRecord[] = [];
    for (const { text } of read.records) {
      const opened = openRecord(this.#d.signer, text);
      if (opened.ok && opened.record.type === "owner_wallet" && opened.record.ownerId === this.#d.ownerId) restored.push(opened.record);
    }
    restored.sort((a, b) => a.version - b.version);
    await this.#d.rows.run("DELETE FROM owner_wallet_versions");
    for (const record of restored) await this.#d.rows.run("INSERT INTO owner_wallet_versions (version, address, record) VALUES (?,?,?)", [record.version, record.address, JSON.stringify(record)]);
    this.#versions = restored;
    this.#known = true;
  }

  state(): OwnerWalletState {
    if (!this.#known) return { known: false, why: "Your wallet's record couldn't be read completely from Walrus Memory." };
    const head = this.#versions.at(-1);
    return {
      known: true,
      current: head ? { address: head.address, version: head.version, since: head.createdAt } : null,
      waiting: this.#waiting ? { address: this.#waiting.address, readyAt: new Date(this.#waiting.readyAt).toISOString() } : null,
    };
  }

  current(): SuiAddress | null {
    return this.#known ? (this.#versions.at(-1)?.address ?? null) : null;
  }

  async record(address: SuiAddress, how: OwnerWalletRecord["how"], proofs: readonly Proof[], verifications: readonly SignatureVerification[]): Promise<"WRITTEN" | "UNKNOWN"> {
    const head = this.#versions.at(-1);
    const record: OwnerWalletRecord = { type: "owner_wallet", ownerId: this.#d.ownerId, version: (head?.version ?? 0) + 1, address, previous: head?.address ?? null, how, proofs, verifications, createdAt: new Date(this.#d.now()).toISOString() };
    const written = await this.#d.memory.remember(ownerNamespace(this.#d.ownerId), sealRecord(this.#d.signer, record), `owner-wallet:v${record.version}:${address}`);
    if (written.status !== "WRITTEN") return "UNKNOWN";
    await this.#d.rows.run("INSERT INTO owner_wallet_versions (version, address, record) VALUES (?,?,?)", [record.version, record.address, JSON.stringify(record)]);
    this.#versions = [...this.#versions, record];
    this.#known = true;
    return "WRITTEN";
  }

  async wait(address: SuiAddress, proofs: readonly Proof[], verifications: readonly SignatureVerification[]): Promise<string> {
    const readyAt = this.#d.now() + OWNER_WALLET_WAIT_MS;
    await this.#d.rows.run("DELETE FROM owner_wallet_waiting");
    await this.#d.rows.run("INSERT INTO owner_wallet_waiting (address, ready_at, proofs, verifications) VALUES (?,?,?,?)", [address, readyAt, JSON.stringify(proofs), JSON.stringify(verifications)]);
    this.#waiting = { address, readyAt, proofs: [...proofs], verifications: [...verifications] };
    return new Date(readyAt).toISOString();
  }

  async cancelWaiting(): Promise<SuiAddress | null> {
    const waiting = this.#waiting;
    await this.#d.rows.run("DELETE FROM owner_wallet_waiting");
    this.#waiting = null;
    return waiting?.address ?? null;
  }

  async applyDue(): Promise<OwnerWalletRecord | null> {
    const waiting = this.#waiting;
    if (!waiting || waiting.readyAt > this.#d.now() || !this.#known) return null;
    if ((await this.record(waiting.address, "cooldown_elapsed", waiting.proofs, waiting.verifications)) !== "WRITTEN") return null;
    await this.cancelWaiting();
    return this.#versions.at(-1) ?? null;
  }
}
