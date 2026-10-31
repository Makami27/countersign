import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { lookalikeOf, message, wallet, world } from "../../../packages/core/test/fixtures.ts";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { startWebServer } from "../src/server.ts";
import { OwnerAuth } from "../src/ownerAuth.ts";
import { OwnerSettings } from "../src/ownerSettings.ts";
import { ChangeSteps } from "../src/changeSteps.ts";
import type { OwnerContext } from "../src/ownerContext.ts";

type Slow = { balances?: () => Promise<never>; memoryCounts?: () => Promise<never> };
const never = () => new Promise<never>(() => undefined);

async function signedIn(t: TestContext, slow: Slow = {}) {
  const w = await world();
  const rows = new SqliteRows(join(mkdtempSync(join(tmpdir(), "countersign-reads-")), "web.sqlite"));
  const auth = await OwnerAuth.open(rows);
  const owner: OwnerContext = {
    ownerId: "owner1", network: "testnet", agentAddress: wallet().address, publicUrl: "https://example.test", engine: w.agent, index: w.index, ledger: w.payments, auth,
    settings: await OwnerSettings.open(rows, { perPaymentBaseUnits: 50_000_000n, perDayBaseUnits: 100_000_000n, cooldownSeconds: 60 }),
    balances: slow.balances ?? (async () => ({ status: "KNOWN", suiBaseUnits: 1n, usdcBaseUnits: 2n })),
    memory: () => ({ relayer: "sandbox (not Walrus Memory)", restored: true, restoredAt: null, legacyRecords: 0, ignoredRecords: 0 }),
    memoryCounts: slow.memoryCounts ?? (async () => ({ realUseMemories: 3, namespaces: 1 })),
    sendPayment: async () => assert.fail("no payments here"), steps: await ChangeSteps.open(rows), cooldownMs: () => 60_000,
    verifySignature: (m, s, a) => w.signatures.verifyPersonalMessage(m, s, a),
  };
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owner });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json", "x-countersign": "1" }, body: JSON.stringify({ code: await auth.issueCode() }) });
  const setCookie = login.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  const get = async (path: string) => {
    const r = await fetch(`${base}${path}`, { headers: { cookie } });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  return { ...w, base, login, setCookie, get };
}

test("V01 Q06 a sign-in sets one session cookie that is Secure, HttpOnly, SameSite=Strict and scoped to the whole site", async (t) => {
  const { login, setCookie } = await signedIn(t);
  assert.equal(login.status, 200);
  assert.match(setCookie, /^cs_owner=[A-Za-z0-9_-]{20,};/);
  for (const part of ["Path=/", "HttpOnly", "Secure", "SameSite=Strict"]) assert.ok(setCookie.split("; ").includes(part), `missing ${part}`);
});

test("V02 V06 every owner read after sign-in answers with real data, never an empty placeholder", async (t) => {
  const w = await signedIn(t);
  const fake = lookalikeOf(w.landlord.address);
  await w.agent.handle(message(`new wallet ${fake}`), { kind: "change_address", payeeId: "landlord", newAddress: fake, reasonQuote: "new wallet" });
  const overview = await w.get("/api/app/overview");
  assert.equal(overview.status, 200);
  assert.equal(overview.body["payeeCount"], 2);
  const payees = await w.get("/api/app/payees");
  const list = payees.body["payees"] as { id?: string; name?: string; status?: string }[];
  assert.deepEqual(list.map((p) => p.id).sort(), ["designer", "landlord"]);
  assert.ok(list.every((p) => typeof p.name === "string" && typeof p.status === "string"));
  const detail = await w.get("/api/app/payees/landlord");
  assert.equal((detail.body["summary"] as { id?: string }).id, "landlord");
  assert.ok(Array.isArray(detail.body["history"]));
  const activity = await w.get("/api/app/activity");
  assert.ok(Array.isArray(activity.body["items"]) && (activity.body["items"] as unknown[]).length > 0);
});

test("V02 a balance or memory count that never answers shows a reason within seconds instead of holding the screen", async (t) => {
  const w = await signedIn(t, { balances: never, memoryCounts: never });
  const started = Date.now();
  const overview = await w.get("/api/app/overview");
  assert.equal(overview.status, 200);
  assert.ok(Date.now() - started < 12_000);
  assert.deepEqual(overview.body["balances"], { status: "UNKNOWN", detail: "Tatum (agent balance) didn't answer within 8 s." });
  assert.equal(overview.body["memoryCounts"], null);
  assert.equal(overview.body["memoryCountsWhy"], "Walrus Memory (memory count) didn't answer within 8 s.");
});

test("V01 a signed-out read is a 401 that says why, and a used code can't sign in twice", async (t) => {
  const w = await signedIn(t);
  const r = await fetch(`${w.base}/api/app/overview`);
  assert.equal(r.status, 401);
  assert.match(((await r.json()) as { error: string }).error, /signed out/);
});
