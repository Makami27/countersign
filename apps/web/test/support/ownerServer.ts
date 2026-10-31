import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DEFAULT_CAPS, wallet, world, type TestWallet } from "../../../../packages/core/test/fixtures.ts";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { startWebServer } from "../../src/server.ts";
import { OwnerAuth } from "../../src/ownerAuth.ts";
import { OwnerSettings } from "../../src/ownerSettings.ts";
import { ChangeSteps } from "../../src/changeSteps.ts";
import type { OwnerContext } from "../../src/ownerContext.ts";
import { ownerExtras } from "./ownerExtras.ts";

export type Challenge = { field: string; nonce: string; message: string; signer: string };

export async function ownerServer(t: TestContext) {
  const w = await world(DEFAULT_CAPS, new Date().toISOString());
  let now = Date.now();
  const rows = new SqliteRows(join(mkdtempSync(join(tmpdir(), "countersign-owner-")), "web.sqlite"));
  const auth = await OwnerAuth.open(rows);
  const extras = await ownerExtras(rows, w, () => now);
  const owner: OwnerContext = {
    ownerId: "owner1", network: "testnet", agentAddress: wallet().address, publicUrl: "https://example.test", engine: w.agent, index: w.index, ledger: w.payments, auth,
    settings: await OwnerSettings.open(rows, { perPaymentBaseUnits: 50_000_000n, perDayBaseUnits: 100_000_000n, cooldownSeconds: 0 }),
    balances: async () => ({ status: "UNKNOWN", detail: "test" }), memory: () => ({ relayer: "sandbox (not Walrus Memory)", restored: true, restoredAt: null, legacyRecords: 0, ignoredRecords: 0 }),
    memoryCounts: async () => null, sendPayment: async () => assert.fail("no payments here"), steps: await ChangeSteps.open(rows), cooldownMs: () => 0,
    verifySignature: (m, s, a) => w.signatures.verifyPersonalMessage(m, s, a), ...extras,
  };
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owner });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json", "x-countersign": "1" }, body: JSON.stringify({ code: await auth.issueCode() }) });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const call = async (method: string, path: string, body: Record<string, unknown>) => {
    const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-countersign": "1", cookie }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const signedBy = async (method: string, path: string, body: Record<string, unknown>, signers: readonly TestWallet[]) => {
    const first = await call(method, path, body);
    if (first.status !== 428) return first;
    const approvals: Record<string, { nonce: string; signature: string }> = {};
    for (const c of first.body["approvals"] as Challenge[]) {
      const by = signers.find((s) => s.address === c.signer) ?? signers[0];
      if (!by) throw new Error("no signer");
      approvals[c.field] = { nonce: c.nonce, signature: by.sign(c.message) };
    }
    return call(method, path, { ...body, approvals });
  };
  return { ...w, owner, rows, extras, call, signedBy, advance: (ms: number) => void (now += ms) };
}

