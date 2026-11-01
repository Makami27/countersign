import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { ChangeSteps } from "../src/changeSteps.ts";
import { startWebServer } from "../src/server.ts";
import { CountingRows } from "./support/countingRows.ts";
import { scheduleWorld } from "./support/scheduleWorld.ts";

function rows(): CountingRows {
  return new CountingRows(new SqliteRows(join(mkdtempSync(join(tmpdir(), "countersign-idle-")), "web.sqlite")));
}

test("D19 the 5-minute ping to /api/health never touches the database", async (t) => {
  const db = rows();
  const server = startWebServer({ port: 0, network: "testnet", proof: db, version: null, owners: null });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => server.close());
  const before = db.queries;
  for (let i = 0; i < 3; i += 1) assert.equal((await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`)).status, 200);
  assert.equal(db.queries, before);
});

test("D19 a scheduled run waiting for its hourly retry, or already done this period, doesn't query the database every minute", async () => {
  const s = await scheduleWorld();
  const rent = await s.schedule();
  s.at("2026-11-05T00:01:00Z");
  s.memory.dropOnRead = s.landlordSpace;
  const runner = await s.runner();
  await runner.tick();
  const afterRefusal = s.rows.queries;
  for (let minute = 1; minute < 60; minute += 1) {
    s.clock.advance(60_000);
    await runner.tick();
  }
  assert.equal(s.rows.queries, afterRefusal);
  s.memory.dropOnRead = null;
  s.clock.advance(2 * 60_000);
  await runner.tick();
  assert.ok(s.rows.queries > afterRefusal);
  assert.equal((await s.payments.payment(`pay_schedule_${rent.scheduleId}_2026-11`))?.state, "SETTLED");
  const done = s.rows.queries;
  for (let minute = 0; minute < 30; minute += 1) {
    s.clock.advance(60_000);
    await runner.tick();
  }
  assert.equal(s.rows.queries, done);
});

test("D19 an owner-confirmed change waiting for its cooldown or a wallet isn't re-read every minute; a new signature wakes it", async () => {
  const db = rows();
  const steps = await ChangeSteps.open(db);
  await steps.confirmByOwner("n1", "c1", "2026-11-01T00:00:00Z");
  const now = Date.parse("2026-11-01T00:00:00Z");
  assert.deepEqual(await steps.ownerConfirmedNonces(now), ["n1"]);
  steps.waitUntil("n1", now + 3600_000);
  const before = db.queries;
  assert.deepEqual(await steps.ownerConfirmedNonces(now + 60_000), []);
  assert.equal(db.queries, before);
  assert.deepEqual(await steps.ownerConfirmedNonces(now + 3600_000), ["n1"]);
  steps.waitUntil("n1", Number.POSITIVE_INFINITY);
  assert.deepEqual(await steps.ownerConfirmedNonces(now + 7200_000), []);
  await steps.record("n1", "new", "sig", "2026-11-01T02:00:00Z");
  assert.deepEqual(await steps.ownerConfirmedNonces(now + 7200_000), ["n1"]);
});
