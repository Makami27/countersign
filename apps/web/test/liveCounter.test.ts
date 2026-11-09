import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import type { SqlRows } from "@countersign/adapters/sql";
import { LiveCounter, type LiveSource } from "../src/liveCounter.ts";
import { startWebServer, PUBLIC_DIR } from "../src/server.ts";
import { COMPARED_TRIAL, landingHtml } from "../src/landingPage.ts";
import { readActs, readTrial } from "../src/landingData.ts";
import { readMeasurement } from "../src/proofPage.ts";

type Script = { memories: () => Promise<number | null>; shared: () => { agents: number; reports: number } | null; refreshed?: () => void };

function source(script: Script): LiveSource {
  return {
    memoryCounts: async () => {
      const memories = await script.memories();
      return memories === null ? null : { realUseMemories: memories, namespaces: 1, byNamespace: [] };
    },
    shared: { summary: script.shared, refresh: async () => { script.refreshed?.(); return true; } },
  } as unknown as LiveSource;
}

const SHARED = () => ({ agents: 0, reports: 0 });

test("L01 a failed read isn't kept for five minutes: the next try after 20 seconds gets the real number", async () => {
  let now = 0;
  let memories: number | null = null;
  const counter = new LiveCounter(() => source({ memories: async () => memories, shared: SHARED }), { now: () => now });
  assert.equal((await counter.current()).memories, null);
  memories = 16;
  now = 19_000;
  assert.equal((await counter.current()).memories, null);
  now = 21_000;
  assert.equal((await counter.current()).memories, 16);
});

test("L01 a slow Walrus answer counts as failed, and the shared count still comes through", async () => {
  const counter = new LiveCounter(() => source({ memories: () => new Promise(() => undefined), shared: SHARED }), { deadlineMs: 5 });
  assert.deepEqual(await counter.current(), { memories: null, sharedAgents: 0, sharedReports: 0 });
});

test("L02 a full read is kept for five minutes so Walrus isn't asked on every visit", async () => {
  let now = 0;
  let reads = 0;
  const counter = new LiveCounter(() => source({ memories: async () => { reads += 1; return 16; }, shared: SHARED }), { now: () => now });
  await counter.current();
  now = 299_000;
  await counter.current();
  assert.equal(reads, 1);
  now = 301_000;
  await counter.current();
  assert.equal(reads, 2);
});

test("L02 visitors arriving together share one read", async () => {
  let reads = 0;
  const counter = new LiveCounter(() => source({ memories: async () => { reads += 1; return 16; }, shared: SHARED }));
  await Promise.all([counter.current(), counter.current(), counter.current()]);
  assert.equal(reads, 1);
});

test("L03 when a later read fails, the last known number stays for an hour, then it says unknown", async () => {
  let now = 0;
  let memories: number | null = 16;
  const counter = new LiveCounter(() => source({ memories: async () => memories, shared: SHARED }), { now: () => now });
  await counter.current();
  memories = null;
  now = 301_000;
  assert.equal((await counter.current()).memories, 16);
  assert.equal(counter.known().memories, 16);
  now = 3_599_000;
  assert.equal(counter.known().memories, 16);
  now = 3_700_000;
  assert.equal((await counter.current()).memories, null);
});

test("L04 shared reports that couldn't be read are read again instead of waiting for the ten-minute refresh", async () => {
  let readable = false;
  let refreshes = 0;
  const counter = new LiveCounter(() => source({ memories: async () => 16, shared: () => (readable ? { agents: 2, reports: 3 } : null), refreshed: () => { refreshes += 1; readable = true; } }));
  assert.deepEqual(await counter.current(), { memories: 16, sharedAgents: 2, sharedReports: 3 });
  assert.equal(refreshes, 1);
});

test("L05 with no agent connected the counters are unknown, never zero", async () => {
  const counter = new LiveCounter(() => null);
  assert.deepEqual(await counter.current(), { memories: null, sharedAgents: null, sharedReports: null });
});

test("L06 the counters answer even when the database never does", async (t) => {
  const hanging = new Proxy({}, { get: () => () => new Promise(() => undefined) }) as SqlRows;
  const server = startWebServer({ port: 0, network: "testnet", proof: hanging, version: null, owners: null });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/live`, { signal: AbortSignal.timeout(3_000) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { live: { memories: null, sharedAgents: null, sharedReports: null } });
});

async function page(live: Parameters<typeof landingHtml>[4]): Promise<string> {
  return landingHtml(await readFile(`${PUBLIC_DIR}index.html`, "utf8"), await readMeasurement(), await readActs(), await readTrial(COMPARED_TRIAL.attack, COMPARED_TRIAL.trial), live);
}

test("L07 V29 numbers the server knows are in the page itself, so they show even if the page's script never runs; a zero shared count is left out", async () => {
  const known = await page({ memories: 16, sharedAgents: 2, sharedReports: 3 });
  assert.ok(known.includes('data-live="memories">16<'));
  assert.ok(known.includes("Shared scam reports right now: 3, from 2 agents."));
  const none = await page({ memories: 16, sharedAgents: 0, sharedReports: 0 });
  assert.ok(none.includes('<p class="live-line" data-shared-line hidden></p>'));
  assert.ok(!none.includes("No shared reports yet."));
});

test("L07 unknown numbers stay as a dash in the page", async () => {
  const unknown = await page({ memories: null, sharedAgents: null, sharedReports: null });
  assert.ok(unknown.includes('data-live="memories">—<'));
  assert.ok(unknown.includes('data-live="sharedReports">—<'));
});
