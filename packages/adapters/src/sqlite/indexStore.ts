import { DatabaseSync } from "node:sqlite";
import { remembersAttack, type IndexStore, type PayeeVersionRecord, type PendingChange, type PendingOnboarding, type ReceiptRecord, type SuiAddress } from "@countersign/core";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payee_versions (
  payee_id TEXT NOT NULL, version INTEGER NOT NULL, address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VERIFIED','STATED','REVOKED')),
  record TEXT NOT NULL, PRIMARY KEY (payee_id, version));
CREATE TABLE IF NOT EXISTS receipts (
  receipt TEXT PRIMARY KEY,
  verdict TEXT NOT NULL CHECK (verdict IN ('PAID','PAYMENT_FAILED','REFUSED','CHANGE_VERIFIED','CHANGE_REJECTED')),
  attack_address TEXT, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pending_onboardings (
  nonce TEXT PRIMARY KEY, payee_id TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL,
  expires TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)));
CREATE TABLE IF NOT EXISTS pending_changes (
  nonce TEXT PRIMARY KEY, payee_id TEXT NOT NULL, from_address TEXT NOT NULL, to_address TEXT NOT NULL,
  expires TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1)));
`;

export class SqliteIndex implements IndexStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec(SCHEMA);
  }

  putPayeeVersion(record: PayeeVersionRecord): void {
    this.#db.prepare("INSERT OR REPLACE INTO payee_versions VALUES (?,?,?,?,?)").run(record.payeeId, record.version, record.address, record.status, JSON.stringify(record));
  }

  payeeVersions(payeeId: string): readonly PayeeVersionRecord[] {
    const rows = this.#db.prepare("SELECT record FROM payee_versions WHERE payee_id = ? ORDER BY version").all(payeeId);
    return rows.map((row) => JSON.parse(String(row["record"])) as PayeeVersionRecord);
  }

  payeeIds(): readonly string[] {
    return this.#db.prepare("SELECT DISTINCT payee_id FROM payee_versions ORDER BY payee_id").all().map((row) => String(row["payee_id"]));
  }

  verifiedAddresses(): readonly SuiAddress[] {
    return this.#db.prepare("SELECT DISTINCT address FROM payee_versions WHERE status = 'VERIFIED'").all().map((row) => String(row["address"]) as SuiAddress);
  }

  putReceipt(record: ReceiptRecord): void {
    this.#db.prepare("INSERT OR REPLACE INTO receipts VALUES (?,?,?,?)").run(record.receipt, record.verdict, remembersAttack(record) ? record.address : null, JSON.stringify(record));
  }

  receipt(id: string): ReceiptRecord | null {
    const row = this.#db.prepare("SELECT record FROM receipts WHERE receipt = ?").get(id);
    return row ? (JSON.parse(String(row["record"])) as ReceiptRecord) : null;
  }

  earlierRefusalFor(address: SuiAddress): ReceiptRecord | null {
    const row = this.#db.prepare("SELECT record FROM receipts WHERE attack_address = ? ORDER BY json_extract(record, '$.createdAt') LIMIT 1").get(address);
    return row ? (JSON.parse(String(row["record"])) as ReceiptRecord) : null;
  }

  insertPendingChange(change: PendingChange): void {
    this.#db.prepare("INSERT INTO pending_changes (nonce, payee_id, from_address, to_address, expires) VALUES (?,?,?,?,?)").run(change.nonce, change.payeeId, change.fromAddress, change.toAddress, change.expires);
  }

  pendingChange(nonce: string): PendingChange | null {
    const row = this.#db.prepare("SELECT * FROM pending_changes WHERE nonce = ? AND used = 0").get(nonce);
    if (!row) return null;
    return { nonce: String(row["nonce"]), payeeId: String(row["payee_id"]), fromAddress: String(row["from_address"]) as SuiAddress, toAddress: String(row["to_address"]) as SuiAddress, expires: String(row["expires"]) };
  }

  insertPendingOnboarding(onboarding: PendingOnboarding): void {
    this.#db.prepare("INSERT INTO pending_onboardings (nonce, payee_id, name, address, expires) VALUES (?,?,?,?,?)").run(onboarding.nonce, onboarding.payeeId, onboarding.name, onboarding.address, onboarding.expires);
  }

  pendingOnboarding(nonce: string): PendingOnboarding | null {
    const row = this.#db.prepare("SELECT * FROM pending_onboardings WHERE nonce = ? AND used = 0").get(nonce);
    if (!row) return null;
    return { nonce: String(row["nonce"]), payeeId: String(row["payee_id"]), name: String(row["name"]), address: String(row["address"]) as SuiAddress, expires: String(row["expires"]) };
  }

  consumePendingOnboarding(nonce: string): boolean {
    return Number(this.#db.prepare("UPDATE pending_onboardings SET used = 1 WHERE nonce = ? AND used = 0").run(nonce).changes) === 1;
  }

  receiptsFor(payeeId: string | null, limit: number): readonly ReceiptRecord[] {
    const rows = payeeId === null
      ? this.#db.prepare("SELECT record FROM receipts ORDER BY json_extract(record, '$.createdAt') DESC LIMIT ?").all(limit)
      : this.#db.prepare("SELECT record FROM receipts WHERE json_extract(record, '$.payeeId') = ? ORDER BY json_extract(record, '$.createdAt') DESC LIMIT ?").all(payeeId, limit);
    return rows.map((row) => JSON.parse(String(row["record"])) as ReceiptRecord);
  }

  pendingChangesFor(payeeId: string): readonly PendingChange[] {
    return this.#db.prepare("SELECT * FROM pending_changes WHERE payee_id = ? AND used = 0 ORDER BY expires DESC").all(payeeId)
      .map((row) => ({ nonce: String(row["nonce"]), payeeId: String(row["payee_id"]), fromAddress: String(row["from_address"]) as SuiAddress, toAddress: String(row["to_address"]) as SuiAddress, expires: String(row["expires"]) }));
  }

  pendingOnboardingFor(payeeId: string): PendingOnboarding | null {
    const row = this.#db.prepare("SELECT nonce FROM pending_onboardings WHERE payee_id = ? AND used = 0 ORDER BY expires DESC LIMIT 1").get(payeeId);
    return row ? this.pendingOnboarding(String(row["nonce"])) : null;
  }

  consumePendingChange(nonce: string): boolean {
    return Number(this.#db.prepare("UPDATE pending_changes SET used = 1 WHERE nonce = ? AND used = 0").run(nonce).changes) === 1;
  }

  clearIndex(): void {
    this.#db.exec("DELETE FROM payee_versions; DELETE FROM receipts;");
  }
}
