import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { startWebServer } from "../src/server.ts";

type View = { payees: { id: string; payableAddress: string | null; versions: { status: string }[] }[]; activity: { label: string; verdict: string; reason: string | null }[] };
type Reply = { outcome: { verdict: string; reason?: string; address?: string }; view: View; note: string | null; answer?: { kind: string; question?: string } };

test("V25 the public demo runs each letter through the real engine in a per-visitor sandbox: look-alike refused, fake history kept as stated, a forged record ignored, a genuine request asked how much and then paid", async (t) => {
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owners: null });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await fetch(`${base}/demo`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/build\/demo\.js/);
  let cookie = "";
  const post = async (path: string, body: Record<string, unknown>) => {
    const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
    cookie = (r.headers.get("set-cookie") ?? cookie).split(";")[0] ?? cookie;
    return { status: r.status, body: (await r.json()) as Reply };
  };
  const start = (await post("/api/lab/state", {})).body.view;
  const landlord = start.payees.find((p) => p.id === "landlord")?.payableAddress;
  const lookalike = await post("/api/lab/letter", { letter: "lookalike", payeeId: "landlord" });
  assert.deepEqual([lookalike.body.outcome.verdict, lookalike.body.outcome.reason], ["REFUSED", "LOOKALIKE_ADDRESS"]);
  assert.equal((await post("/api/lab/letter", { letter: "history", payeeId: "landlord" })).body.outcome.verdict, "CHANGE_STARTED");
  const forged = await post("/api/lab/letter", { letter: "forged", payeeId: "landlord" });
  assert.deepEqual([forged.body.outcome.verdict, forged.body.outcome.address], ["PAY_RESERVED", landlord]);
  assert.match(forged.body.note ?? "", /isn't signed by this agent/);
  const genuine = await post("/api/lab/letter", { letter: "genuine", payeeId: "designer" });
  assert.deepEqual([genuine.body.answer?.kind, genuine.body.answer?.question], ["ask_amount", "How much should I pay Designer?"]);
  const paid = await post("/api/lab/pay", { payeeId: "designer", amount: "1" });
  assert.equal(paid.body.outcome.verdict, "PAY_RESERVED");
  assert.equal((await post("/api/lab/pay", { payeeId: "designer" })).status, 400);
  assert.equal(paid.body.view.payees.find((p) => p.id === "landlord")?.payableAddress, landlord);
  assert.deepEqual(paid.body.view.activity.map((a) => a.verdict), ["PAY_RESERVED", "ASK_AMOUNT", "PAY_RESERVED", "CHANGE_STARTED", "REFUSED"]);
  assert.equal((await post("/api/lab/letter", { letter: "steal", payeeId: "landlord" })).status, 400);
});
