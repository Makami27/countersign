import { test } from "node:test";
import assert from "node:assert/strict";
import { lookalikeOf, onboard, wallet } from "../../../packages/core/test/fixtures.ts";
import { ownerServer as setup, type Challenge } from "./support/ownerServer.ts";

async function requestChange(s: Awaited<ReturnType<typeof setup>>, address: string): Promise<string> {
  const asked = await s.call("POST", "/api/app/payees/landlord/changes", { address });
  assert.equal(asked.status, 200);
  const nonce = /\/sign\/([^/]+)$/.exec(String(asked.body["signUrl"]))?.[1];
  if (!nonce) throw new Error("no signing link");
  return nonce;
}

test("V12 confirming a change yourself is refused before any signature when the address became a look-alike, with a receipt and a Telegram notice", async (t) => {
  const s = await setup(t);
  const studio = wallet();
  const nonce = await requestChange(s, lookalikeOf(studio.address));
  await onboard(s.agent, "Studio", studio);
  const refused = await s.call("POST", `/api/app/changes/${nonce}/confirm`, {});
  assert.equal(refused.status, 422);
  const refusal = refused.body["refusal"] as { reason: string; receipt: string };
  assert.equal(refusal.reason, "LOOKALIKE_ADDRESS");
  assert.match(refusal.receipt, /^rcpt_/);
  assert.equal((await s.owner.steps.progress(nonce)).owner, null);
  assert.ok(s.extras.notices.some((n) => n.startsWith("Refused your confirmation of the address change for landlord") && n.includes(refusal.receipt)));
});

test("V12 after you confirm, Telegram gets the waiting period and a cancel link, and one owner-signed click cancels the change", async (t) => {
  const s = await setup(t);
  const next = wallet().address;
  const nonce = await requestChange(s, next);
  assert.equal((await s.signedBy("POST", `/api/app/changes/${nonce}/confirm`, {}, [s.me])).status, 200);
  assert.ok(s.extras.notices.some((n) => n.startsWith("You confirmed the address change for landlord") && n.includes("/app/payees/landlord") && n.includes("cancel it now")));
  const unsigned = await s.call("POST", `/api/app/changes/${nonce}/cancel`, {});
  assert.equal(unsigned.status, 428);
  assert.match((unsigned.body["approvals"] as Challenge[])[0]?.message ?? "", /action:cancel_owner_change\nmeaning:cancel a waiting payee address change/);
  const cancelled = await s.signedBy("POST", `/api/app/changes/${nonce}/cancel`, {}, [s.me]);
  assert.equal(cancelled.status, 200);
  assert.equal((cancelled.body["refusal"] as { reason: string }).reason, "CANCELLED_BY_OWNER");
  assert.equal(await s.index.pendingChange(nonce), null);
  assert.ok(s.extras.notices.some((n) => n.startsWith("Address change for landlord") && n.includes("cancelled with your wallet's signature")));
  const head = await s.agent.payeeHead("landlord");
  assert.equal(head.kind === "verified" && head.version.address, s.landlord.address);
  assert.equal((await s.signedBy("POST", `/api/app/changes/${nonce}/cancel`, {}, [s.me])).status, 409);
});
