import { test } from "node:test";
import assert from "node:assert/strict";
import { wallet } from "../../../packages/core/test/fixtures.ts";
import { ownerServer as setup } from "./support/ownerServer.ts";

test("V20 a payee with an invalid address or name is refused before the owner wallet is asked to sign anything", async (t) => {
  const s = await setup(t);
  const me = s.me;
  for (const body of [{ name: "Plumber", address: "0x123" }, { name: "!!!", address: wallet().address }]) {
    const answer = await s.call("POST", "/api/app/payees", body);
    assert.equal(answer.status, 400);
    assert.equal(answer.body["approvals"], undefined);
  }
});
