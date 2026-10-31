import type { IndexStore, PaymentLedger } from "@countersign/core";
import type { SqlRows } from "@countersign/adapters/sql";
import { SqliteIndex, SqlitePaymentLedger, SqliteRows } from "@countersign/adapters/sqlite";
import { PostgresIndex, PostgresPaymentLedger, PostgresRows, openPostgres } from "@countersign/adapters/postgres";
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
