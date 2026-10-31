import type pg from "pg";
import { remembersAttack, type IndexStore, type PayeeVersionRecord, type PendingChange, type PendingOnboarding, type ReceiptRecord, type SuiAddress } from "@countersign/core";
import { query } from "./pool.ts";
import { INDEX_SCHEMA } from "./schema.ts";

type Row = Record<string, unknown>;

const versionOf = (row: Row): PayeeVersionRecord => JSON.parse(String(row["record"])) as PayeeVersionRecord;
const receiptOf = (row: Row): ReceiptRecord => JSON.parse(String(row["record"])) as ReceiptRecord;
const changeOf = (row: Row): PendingChange => ({ nonce: String(row["nonce"]), payeeId: String(row["payee_id"]), fromAddress: String(row["from_address"]) as SuiAddress, toAddress: String(row["to_address"]) as SuiAddress, expires: String(row["expires"]) });
const onboardingOf = (row: Row): PendingOnboarding => ({ nonce: String(row["nonce"]), payeeId: String(row["payee_id"]), name: String(row["name"]), address: String(row["address"]) as SuiAddress, expires: String(row["expires"]) });

export class PostgresIndex implements IndexStore {
  readonly #pool: pg.Pool;

  private constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  static async open(pool: pg.Pool): Promise<PostgresIndex> {
    await query(pool, INDEX_SCHEMA);
    return new PostgresIndex(pool);
  }

  async #rows(sql: string, params: readonly unknown[] = []): Promise<readonly Row[]> {
    return (await query<Row>(this.#pool, sql, [...params])).rows;
  }

  async putPayeeVersion(record: PayeeVersionRecord): Promise<void> {
    await query(this.#pool, "INSERT INTO payee_versions VALUES ($1,$2,$3,$4,$5) ON CONFLICT (payee_id, version) DO UPDATE SET address = excluded.address, status = excluded.status, record = excluded.record", [record.payeeId, record.version, record.address, record.status, JSON.stringify(record)]);
  }

  async payeeVersions(payeeId: string): Promise<readonly PayeeVersionRecord[]> {
    return (await this.#rows("SELECT record FROM payee_versions WHERE payee_id = $1 ORDER BY version", [payeeId])).map(versionOf);
  }

  async payeeIds(): Promise<readonly string[]> {
    return (await this.#rows("SELECT DISTINCT payee_id FROM payee_versions ORDER BY payee_id")).map((row) => String(row["payee_id"]));
  }

  async verifiedAddresses(): Promise<readonly SuiAddress[]> {
    return (await this.#rows("SELECT DISTINCT address FROM payee_versions WHERE status = 'VERIFIED'")).map((row) => String(row["address"]) as SuiAddress);
  }

  async putReceipt(record: ReceiptRecord, blobId: string | null): Promise<void> {
    await query(this.#pool, "INSERT INTO receipts (receipt, verdict, attack_address, payee_id, created_at, record, blob_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (receipt) DO UPDATE SET verdict = excluded.verdict, attack_address = excluded.attack_address, payee_id = excluded.payee_id, created_at = excluded.created_at, record = excluded.record, blob_id = COALESCE(excluded.blob_id, receipts.blob_id)", [record.receipt, record.verdict, remembersAttack(record) ? record.address : null, record.payeeId, record.createdAt, JSON.stringify(record), blobId]);
  }

  async receiptBlobId(id: string): Promise<string | null> {
    const row = (await this.#rows("SELECT blob_id FROM receipts WHERE receipt = $1", [id]))[0];
    return row && row["blob_id"] !== null ? String(row["blob_id"]) : null;
  }

  async receipt(id: string): Promise<ReceiptRecord | null> {
    const row = (await this.#rows("SELECT record FROM receipts WHERE receipt = $1", [id]))[0];
    return row ? receiptOf(row) : null;
  }

  async earlierRefusalFor(address: SuiAddress): Promise<ReceiptRecord | null> {
    const row = (await this.#rows("SELECT record FROM receipts WHERE attack_address = $1 ORDER BY created_at LIMIT 1", [address]))[0];
    return row ? receiptOf(row) : null;
  }

  async insertPendingChange(change: PendingChange): Promise<void> {
    await query(this.#pool, "INSERT INTO pending_changes (nonce, payee_id, from_address, to_address, expires) VALUES ($1,$2,$3,$4,$5)", [change.nonce, change.payeeId, change.fromAddress, change.toAddress, change.expires]);
  }

  async pendingChange(nonce: string): Promise<PendingChange | null> {
    const row = (await this.#rows("SELECT * FROM pending_changes WHERE nonce = $1 AND NOT used", [nonce]))[0];
    return row ? changeOf(row) : null;
  }

  async consumePendingChange(nonce: string): Promise<boolean> {
    return (await query(this.#pool, "UPDATE pending_changes SET used = TRUE WHERE nonce = $1 AND NOT used", [nonce])).rowCount === 1;
  }

  async insertPendingOnboarding(onboarding: PendingOnboarding): Promise<void> {
    await query(this.#pool, "INSERT INTO pending_onboardings (nonce, payee_id, name, address, expires) VALUES ($1,$2,$3,$4,$5)", [onboarding.nonce, onboarding.payeeId, onboarding.name, onboarding.address, onboarding.expires]);
  }

  async pendingOnboarding(nonce: string): Promise<PendingOnboarding | null> {
    const row = (await this.#rows("SELECT * FROM pending_onboardings WHERE nonce = $1 AND NOT used", [nonce]))[0];
    return row ? onboardingOf(row) : null;
  }

  async consumePendingOnboarding(nonce: string): Promise<boolean> {
    return (await query(this.#pool, "UPDATE pending_onboardings SET used = TRUE WHERE nonce = $1 AND NOT used", [nonce])).rowCount === 1;
  }

  async receiptsFor(payeeId: string | null, limit: number): Promise<readonly ReceiptRecord[]> {
    const rows = payeeId === null
      ? await this.#rows("SELECT record FROM receipts ORDER BY created_at DESC LIMIT $1", [limit])
      : await this.#rows("SELECT record FROM receipts WHERE payee_id = $1 ORDER BY created_at DESC LIMIT $2", [payeeId, limit]);
    return rows.map(receiptOf);
  }

  async pendingChangesFor(payeeId: string): Promise<readonly PendingChange[]> {
    return (await this.#rows("SELECT * FROM pending_changes WHERE payee_id = $1 AND NOT used ORDER BY expires DESC", [payeeId])).map(changeOf);
  }

  async pendingOnboardingFor(payeeId: string): Promise<PendingOnboarding | null> {
    const row = (await this.#rows("SELECT * FROM pending_onboardings WHERE payee_id = $1 AND NOT used ORDER BY expires DESC LIMIT 1", [payeeId]))[0];
    return row ? onboardingOf(row) : null;
  }

  async clearIndex(): Promise<void> {
    await query(this.#pool, "DELETE FROM payee_versions; DELETE FROM receipts;");
  }
}
