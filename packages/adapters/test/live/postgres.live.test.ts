import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { directNeonUrl, openPostgres } from "../../src/postgres/pool.ts";
import { PostgresIndex } from "../../src/postgres/indexStore.ts";
import { PostgresPaymentLedger } from "../../src/postgres/paymentLedger.ts";
import { ledgerContract } from "../support/ledgerContract.ts";
import { PAYEE_A, verifiedVersion } from "../support/payees.ts";

const url = process.env["DATABASE_URL"] ?? "";
if (!url) throw new Error("DATABASE_URL is not set. The Postgres live tests need a Neon database.");

async function adminQuery(sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: directNeonUrl(url), connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function testSchema(): Promise<{ pool: pg.Pool; drop: () => Promise<void> }> {
  const schema = `countersign_test_${randomBytes(5).toString("hex")}`;
  await adminQuery(`CREATE SCHEMA ${schema}`);
  const pool = openPostgres({ url, schema });
  return {
    pool,
    drop: async () => {
      await pool.end().catch(() => undefined);
      await adminQuery(`DROP SCHEMA ${schema} CASCADE`);
    },
  };
}

ledgerContract("Postgres (Neon, test schema)", async () => {
  const { pool, drop } = await testSchema();
  const index = await PostgresIndex.open(pool);
  const ledger = await PostgresPaymentLedger.open(pool);
  return { ledger, index, raw: async (sql) => void (await pool.query(sql)), close: drop };
});

test("V18 Postgres (Neon, test schema): the index keeps payee versions, receipts and one-time nonces like the SQLite index", async (t) => {
  const { pool, drop } = await testSchema();
  t.after(drop);
  const index = await PostgresIndex.open(pool);
  await index.putPayeeVersion(verifiedVersion("rent", 1, PAYEE_A, null));
  assert.deepEqual((await index.payeeVersions("rent")).map((v) => v.version), [1]);
  assert.deepEqual(await index.verifiedAddresses(), [PAYEE_A]);
  await index.insertPendingChange({ nonce: "nonce-1", payeeId: "rent", fromAddress: PAYEE_A, toAddress: PAYEE_A, expires: "2026-11-01T00:00:00Z" });
  assert.equal(await index.consumePendingChange("nonce-1"), true);
  assert.equal(await index.consumePendingChange("nonce-1"), false);
  assert.equal(await index.pendingChange("nonce-1"), null);
  await index.clearIndex();
  assert.deepEqual(await index.payeeIds(), []);
});

test("V07 Postgres (Neon, test schema): once the database can't be reached, reserving and moving payments fail loudly instead of succeeding", async (t) => {
  const { pool, drop } = await testSchema();
  t.after(drop);
  const index = await PostgresIndex.open(pool);
  const ledger = await PostgresPaymentLedger.open(pool);
  await index.putPayeeVersion(verifiedVersion("rent", 1, PAYEE_A, null));
  const intent = { id: "pay_gone", payeeId: "rent", payeeVersion: 1, payeeBlobId: null, address: PAYEE_A, amountBaseUnits: 5n, period: "2026-10-30", createdAt: "2026-10-30T10:00:00Z" };
  assert.equal(await ledger.reservePayment(intent, 100n), "RESERVED");
  await pool.end();
  await assert.rejects(ledger.reservePayment({ ...intent, id: "pay_gone_2" }, 100n));
  await assert.rejects(ledger.movePayment(intent.id, { to: "SENDING", at: "2026-10-30T10:00:01Z", detail: null, digest: "D-gone", validUntilEpoch: "1" }));
});
