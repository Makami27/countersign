import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduledPaymentId } from "@countersign/core";
import { message, wallet } from "../../../packages/core/test/fixtures.ts";
import { scheduleWorld } from "./support/scheduleWorld.ts";

test("V21 a run due while the agent was down runs once on boot, says it ran late, and names the earlier missed periods as not paid", async () => {
  const s = await scheduleWorld();
  const rent = await s.schedule();
  s.at("2027-01-10T08:00:00Z");
  await (await s.runner()).tick();
  const paid = await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2027-01"));
  assert.equal(paid?.state, "SETTLED");
  assert.equal(await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2026-11")), null);
  assert.equal(await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2026-12")), null);
  assert.equal(s.notices.length, 1);
  assert.match(s.notices[0] ?? "", /for 2027-01: 2\.00 USDC sent .* It ran late: it was due 2027-01-05 00:00 UTC .* Missed while the agent was down and not paid: 2026-11, 2026-12\. Receipt: https:\/\/example\.test\/r\/rcpt_schedule_/);
  assert.equal((await s.agent.receiptRecord(`rcpt_schedule_${rent.scheduleId}_2027-01`))?.verdict, "PAID");
  await (await s.runner()).tick();
  assert.equal(s.chain.submits, 1);
  assert.equal(s.notices.length, 1);
});

test("V21 two ticks at once, and two agents ticking on one ledger, pay a period exactly once (unique key schedule:<id>:<period>)", async () => {
  const s = await scheduleWorld();
  await s.schedule();
  s.at("2026-11-05T00:01:00Z");
  const [a, b] = [await s.runner(), await s.runner()];
  await Promise.all([a.tick(), a.tick(), b.tick(), b.tick()]);
  assert.equal(s.chain.submits, 1);
  assert.equal(s.notices.length, 1);
  assert.doesNotMatch(s.notices[0] ?? "", /late/);
});

test("V21 a restart between reserving and sending sends the reserved run once after re-checking the payee; if the address changed meanwhile nothing is sent", async () => {
  const s = await scheduleWorld();
  const rent = await s.schedule();
  s.at("2026-11-05T00:01:00Z");
  assert.equal((await s.agent.reserveScheduled(rent.scheduleId, "2026-11", "landlord")).verdict, "PAY_RESERVED");
  await (await s.runner()).tick();
  assert.equal(s.chain.submits, 1);
  assert.equal((await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2026-11")))?.state, "SETTLED");

  s.at("2026-12-05T00:01:00Z");
  assert.equal((await s.agent.reserveScheduled(rent.scheduleId, "2026-12", "landlord")).verdict, "PAY_RESERVED");
  await s.moveLandlord();
  await (await s.runner()).tick();
  const december = await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2026-12"));
  assert.equal(december?.state, "FAILED");
  assert.equal(december?.reason, "PAYEE_CHANGED");
  assert.equal(s.chain.submits, 1);
  assert.match(s.notices.at(-1) ?? "", /failed: Nothing was sent: the payee's verified address changed/);
});

test("V21 UNKNOWN never pays: unreadable Walrus Memory refuses MEMORY_INCOMPLETE and retries hourly with one notice; a Tatum UNKNOWN submission is never resent", async () => {
  const s = await scheduleWorld();
  const rent = await s.schedule();
  s.at("2026-11-05T00:01:00Z");
  s.memory.dropOnRead = s.landlordSpace;
  const runner = await s.runner();
  await runner.tick();
  await runner.tick();
  assert.equal(await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2026-11")), null);
  assert.equal(s.notices.length, 1);
  assert.match(s.notices[0] ?? "", /was not paid: Memory could not be read completely\. It will be tried again every hour/);
  s.memory.dropOnRead = "countersign:owner1:schedules";
  s.clock.advance(61 * 60 * 1000);
  await runner.tick();
  assert.equal(await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2026-11")), null);
  s.memory.dropOnRead = null;
  s.clock.advance(61 * 60 * 1000);
  await runner.tick();
  assert.equal((await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2026-11")))?.state, "SETTLED");

  s.at("2026-12-05T00:01:00Z");
  s.chain.submitted = { state: "UNKNOWN", detail: "deadline exceeded" };
  await runner.tick();
  s.clock.advance(2 * 3600 * 1000);
  await runner.tick();
  await (await s.runner()).tick();
  assert.equal((await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2026-12")))?.state, "UNKNOWN");
  assert.equal(s.chain.submits, 2);
  assert.match(s.notices.at(-1) ?? "", /hasn't confirmed it yet\. It will never be resent/);
});

test("V21 an address change between runs: the next run pays the new verified head, and a merely stated address is never paid", async () => {
  const s = await scheduleWorld();
  const rent = await s.schedule();
  const runner = await s.runner();
  s.at("2026-11-05T00:01:00Z");
  await runner.tick();
  const moved = await s.moveLandlord();
  const stated = wallet();
  await s.agent.handle(message(`pay here now ${stated.address}`), { kind: "change_address", payeeId: "landlord", newAddress: stated.address, reasonQuote: "x" });
  s.at("2026-12-05T00:01:00Z");
  await runner.tick();
  assert.equal((await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2026-11")))?.address, s.landlord.address);
  assert.equal((await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2026-12")))?.address, moved);
});

test("V21 a run above a cap is refused, the owner is told once, and it isn't tried again that period", async () => {
  const s = await scheduleWorld({ perPaymentBaseUnits: 50_000_000n, perDayBaseUnits: 3_000_000n });
  const rent = await s.schedule();
  s.at("2026-11-05T00:01:00Z");
  const early = await s.agent.handle(message("pay landlord 2"), { kind: "pay", payeeId: "landlord", amountBaseUnits: "2000000", reasonQuote: "x" });
  assert.equal(early.verdict, "PAY_RESERVED");
  const runner = await s.runner();
  await runner.tick();
  s.clock.advance(3 * 3600 * 1000);
  await runner.tick();
  await (await s.runner()).tick();
  assert.equal(await s.payments.payment(scheduledPaymentId(rent.scheduleId, "2026-11")), null);
  assert.equal(s.notices.length, 1);
  assert.match(s.notices[0] ?? "", /was not paid: The payment is above a spending cap\. It won't be tried again this period\. Receipt: https:\/\/example\.test\/r\/rcpt_/);
});
