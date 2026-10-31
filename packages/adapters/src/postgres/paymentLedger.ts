import type pg from "pg";
import { isPayeeHead, statesThatMayMoveTo, type NewPaymentIntent, type PayeeVersionRecord, type PaymentIntent, type PaymentLedger, type PaymentMove, type PaymentState, type ReasonCode, type Reservation, type SuiAddress } from "@countersign/core";
import { inTransaction, query } from "./pool.ts";
import { INDEX_SCHEMA, LEDGER_SCHEMA } from "./schema.ts";

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

async function lockBudget(client: pg.PoolClient, period: string): Promise<bigint> {
  await client.query("INSERT INTO payment_budget (period, reserved) VALUES ($1, 0) ON CONFLICT (period) DO NOTHING", [period]);
  const row = (await client.query<Row>("SELECT reserved FROM payment_budget WHERE period = $1 FOR UPDATE", [period])).rows[0];
  return BigInt(String(row?.["reserved"] ?? "0"));
}

export class PostgresPaymentLedger implements PaymentLedger {
  readonly #pool: pg.Pool;

  private constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  static async open(pool: pg.Pool): Promise<PostgresPaymentLedger> {
    await query(pool, INDEX_SCHEMA);
    await query(pool, LEDGER_SCHEMA);
    return new PostgresPaymentLedger(pool);
  }

  async reservePayment(intent: NewPaymentIntent, perDayCapBaseUnits: bigint): Promise<Reservation> {
    return inTransaction(this.#pool, async (client): Promise<Reservation> => {
      const reserved = await lockBudget(client, intent.period);
      const versions = (await client.query<Row>("SELECT record FROM payee_versions WHERE payee_id = $1 FOR SHARE", [intent.payeeId])).rows.map((row) => JSON.parse(String(row["record"])) as PayeeVersionRecord);
      if (!isPayeeHead(versions, intent)) return "PAYEE_CHANGED";
      if ((await client.query("SELECT 1 FROM payment_intents WHERE id = $1", [intent.id])).rowCount !== 0) return "DUPLICATE";
      if (reserved + intent.amountBaseUnits > perDayCapBaseUnits) return "CAP_EXCEEDED";
      await client.query("INSERT INTO payment_intents (id, payee_id, payee_version, payee_blob_id, address, amount, period, state, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'RESERVED',$8,$8)",
        [intent.id, intent.payeeId, intent.payeeVersion, intent.payeeBlobId, intent.address, intent.amountBaseUnits.toString(), intent.period, intent.createdAt]);
      await client.query("UPDATE payment_budget SET reserved = $2 WHERE period = $1", [intent.period, (reserved + intent.amountBaseUnits).toString()]);
      return "RESERVED";
    });
  }

  async movePayment(id: string, move: PaymentMove): Promise<boolean> {
    return inTransaction(this.#pool, async (client) => {
      const row = (await client.query<Row>("SELECT * FROM payment_intents WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!row) return false;
      const current = toIntent(row);
      if (!statesThatMayMoveTo(move.to).includes(current.state)) return false;
      const budget = move.to === "FAILED" ? await lockBudget(client, current.period) : null;
      const digest = move.digest ?? current.digest;
      const validUntilEpoch = move.validUntilEpoch === undefined ? current.validUntilEpoch : move.validUntilEpoch;
      const changed = await client.query("UPDATE payment_intents SET state = $1, digest = $2, valid_until_epoch = $3, detail = $4, reason = $5, updated_at = $6 WHERE id = $7 AND state = $8",
        [move.to, digest, validUntilEpoch, move.detail, move.reason ?? current.reason, move.at, id, current.state]);
      if (changed.rowCount !== 1) return false;
      if (budget !== null) await client.query("UPDATE payment_budget SET reserved = $2 WHERE period = $1", [current.period, (budget - current.amountBaseUnits).toString()]);
      return true;
    });
  }

  async payment(id: string): Promise<PaymentIntent | null> {
    const row = (await query<Row>(this.#pool, "SELECT * FROM payment_intents WHERE id = $1", [id])).rows[0];
    return row ? toIntent(row) : null;
  }

  async unresolvedPayments(): Promise<readonly PaymentIntent[]> {
    return (await query<Row>(this.#pool, "SELECT * FROM payment_intents WHERE state IN ('SENDING','SENT','UNKNOWN') ORDER BY created_at")).rows.map(toIntent);
  }

  async recentPayments(limit: number, payeeId: string | null): Promise<readonly PaymentIntent[]> {
    const result = payeeId === null
      ? await query<Row>(this.#pool, "SELECT * FROM payment_intents ORDER BY created_at DESC LIMIT $1", [limit])
      : await query<Row>(this.#pool, "SELECT * FROM payment_intents WHERE payee_id = $1 ORDER BY created_at DESC LIMIT $2", [payeeId, limit]);
    return result.rows.map(toIntent);
  }

  async reservedFor(period: string): Promise<bigint> {
    const row = (await query<Row>(this.#pool, "SELECT reserved FROM payment_budget WHERE period = $1", [period])).rows[0];
    return row ? BigInt(String(row["reserved"])) : 0n;
  }
}
