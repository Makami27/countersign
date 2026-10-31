import { test } from "node:test";
import assert from "node:assert/strict";
import { SharedAttackList } from "@countersign/core/shared";
import { lookalikeOf, message, recordSigner, wallet } from "../../../packages/core/test/fixtures.ts";
import { ownerServer } from "./support/ownerServer.ts";

test("V22 retracting a shared scam report needs the owner wallet's signature and sends a Telegram notice; a receipt this agent never shared can't be retracted", async (t) => {
  const s = await ownerServer(t);
  const me = wallet();
  await s.signedBy("POST", "/api/app/owner/wallet", { address: me.address }, [me]);
  const fake = lookalikeOf(s.landlord.address);
  const refused = await s.agent.handle(message(`pay ${fake}`), { kind: "change_address", payeeId: "landlord", newAddress: fake, reasonQuote: "x" });
  if (refused.verdict !== "REFUSED") return assert.fail("expected a refusal");
  const path = `/api/app/receipts/${refused.receipt}/retract`;
  assert.equal((await s.call("POST", path, {})).status, 428);
  assert.equal((await s.signedBy("POST", path, {}, [wallet()])).status, 403);
  const watcher = new SharedAttackList({ memory: s.memory, signer: recordSigner(), now: () => new Date() });
  await watcher.refresh();
  assert.equal(watcher.flag(fake).status, "SEEN");
  assert.equal((await s.signedBy("POST", path, {}, [me])).status, 200);
  await watcher.refresh();
  assert.equal(watcher.flag(fake).status, "CLEAR");
  assert.ok(s.extras.notices.some((n) => n.startsWith("Shared scam report retracted with your owner wallet's signature")));
  const paid = await s.agent.handle(message("pay designer 1"), { kind: "pay", payeeId: "designer", amountBaseUnits: "1000000", reasonQuote: "x" });
  assert.equal(paid.verdict, "PAY_RESERVED");
  assert.equal((await s.call("POST", "/api/app/receipts/rcpt_nothere01/retract", {})).status, 404);
});

test("V22 no owner endpoint lists the shared blacklist: addresses other agents reported never appear in owner reads", async (t) => {
  const s = await ownerServer(t);
  const reported = wallet().address;
  await new SharedAttackList({ memory: s.memory, signer: recordSigner(), now: () => new Date() }).report({ address: reported, reason: "LOOKALIKE_ADDRESS", receipt: "rcpt_elsewhere" });
  await s.shared.refresh();
  assert.equal(s.shared.flag(reported).status, "SEEN");
  for (const path of ["overview", "payees", "payees/landlord", "activity", "settings", "schedules"]) {
    const body = await (await fetch(`${s.base}/api/app/${path}`, { headers: { cookie: s.cookie } })).text();
    assert.ok(!body.includes(reported) && !body.includes("rcpt_elsewhere"), path);
  }
});
