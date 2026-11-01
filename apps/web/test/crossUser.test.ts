import { test } from "node:test";
import assert from "node:assert/strict";
import { lookalikeOf, message, onboard, wallet } from "../../../packages/core/test/fixtures.ts";
import { multiOwnerServer } from "./support/multiOwner.ts";

test("V24 a new wallet becomes a new owner with its own agent and the admin is told; the admin wallet opens the admin's agent; a full agent turns newcomers away", async (t) => {
  const s = await multiOwnerServer(t, 2);
  const a = await s.as(s.admin);
  assert.equal(a.status, 200);
  assert.equal(s.ownerOf(s.admin)?.ownerId, "admin1");
  const bWallet = wallet();
  const b = await s.as(bWallet);
  assert.equal(b.status, 200);
  const bOwner = s.ownerOf(bWallet);
  assert.match(bOwner?.ownerId ?? "", /^o[0-9a-f]{10}$/);
  assert.notEqual(bOwner?.agentAddress, s.ownerOf(s.admin)?.agentAddress);
  assert.ok((s.notices.get("admin1") ?? []).some((n) => n.startsWith("New owner joined")));
  assert.equal((await s.as(bWallet)).status, 200);
  assert.equal(s.owners.all().length, 2);
  assert.equal((await s.as(wallet())).status, 403);
});

test("V24 cross-user: B can't see, pay, change, approve, schedule or retract anything of A's through the owner app, even by guessing ids; /sign links and receipts stay public", async (t) => {
  const s = await multiOwnerServer(t);
  const a = await s.as(s.admin);
  const bWallet = wallet();
  const b = await s.as(bWallet);
  const aCtx = s.ownerOf(s.admin);
  if (!aCtx) return assert.fail("no owner A");
  const landlord = wallet();
  await onboard(aCtx.engine, "Landlord", landlord);
  const paid = await aCtx.engine.handle(message("pay landlord 1"), { kind: "pay", payeeId: "landlord", amountBaseUnits: "1000000", reasonQuote: "x" });
  if (paid.verdict !== "PAY_RESERVED") return assert.fail("A's payment didn't reserve");
  const schedule = await a.signedBy("POST", "/api/app/schedules", { payeeId: "landlord", amount: "1", every: "month", day: 5 });
  const scheduleId = (schedule.body["schedule"] as { scheduleId: string }).scheduleId;
  const change = await a.call("POST", "/api/app/payees/landlord/changes", { address: wallet().address });
  const nonce = String(change.body["signUrl"]).split("/sign/")[1] ?? "";
  const scam = await aCtx.engine.handle(message(`new wallet ${lookalikeOf(landlord.address)}`), { kind: "change_address", payeeId: "landlord", newAddress: lookalikeOf(landlord.address), reasonQuote: "x" });
  const receipt = scam.verdict === "REFUSED" ? scam.receipt : "";

  assert.deepEqual((await b.call("GET", "/api/app/payees")).body["payees"], []);
  assert.equal((await b.call("GET", "/api/app/payees/landlord")).status, 404);
  assert.equal((await b.call("GET", `/api/app/payments/${paid.paymentId}`)).status, 404);
  assert.deepEqual((await b.call("GET", "/api/app/schedules")).body["schedules"], []);
  assert.ok(!JSON.stringify((await b.call("GET", "/api/app/activity")).body).includes(receipt));
  assert.equal((await b.call("POST", "/api/app/payments", { payeeId: "landlord", amount: "1", expectedAddress: landlord.address })).status, 409);
  assert.equal((await b.call("POST", `/api/app/changes/${nonce}/confirm`, {})).status, 410);
  assert.equal((await b.signedBy("DELETE", `/api/app/schedules/${scheduleId}`, {})).status, 404);
  assert.equal((await b.signedBy("POST", `/api/app/receipts/${receipt}/retract`, {})).status, 404);
  assert.notEqual((await b.call("GET", "/api/app/overview")).body["agentAddress"], aCtx.agentAddress);

  const asked = await a.call("POST", "/api/app/payees", { name: "Plumber", address: wallet().address });
  const challenge = (asked.body["approvals"] as { nonce: string; message: string }[])[0];
  const stolen = await b.call("POST", "/api/app/payees", { name: "Plumber", address: wallet().address, approvals: { owner: { nonce: challenge?.nonce ?? "", signature: s.admin.sign(challenge?.message ?? "") } } });
  assert.equal(stolen.status, 403);
  assert.equal((await s.ownerOf(bWallet)?.index.payeeIds())?.length, 0);

  assert.equal(((await (await fetch(`${s.base}/api/sign/${nonce}`)).json()) as { kind: string }).kind, "change");
  assert.equal((await fetch(`${s.base}/r/${receipt}`)).status, 200);
  assert.equal((await aCtx.index.payeeIds()).length, 1);
});

test("V24 V22 each owner's agent has its own key: a scam address refused by A's agent is refused for B as SEEN_BY_OTHER_AGENT", async (t) => {
  const s = await multiOwnerServer(t);
  await s.as(s.admin);
  const bWallet = wallet();
  await s.as(bWallet);
  const aCtx = s.ownerOf(s.admin);
  const bCtx = s.ownerOf(bWallet);
  if (!aCtx || !bCtx) return assert.fail("owners missing");
  const aPayee = wallet();
  await onboard(aCtx.engine, "Landlord", aPayee);
  await onboard(bCtx.engine, "Rent", wallet());
  const scam = lookalikeOf(aPayee.address);
  const first = await aCtx.engine.handle(message(`landlord moved to ${scam}`), { kind: "change_address", payeeId: "landlord", newAddress: scam, reasonQuote: "x" });
  assert.equal(first.verdict === "REFUSED" && first.reason, "LOOKALIKE_ADDRESS");
  await bCtx.shared.refresh();
  const second = await bCtx.engine.handle(message(`rent moved to ${scam}`), { kind: "change_address", payeeId: "rent", newAddress: scam, reasonQuote: "x" });
  assert.equal(second.verdict === "REFUSED" && second.reason, "SEEN_BY_OTHER_AGENT");
  assert.equal(second.verdict === "REFUSED" && second.seenElsewhere?.agents, 1);
});
