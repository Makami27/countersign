import { test } from "node:test";
import assert from "node:assert/strict";
import { payStages, remainingToday } from "../client/payStages.ts";
import { ownerServer } from "./support/ownerServer.ts";

const AMOUNT = "0.10 USDC";

function states(phase: Parameters<typeof payStages>[0]): string[] {
  return payStages(phase, AMOUNT, "Rent").map((stage) => stage.state);
}

test("P01 the three stages move Checking, Sending, Settled in order", () => {
  assert.deepEqual(payStages("checking", AMOUNT, "Rent").map((stage) => stage.label), ["Checking", "Sending", "Settled"]);
  assert.deepEqual(states("checking"), ["active", "waiting", "waiting"]);
  assert.deepEqual(states("SENDING"), ["done", "active", "waiting"]);
  assert.deepEqual(states("SETTLED"), ["done", "done", "done"]);
});

test("P01 every stage says what happened to the money, and only a settled payment says it arrived", () => {
  const checking = payStages("checking", AMOUNT, "Rent");
  assert.match(checking[0]?.words ?? "", /Nothing has been sent/);
  assert.match(payStages("SENDING", AMOUNT, "Rent")[1]?.words ?? "", /Nothing is confirmed yet/);
  assert.match(payStages("SETTLED", AMOUNT, "Rent")[2]?.words ?? "", /0\.10 USDC reached Rent's verified address/);
  for (const phase of ["checking", "RESERVED", "SENDING", "SENT", "FAILED", "UNKNOWN"] as const) assert.doesNotMatch(payStages(phase, AMOUNT, "Rent")[2]?.words ?? "", /reached/, phase);
});

test("P01 a failed payment says no USDC moved; an unknown one says it won't be sent again", () => {
  assert.deepEqual(states("FAILED"), ["done", "failed", "waiting"]);
  assert.match(payStages("FAILED", AMOUNT, "Rent")[1]?.words ?? "", /No USDC moved/);
  assert.deepEqual(states("UNKNOWN"), ["done", "unsure", "waiting"]);
  assert.match(payStages("UNKNOWN", AMOUNT, "Rent")[1]?.words ?? "", /will not be sent again/);
});

test("P02 what's left of today's cap never goes below zero", () => {
  assert.equal(remainingToday("5000000", "2000000"), 3_000_000n);
  assert.equal(remainingToday("5000000", "9000000"), 0n);
});

test("P03 a send that throws after the payment is reserved leaves the server running and the payment open", async (t) => {
  const s = await ownerServer(t);
  (s.owner as { sendPayment: unknown }).sendPayment = async () => { throw new Error("receipt store unreachable"); };
  const head = await s.agent.payeeHead("landlord");
  const address = head.kind === "verified" ? head.version.address : "";
  const started = await s.call("POST", "/api/app/payments", { payeeId: "landlord", amount: "0.10", expectedAddress: address });
  assert.equal(started.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const status = await fetch(`${s.base}/api/app/payments/${String(started.body["paymentId"])}`, { headers: { cookie: s.cookie } });
  assert.equal(status.status, 200);
  assert.equal(((await status.json()) as { payment: { state: string } }).payment.state, "RESERVED");
});
