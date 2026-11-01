import { test } from "node:test";
import assert from "node:assert/strict";
import { lookalikeOf, onboard, wallet } from "../../../packages/core/test/fixtures.ts";
import { multiOwnerServer } from "./support/multiOwner.ts";

test("V24 a pasted message takes the forwarded-message path: a look-alike is refused by code with a receipt, a pay request only previews, and an unreadable free text changes nothing", async (t) => {
  const s = await multiOwnerServer(t);
  const bWallet = wallet();
  const b = await s.as(bWallet);
  const bCtx = s.ownerOf(bWallet);
  if (!bCtx) return assert.fail("no owner B");
  const rent = wallet();
  await onboard(bCtx.engine, "Rent", rent);
  const scam = await b.call("POST", "/api/app/paste", { text: `Hi, rent here. New wallet ${lookalikeOf(rent.address)}, please use it.` });
  assert.equal((scam.body["refusal"] as { reason: string }).reason, "LOOKALIKE_ADDRESS");
  assert.equal(scam.body["by"], "code");
  const pay = await b.call("POST", "/api/app/paste", { text: "pay rent 0.10" });
  assert.match(String(pay.body["says"]), /request to pay Rent 0\.10 USDC\. Nothing was sent/);
  assert.deepEqual(await bCtx.ledger.recentPayments(10, null), []);
  assert.equal((await b.call("POST", "/api/app/paste", { text: "hello, how are things?" })).status, 503);
  const overview = (await b.call("GET", "/api/app/overview")).body as { checklist: Record<string, boolean>; isAdmin: boolean };
  assert.deepEqual([overview.isAdmin, overview.checklist["payeeAdded"], overview.checklist["linkSigned"], overview.checklist["scamTried"], overview.checklist["paid"], overview.checklist["funded"]], [false, true, true, true, false, false]);
});

test("V24 only the admin sees the admin page; removing an owner needs the admin wallet, ends their sessions and drops their agent", async (t) => {
  const s = await multiOwnerServer(t);
  const a = await s.as(s.admin);
  const bWallet = wallet();
  const b = await s.as(bWallet);
  const bId = s.ownerOf(bWallet)?.ownerId ?? "";
  assert.equal((await b.call("GET", "/api/app/admin")).status, 404);
  assert.equal((await b.signedBy("POST", `/api/app/admin/owners/${bId}/remove`, {})).status, 404);
  const listed = (await a.call("GET", "/api/app/admin")).body["owners"] as { ownerId: string; admin: boolean }[];
  assert.deepEqual(listed.map((o) => o.admin).sort(), [false, true]);
  assert.equal((await a.call("POST", `/api/app/admin/owners/${bId}/remove`, {})).status, 428);
  assert.equal((await a.call("POST", "/api/app/admin/owners/admin1/remove", {})).status, 404);
  assert.equal((await a.signedBy("POST", `/api/app/admin/owners/${bId}/remove`, {})).status, 200);
  assert.equal((await b.call("GET", "/api/app/overview")).status, 401);
  assert.equal(s.owners.get(bId), null);
});

test("V24 an owner past its hourly allowance gets 'busy, nothing was changed'; the admin has no limit", async (t) => {
  const s = await multiOwnerServer(t, 3, { walrus: 1, tatum: 1000, model: 1000 });
  const a = await s.as(s.admin);
  const bWallet = wallet();
  const b = await s.as(bWallet);
  const bCtx = s.ownerOf(bWallet);
  bCtx?.quota.record("walrus");
  const busy = await b.call("POST", "/api/app/paste", { text: "pay rent 0.10" });
  assert.equal(busy.status, 429);
  assert.match(String(busy.body["error"]), /^Busy: .*Nothing was changed\. Try again in a few minutes\.$/);
  assert.equal((await b.call("GET", "/api/app/overview")).status, 200);
  for (let i = 0; i < 3; i += 1) s.ownerOf(s.admin)?.quota.record("walrus");
  assert.notEqual((await a.call("POST", "/api/app/paste", { text: "pay rent 0.10" })).status, 429);
});
