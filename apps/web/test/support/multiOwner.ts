import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { TestContext } from "node:test";
import type { AddressInfo } from "node:net";
import { InMemoryIndex, InMemoryMemory, InMemoryPaymentLedger } from "@countersign/core";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { PaymentRunner } from "@countersign/adapters/payments";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { StandInVerifier, wallet, type TestWallet } from "../../../../packages/core/test/fixtures.ts";
import { OwnerAuth } from "../../src/ownerAuth.ts";
import { OwnerDirectory } from "../../src/ownerDirectory.ts";
import { TelegramLinks } from "../../src/telegramLinks.ts";
import { DiscordLinks } from "../../src/discordLinks.ts";
import { DEFAULT_HOURLY_LIMITS, QuotaMeter, type QuotaLimits } from "../../src/quota.ts";
import type { ModelReader } from "@countersign/adapters/model";
import { buildOwnerRuntime, type BuiltRuntime } from "../../src/ownerRuntime.ts";
import { startWebServer } from "../../src/server.ts";
import { ScriptedChain } from "./scheduleWorld.ts";
import { signInAs } from "./signIn.ts";

export const DISCORD_TEST_APPLICATION_ID = "123456789012345678";

export async function multiOwnerServer(t: TestContext, maxOwners = 3, limits: QuotaLimits = DEFAULT_HOURLY_LIMITS, reader: ModelReader = async () => ({ provider: "groq", status: "UNKNOWN", problem: "UNAVAILABLE", httpStatus: null, attempts: 1 })) {
  const dir = mkdtempSync(join(tmpdir(), "countersign-owners-"));
  const memory = new InMemoryMemory();
  const verifier = new StandInVerifier();
  const notices = new Map<string, string[]>();
  const built = new Map<string, BuiltRuntime>();
  const admin = wallet();
  const rows = new SqliteRows(join(dir, "public.sqlite"));
  const auth = await OwnerAuth.open(rows, "example.test");
  const links = await TelegramLinks.open(rows, { telegramUserId: 1001, ownerId: "admin1" });
  const discordLinks = await DiscordLinks.open(rows);
  const build = async (ownerId: string): Promise<BuiltRuntime> => {
    const index = new InMemoryIndex();
    const ledger = new InMemoryPaymentLedger(index);
    const runtime = await buildOwnerRuntime({
      ownerId, network: "testnet", publicUrl: "https://example.test", agentAddress: wallet().address, memory, relayerLabel: "sandbox (not Walrus Memory)",
      storage: { index, ledger, rows: new SqliteRows(join(dir, `${ownerId}.sqlite`)) }, signer: recordSignerFromSeed(randomBytes(32).toString("base64")), verifier,
      roundTrips: { check: async () => "NOT_PROVEN" }, runner: new PaymentRunner({ ledger, chain: new ScriptedChain(), clock: { now: () => new Date() }, sleep: async () => undefined }),
      balances: async () => ({ status: "UNKNOWN", detail: "test" }), memoryCounts: async () => null,
      deposits: { prepare: async () => ({ ok: false, kind: "UNKNOWN", detail: "test" }), sight: async () => ({ kind: "UNKNOWN", detail: "test" }) },
      notify: async (text) => void notices.set(ownerId, [...(notices.get(ownerId) ?? []), text]),
      reader, quota: new QuotaMeter(ownerId === "admin1" ? null : limits), isAdmin: ownerId === "admin1",
      telegram: { link: async () => { const issued = await links.issue(ownerId); return { url: `https://t.me/countersign_test_bot?start=${issued.token}`, expires: issued.expires }; }, linked: async () => (await links.chatOf(ownerId)) !== null },
      discord: discordLinks.portFor(ownerId, DISCORD_TEST_APPLICATION_ID, () => true),
      defaults: { perPaymentBaseUnits: 50_000_000n, perDayBaseUnits: 100_000_000n, cooldownSeconds: 0 }, now: Date.now,
    });
    built.set(ownerId, runtime);
    return runtime;
  };
  const owners = await OwnerDirectory.open({ rows, auth, adminOwnerId: "admin1", adminAddress: admin.address, maxOwners, create: build, notifyAdmin: async (text) => void notices.set("admin1", [...(notices.get("admin1") ?? []), text]), now: Date.now }, await build("admin1"), build);
  const server = startWebServer({ port: 0, network: "testnet", proof: undefined, version: null, owners });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const as = async (who: TestWallet) => {
    const signed = await signInAs(base, who);
    const call = async (method: string, path: string, body?: Record<string, unknown>) => {
      const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-countersign": "1", cookie: signed.cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    };
    const signedBy = async (method: string, path: string, body: Record<string, unknown>) => {
      const first = await call(method, path, body);
      if (first.status !== 428) return first;
      const approvals: Record<string, { nonce: string; signature: string }> = {};
      for (const c of first.body["approvals"] as { field: string; nonce: string; message: string }[]) approvals[c.field] = { nonce: c.nonce, signature: who.sign(c.message) };
      return call(method, path, { ...body, approvals });
    };
    return { status: signed.status, cookie: signed.cookie, call, signedBy };
  };
  const ownerOf = (who: TestWallet) => owners.all().find((o) => o.ctx.wallets.current() === who.address)?.ctx ?? null;
  return { base, owners, built, notices, memory, admin, as, ownerOf, links, discordLinks };
}
