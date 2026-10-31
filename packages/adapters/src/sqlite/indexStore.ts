import { DatabaseSync } from "node:sqlite";
import { PAYEE_VERSIONS_TABLE } from "./payeeVersionsTable.ts";
import { remembersAttack, type IndexStore, type PayeeVersionRecord, type PendingChange, type PendingOnboarding, type ReceiptRecord, type SuiAddress } from "@countersign/core";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS receipts (
  receipt TEXT PRIMARY KEY,
  verdict TEXT NOT NULL CHECK (verdict IN ('PAID','PAYMENT_FAILED','REFUSED','CHANGE_VERIFIED','CHANGE_REJECTED')),
  attack_address TEXT, record TEXT NOT NULL, blob_id TEXT);
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
    this.#db.exec(PAYEE_VERSIONS_TABLE);
    this.#db.exec(SCHEMA);
    const columns = this.#db.prepare("PRAGMA table_info(receipts)").all().map((row) => String(row["name"]));
    if (!columns.includes("blob_id")) this.#db.exec("ALTER TABLE receipts ADD COLUMN blob_id TEXT");
  }

  async putPayeeVersion(record: PayeeVersionRecord): Promise<void> {
    this.#db.prepare("INSERT OR REPLACE INTO payee_versions VALUES (?,?,?,?,?)").run(record.payeeId, record.version, record.address, record.status, JSON.stringify(record));
  }

  async payeeVersions(payeeId: string): Promise<readonly PayeeVersionRecord[]> {
    const rows = this.#db.prepare("SELECT record FROM payee_versions WHERE payee_id = ? ORDER BY version").all(payeeId);
    return rows.map((row) => JSON.parse(String(row["record"])) as PayeeVersionRecord);
  }

  async payeeIds(): Promise<readonly string[]> {
    return this.#db.prepare("SELECT DISTINCT payee_id FROM payee_versions ORDER BY payee_id").all().map((row) => String(row["payee_id"]));
  }

  async verifiedAddresses(): Promise<readonly SuiAddress[]> {
    return this.#db.prepare("SELECT DISTINCT address FROM payee_versions WHERE status = 'VERIFIED'").all().map((row) => String(row["address"]) as SuiAddress);
  }

  async putReceipt(record: ReceiptRecord, blobId: string | null): Promise<void> {
    this.#db.prepare("INSERT OR REPLACE INTO receipts (receipt, verdict, attack_address, record, blob_id) VALUES (?,?,?,?,?)").run(record.receipt, record.verdict, remembersAttack(record) ? record.address : null, JSON.stringify(record), blobId);
  }

  async receiptBlobId(id: string): Promise<string | null> {
    const row = this.#db.prepare("SELECT blob_id FROM receipts WHERE receipt = ?").get(id);
    return row && row["blob_id"] !== null ? String(row["blob_id"]) : null;
  }

  async receipt(id: string): Promise<ReceiptRecord | null> {
    const row = this.#db.prepare("SELECT record FROM receipts WHERE receipt = ?").get(id);
    return row ? (JSON.parse(String(row["record"])) as ReceiptRecord) : null;
  }

  async earlierRefusalFor(address: SuiAddress): Promise<ReceiptRecord | null> {
    const row = this.#db.prepare("SELECT record FROM receipts WHERE attack_address = ? ORDER BY json_extract(record, '$.createdAt') LIMIT 1").get(address);
    return row ? (JSON.parse(String(row["record"])) as ReceiptRecord) : null;
  }

  async insertPendingChange(change: PendingChange): Promise<void> {
    this.#db.prepare("INSERT INTO pending_changes (nonce, payee_id, from_address, to_address, expires) VALUES (?,?,?,?,?)").run(change.nonce, change.payeeId, change.fromAddress, change.toAddress, change.expires);
  }

  async pendingChange(nonce: string): Promise<PendingChange | null> {
    const row = this.#db.prepare("SELECT * FROM pending_changes WHERE nonce = ? AND used = 0").get(nonce);
    if (!row) return null;
    return { nonce: String(row["nonce"]), payeeId: String(row["payee_id"]), fromAddress: String(row["from_address"]) as SuiAddress, toAddress: String(row["to_address"]) as SuiAddress, expires: String(row["expires"]) };
  }

  async insertPendingOnboarding(onboarding: PendingOnboarding): Promise<void> {
    this.#db.prepare("INSERT INTO pending_onboardings (nonce, payee_id, name, address, expires) VALUES (?,?,?,?,?)").run(onboarding.nonce, onboarding.payeeId, onboarding.name, onboarding.address, onboarding.expires);
  }

  async pendingOnboarding(nonce: string): Promise<PendingOnboarding | null> {
    const row = this.#db.prepare("SELECT * FROM pending_onboardings WHERE nonce = ? AND used = 0").get(nonce);
    if (!row) return null;
    return { nonce: String(row["nonce"]), payeeId: String(row["payee_id"]), name: String(row["name"]), address: String(row["address"]) as SuiAddress, expires: String(row["expires"]) };
  }

  async consumePendingOnboarding(nonce: string): Promise<boolean> {
    return Number(this.#db.prepare("UPDATE pending_onboardings SET used = 1 WHERE nonce = ? AND used = 0").run(nonce).changes) === 1;
  }

  async receiptsFor(payeeId: string | null, limit: number): Promise<readonly ReceiptRecord[]> {
    const rows = payeeId === null
      ? this.#db.prepare("SELECT record FROM receipts ORDER BY json_extract(record, '$.createdAt') DESC LIMIT ?").all(limit)
      : this.#db.prepare("SELECT record FROM receipts WHERE json_extract(record, '$.payeeId') = ? ORDER BY json_extract(record, '$.createdAt') DESC LIMIT ?").all(payeeId, limit);
    return rows.map((row) => JSON.parse(String(row["record"])) as ReceiptRecord);
  }

  async pendingChangesFor(payeeId: string): Promise<readonly PendingChange[]> {
    return this.#db.prepare("SELECT * FROM pending_changes WHERE payee_id = ? AND used = 0 ORDER BY expires DESC").all(payeeId)
      .map((row) => ({ nonce: String(row["nonce"]), payeeId: String(row["payee_id"]), fromAddress: String(row["from_address"]) as SuiAddress, toAddress: String(row["to_address"]) as SuiAddress, expires: String(row["expires"]) }));
  }

  async pendingOnboardingFor(payeeId: string): Promise<PendingOnboarding | null> {
    const row = this.#db.prepare("SELECT nonce FROM pending_onboardings WHERE payee_id = ? AND used = 0 ORDER BY expires DESC LIMIT 1").get(payeeId);
    return row ? await this.pendingOnboarding(String(row["nonce"])) : null;
  }

  async consumePendingChange(nonce: string): Promise<boolean> {
    return Number(this.#db.prepare("UPDATE pending_changes SET used = 1 WHERE nonce = ? AND used = 0").run(nonce).changes) === 1;
  }

  async clearIndex(): Promise<void> {
    this.#db.exec("DELETE FROM payee_versions; DELETE FROM receipts;");
  }
}
