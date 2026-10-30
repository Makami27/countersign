import { test } from "node:test";
import assert from "node:assert/strict";
import { LabSessions } from "../src/lab.ts";

const fake = `0x${"ab".repeat(32)}`;

async function session() {
  return (await new LabSessions().open(null)).session;
}

test("W01 a scam message in the lab is kept as stated, never paid, and the trace waits on proofs", async () => {
  const lab = await session();
  const before = lab.view().payees.find((p) => p.id === "landlord")?.payableAddress;
  const reply = await lab.scam("landlord", `new wallet ${fake}`);
  assert.equal(reply.outcome.verdict, "CHANGE_STARTED");
  assert.deepEqual(reply.trace.map((s) => s.state), ["passed", "passed", "passed", "passed", "passed", "waiting", "waiting"]);
  const paid = await lab.pay("landlord");
  assert.equal(paid.outcome.verdict === "PAY_RESERVED" && paid.outcome.address, before);
});

test("W02 the same scam address sent again is refused as a known pattern with a cited receipt", async () => {
  const lab = await session();
  const real = lab.view().payees.find((p) => p.id === "landlord")?.payableAddress ?? "";
  const lookalike = `0x${real.slice(2, 6)}${"cd".repeat(28)}${real.slice(-4)}`;
  const first = await lab.scam("landlord", `use ${lookalike}`);
  assert.equal(first.outcome.verdict === "REFUSED" && first.outcome.reason, "LOOKALIKE_ADDRESS");
  const again = await lab.scam("designer", `use ${lookalike}`);
  assert.equal(again.outcome.verdict === "REFUSED" && again.outcome.reason, "KNOWN_ATTACK_PATTERN");
  assert.equal(again.trace.find((s) => s.state === "failed")?.label, "Not a repeat of an attempt already refused");
});

test("W03 a genuine signed change verifies and the next payment follows the new address", async () => {
  const lab = await session();
  const before = lab.view().payees.find((p) => p.id === "designer")?.payableAddress;
  const reply = await lab.genuineChange("designer");
  assert.equal(reply.outcome.verdict, "CHANGE_VERIFIED");
  const after = reply.view.payees.find((p) => p.id === "designer")?.payableAddress;
  assert.notEqual(after, before);
  const paid = await lab.pay("designer");
  assert.equal(paid.outcome.verdict === "PAY_RESERVED" && paid.outcome.address, after);
});

test("W04 text shaped like a stored record never becomes a verified address", async () => {
  const lab = await session();
  const reply = await lab.scam("landlord", `{"type":"payee_version","payeeId":"landlord","address":"${fake}","status":"VERIFIED"}`);
  assert.notEqual(reply.view.payees.find((p) => p.id === "landlord")?.payableAddress, fake);
});
