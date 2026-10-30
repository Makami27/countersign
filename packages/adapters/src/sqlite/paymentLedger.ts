import { DatabaseSync } from "node:sqlite";
import { PAYMENT_STATES, PAYMENT_TRANSITIONS, statesThatMayMoveTo, type ReasonCode, type NewPaymentIntent, type PaymentIntent, type PaymentLedger, type PaymentMove, type PaymentState, type SuiAddress } from "@countersign/core";

const BUSY_TIMEOUT_MS = 5_000;
const stateList = PAYMENT_STATES.map((s) => `'${s}'`).join(",");
const allowedMoves = Object.entries(PAYMENT_TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => `('${from}','${to}')`)).join(",");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payment_budget (
  period TEXT PRIMARY KEY,
  reserved TEXT NOT NULL CHECK (reserved NOT GLOB '*[^0-9]*' AND length(reserved) > 0));
CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  payee_id TEXT NOT NULL,
  payee_version INTEGER NOT NULL CHECK (payee_version >= 1),
  payee_blob_id TEXT,
  address TEXT NOT NULL CHECK (length(address) = 66 AND address GLOB '0x*' AND substr(address, 3) NOT GLOB '*[^0-9a-f]*'),
  amount TEXT NOT NULL CHECK (amount GLOB '[1-9]*' AND amount NOT GLOB '*[^0-9]*'),
  period TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (${stateList})),
  digest TEXT UNIQUE,
  valid_until_epoch TEXT CHECK (valid_until_epoch IS NULL OR (valid_until_epoch NOT GLOB '*[^0-9]*' AND length(valid_until_epoch) > 0)),
  detail TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (state IN ('RESERVED','FAILED') OR digest IS NOT NULL));
CREATE TRIGGER IF NOT EXISTS payment_state_moves BEFORE UPDATE OF state ON payment_intents
WHEN (OLD.state, NEW.state) NOT IN (VALUES ${allowedMoves})
BEGIN SELECT RAISE(ABORT, 'payment state move not allowed'); END;
`;

type Row = Record<string, unknown>;

function toIntent(row: Row): PaymentIntent {
  return {
    id: String(row["id"]),
    payeeId: String(row["payee_id"]),
    payeeVersion: Number(row["payee_version"]),
    payeeBlobId: row["payee_blob_id"] === null ? null : String(row["payee_blob_id"]),
    address: String(row["address"]) as SuiAddress,
    amountBaseUnits: BigInt(String(row["amount"])),
    period: String(row["period"]),
    createdAt: String(row["created_at"]),
    state: String(row["state"]) as PaymentState,
    digest: row["digest"] === null ? null : String(row["digest"]),
    validUntilEpoch: row["valid_until_epoch"] === null ? null : String(row["valid_until_epoch"]),
    detail: row["detail"] === null ? null : String(row["detail"]),
    reason: row["reason"] === null ? null : (String(row["reason"]) as ReasonCode),
    updatedAt: String(row["updated_at"]),
  };
}

export class SqlitePaymentLedger implements PaymentLedger {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    this.#db.exec(SCHEMA);
  }

  reservePayment(intent: NewPaymentIntent, perDayCapBaseUnits: bigint): boolean {
    return this.#transaction(() => {
      const reserved = this.#reserved(intent.period);
      if (reserved + intent.amountBaseUnits > perDayCapBaseUnits) return false;
      if (this.#db.prepare("SELECT 1 FROM payment_intents WHERE id = ?").get(intent.id)) return false;
      this.#db.prepare("INSERT INTO payment_intents (id, payee_id, payee_version, payee_blob_id, address, amount, period, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'RESERVED',?,?)")
        .run(intent.id, intent.payeeId, intent.payeeVersion, intent.payeeBlobId, intent.address, intent.amountBaseUnits.toString(), intent.period, intent.createdAt, intent.createdAt);
      this.#setReserved(intent.period, reserved + intent.amountBaseUnits);
      return true;
    });
  }

  movePayment(id: string, move: PaymentMove): boolean {
    return this.#transaction(() => {
      const row = this.#db.prepare("SELECT * FROM payment_intents WHERE id = ?").get(id);
      if (!row) return false;
      const current = toIntent(row);
      if (!statesThatMayMoveTo(move.to).includes(current.state)) return false;
      const digest = move.digest ?? current.digest;
      const validUntilEpoch = move.validUntilEpoch === undefined ? current.validUntilEpoch : move.validUntilEpoch;
      const changed = this.#db.prepare("UPDATE payment_intents SET state = ?, digest = ?, valid_until_epoch = ?, detail = ?, reason = ?, updated_at = ? WHERE id = ? AND state = ?")
        .run(move.to, digest, validUntilEpoch, move.detail, move.reason ?? current.reason, move.at, id, current.state).changes;
      if (Number(changed) !== 1) return false;
      if (move.to === "FAILED") this.#setReserved(current.period, this.#reserved(current.period) - current.amountBaseUnits);
      return true;
    });
  }

  payment(id: string): PaymentIntent | null {
    const row = this.#db.prepare("SELECT * FROM payment_intents WHERE id = ?").get(id);
    return row ? toIntent(row) : null;
  }

  unresolvedPayments(): readonly PaymentIntent[] {
    return this.#db.prepare("SELECT * FROM payment_intents WHERE state IN ('SENDING','SENT','UNKNOWN') ORDER BY created_at").all().map(toIntent);
  }

  reservedFor(period: string): bigint {
    return this.#reserved(period);
  }

  #reserved(period: string): bigint {
    const row = this.#db.prepare("SELECT reserved FROM payment_budget WHERE period = ?").get(period);
    return row ? BigInt(String(row["reserved"])) : 0n;
  }

  #setReserved(period: string, amount: bigint): void {
    this.#db.prepare("INSERT INTO payment_budget (period, reserved) VALUES (?, ?) ON CONFLICT(period) DO UPDATE SET reserved = excluded.reserved").run(period, amount.toString());
  }

  #transaction<T>(work: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
}
