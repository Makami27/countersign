import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schedulesNamespace } from "@countersign/core";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { wallet } from "../../../packages/core/test/fixtures.ts";
import { Schedules } from "../src/schedules.ts";
import { ownerServer, type Challenge } from "./support/ownerServer.ts";

const rent = { payeeId: "landlord", amount: "2.50", every: "month", day: 5 };

test("V21 creating, changing and deleting a scheduled payment each need a fresh owner-wallet signature over the exact terms, and each sends a Telegram notice", async (t) => {
  const s = await ownerServer(t);
  const me = s.me;
  const asked = await s.call("POST", "/api/app/schedules", rent);
  assert.equal(asked.status, 428);
  assert.match((asked.body["approvals"] as Challenge[])[0]?.message ?? "", /action:create_schedule\nmeaning:create a scheduled payment\namount:2500000\nday:5\nevery:month\nmonth:\npayee:landlord/);
  const stranger = await s.signedBy("POST", "/api/app/schedules", rent, [wallet()]);
  assert.equal(stranger.status, 403);
  assert.equal(s.owner.schedules.active().length, 0);
  const challenge = (await s.call("POST", "/api/app/schedules", rent)).body["approvals"] as Challenge[];
  const swapped = await s.call("POST", "/api/app/schedules", { ...rent, amount: "40", approvals: { owner: { nonce: challenge[0]?.nonce ?? "", signature: me.sign(challenge[0]?.message ?? "") } } });
  assert.equal((swapped.body["approval"] as { problem: string }).problem, "APPROVAL_MISMATCH");
  const created = await s.signedBy("POST", "/api/app/schedules", rent, [me]);
  assert.equal(created.status, 200);
  const id = (created.body["schedule"] as { scheduleId: string }).scheduleId;
  assert.match(String(created.body["nextDue"]), /-05T00:00:00.000Z$/);
  assert.ok(s.extras.notices.some((n) => n.startsWith("Scheduled payment created with your wallet's signature: 2.50 USDC to landlord on day 5 of every month (UTC)")));

  assert.equal((await s.call("PUT", `/api/app/schedules/${id}`, { ...rent, amount: "3" })).status, 428);
  assert.equal(s.owner.schedules.get(id)?.amountBaseUnits, "2500000");
  assert.equal((await s.signedBy("PUT", `/api/app/schedules/${id}`, { ...rent, amount: "3" }, [me])).status, 200);
  assert.equal(s.owner.schedules.get(id)?.amountBaseUnits, "3000000");
  assert.equal((await s.call("DELETE", `/api/app/schedules/${id}`, {})).status, 428);
  assert.equal(s.owner.schedules.active().length, 1);
  assert.equal((await s.signedBy("DELETE", `/api/app/schedules/${id}`, {}, [me])).status, 200);
  assert.equal(s.owner.schedules.active().length, 0);
  assert.deepEqual(s.extras.notices.filter((n) => n.startsWith("Scheduled payment")).map((n) => n.split(" with")[0]), ["Scheduled payment created", "Scheduled payment changed", "Scheduled payment deleted"]);
  assert.equal((await s.signedBy("POST", "/api/app/schedules", { ...rent, amount: "60" }, [me])).status, 422);
  assert.equal((await s.signedBy("POST", "/api/app/schedules", { ...rent, every: "year" }, [me])).status, 400);
  assert.equal((await s.call("POST", "/api/app/schedules", { ...rent, payee: "extra" })).status, 400);
});

test("V21 schedules are signed Walrus Memory records: an empty database restores them, a Postgres row edited without the agent key is ignored, and an unconfirmed write changes nothing", async (t) => {
  const s = await ownerServer(t);
  const me = s.me;
  const created = await s.signedBy("POST", "/api/app/schedules", rent, [me]);
  const id = (created.body["schedule"] as { scheduleId: string }).scheduleId;
  const fresh = new SqliteRows(join(mkdtempSync(join(tmpdir(), "countersign-restore-")), "web.sqlite"));
  const restored = await Schedules.open({ rows: fresh, memory: s.memory, signer: s.signer, ownerId: "owner1", now: Date.now });
  assert.equal(restored.get(id)?.amountBaseUnits, "2500000");
  await fresh.run("UPDATE schedule_records SET sealed = replace(sealed, '2500000', '9900000')");
  s.memory.dropOnRead = schedulesNamespace("owner1");
  const fromCache = await Schedules.open({ rows: fresh, memory: s.memory, signer: s.signer, ownerId: "owner1", now: Date.now });
  assert.equal(fromCache.get(id), null);
  s.memory.dropOnRead = null;
  s.memory.failNextWrite = true;
  const unconfirmed = await s.signedBy("POST", "/api/app/schedules", { ...rent, day: 9 }, [me]);
  assert.equal(unconfirmed.status, 503);
  assert.equal(s.owner.schedules.active().length, 1);
});

test("V21 weekly and two-week schedules take a weekday from 1 to 7 and no month, and their notice names the weekday", async (t) => {
  const s = await ownerServer(t);
  const me = s.me;
  assert.equal((await s.signedBy("POST", "/api/app/schedules", { ...rent, every: "week", day: 8 }, [me])).status, 400);
  assert.equal((await s.signedBy("POST", "/api/app/schedules", { ...rent, every: "two_weeks", day: 3, month: 4 }, [me])).status, 400);
  assert.equal((await s.signedBy("POST", "/api/app/schedules", { ...rent, every: "two_weeks", day: 3 }, [me])).status, 200);
  assert.ok(s.extras.notices.some((n) => n.includes("2.50 USDC to landlord on every other Wednesday (UTC)")));
});
