import type { IndexStore, PaymentLedger } from "@countersign/core";
import type { SqlRows } from "@countersign/adapters/sql";
import { SqliteIndex, SqlitePaymentLedger, SqliteRows } from "@countersign/adapters/sqlite";
import { PostgresIndex, PostgresPaymentLedger, PostgresRows, openPostgres } from "@countersign/adapters/postgres";
import { dirname, join } from "node:path";
import { query } from "@countersign/adapters/postgres";
import type { Config } from "./config.ts";

export type Storage = {
  readonly label: string;
  readonly index: IndexStore;
  readonly ledger: PaymentLedger & { reservedFor(period: string): Promise<bigint> };
  readonly rows: SqlRows;
  readonly close: () => Promise<void>;
};

export async function openStorage(database: Config["database"]): Promise<Storage> {
  if (database.kind === "sqlite") {
    return { label: "SQLite", index: new SqliteIndex(database.path), ledger: new SqlitePaymentLedger(database.path), rows: new SqliteRows(database.path), close: async () => undefined };
  }
  const pool = openPostgres({ url: database.url });
  return { label: "Postgres", index: await PostgresIndex.open(pool), ledger: await PostgresPaymentLedger.open(pool), rows: new PostgresRows(pool), close: () => pool.end() };
}

export async function openOwnerStorage(database: Config["database"], ownerId: string): Promise<Storage> {
  if (!/^o[0-9a-f]{10}$/.test(ownerId)) throw new Error("Unexpected owner id. Nothing was opened.");
  if (database.kind === "sqlite") {
    const path = join(dirname(database.path), `${ownerId}.sqlite`);
    return { label: "SQLite", index: new SqliteIndex(path), ledger: new SqlitePaymentLedger(path), rows: new SqliteRows(path), close: async () => undefined };
  }
  const schema = `owner_${ownerId}`;
  const admin = openPostgres({ url: database.url });
  await query(admin, `CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await admin.end();
  const pool = openPostgres({ url: database.url, schema });
  return { label: `Postgres schema ${schema}`, index: await PostgresIndex.open(pool), ledger: await PostgresPaymentLedger.open(pool), rows: new PostgresRows(pool), close: () => pool.end() };
}
