import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteIndex } from "../src/sqlite/indexStore.ts";
import { SqlitePaymentLedger } from "../src/sqlite/paymentLedger.ts";
import { ledgerContract } from "./support/ledgerContract.ts";

ledgerContract("SQLite", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "countersign-ledger-")), "ledger.sqlite");
  return {
    ledger: new SqlitePaymentLedger(path),
    index: new SqliteIndex(path),
    raw: async (sql) => {
      const db = new DatabaseSync(path);
      try {
        db.exec(sql);
      } finally {
        db.close();
      }
    },
    close: async () => undefined,
  };
});
