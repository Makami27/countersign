import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { inTransaction, query, type Connectable } from "../src/postgres/pool.ts";

type Script = readonly ("timeout" | "refused" | "ok" | "denied")[];

function fakePool(script: Script): Connectable & { attempts: number; released: unknown[]; queries: string[] } {
  const steps = [...script];
  const state = { attempts: 0, released: [] as unknown[], queries: [] as string[] };
  const client = {
    query: async (sql: string) => {
      state.queries.push(sql);
      return { rows: [{ ok: 1 }], rowCount: 1 };
    },
    release: (error?: unknown) => void state.released.push(error),
  } as unknown as pg.PoolClient;
  return Object.assign(state, {
    connect: async () => {
      state.attempts += 1;
      const step = steps.shift() ?? "ok";
      if (step === "timeout") throw new Error("timeout exceeded when trying to connect");
      if (step === "refused") throw Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });
      if (step === "denied") throw new Error("password authentication failed for user");
      return client;
    },
  });
}

test("V07 a Neon compute that is waking up gets one more connect attempt, and the query then succeeds", async () => {
  const pool = fakePool(["timeout", "ok"]);
  const result = await query(pool, "SELECT 1 AS ok");
  assert.equal(result.rowCount, 1);
  assert.equal(pool.attempts, 2);
});

test("V07 two connect failures in a row are an error, never a result, and nothing is sent", async () => {
  const pool = fakePool(["timeout", "refused", "ok"]);
  await assert.rejects(query(pool, "SELECT 1 AS ok"), /connect failed/);
  assert.equal(pool.attempts, 2);
  assert.deepEqual(pool.queries, []);
});

test("V07 a failure that is not a connect failure is not retried", async () => {
  const pool = fakePool(["denied", "ok"]);
  await assert.rejects(query(pool, "SELECT 1 AS ok"), /password authentication failed/);
  assert.equal(pool.attempts, 1);
});

test("V07 a reservation transaction also gets one more connect attempt before it begins", async () => {
  const pool = fakePool(["timeout", "ok"]);
  const result = await inTransaction(pool, async (client) => (await client.query("SELECT 1")).rowCount);
  assert.equal(result, 1);
  assert.deepEqual(pool.queries, ["BEGIN", "SELECT 1", "COMMIT"]);
  assert.deepEqual(pool.released, [undefined]);
});
