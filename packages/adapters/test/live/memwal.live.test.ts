import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { TEST_NAMESPACE_ROOT, isRealUseNamespace, openRecord, sealRecord, type PayeeVersionRecord, type SuiAddress } from "@countersign/core";
import { DEV_RELAYER_URL, MAINNET_RELAYER_URL, MemWalMemory, type MemWalConfig } from "../../src/memwal/memory.ts";
import { recordSignerFromSeed } from "../../src/signer.ts";

const RELAYER_SPACING_MS = 12_000;
const RECORDS = 3;

function liveConfig(): MemWalConfig | null {
  const devKey = process.env["MEMWAL_DEV_PRIVATE_KEY"] ?? "";
  const devAccount = process.env["MEMWAL_DEV_ACCOUNT_ID"] ?? "";
  if (devKey !== "" && devAccount !== "") return { key: devKey, accountId: devAccount, serverUrl: DEV_RELAYER_URL };
  const key = process.env["MEMWAL_PRIVATE_KEY"] ?? "";
  const accountId = process.env["MEMWAL_ACCOUNT_ID"] ?? "";
  return key !== "" && accountId !== "" ? { key, accountId, serverUrl: MAINNET_RELAYER_URL } : null;
}

const config = liveConfig();
const skip = config ? false : "needs MEMWAL_DEV_* or MEMWAL_* keys in .env";
const pause = () => new Promise((resolve) => setTimeout(resolve, RELAYER_SPACING_MS));

function testAddress(): SuiAddress {
  return `0x${randomBytes(32).toString("hex")}` as SuiAddress;
}

test("V18 D9 agent-signed records written to Walrus Memory come back complete through a fresh adapter, and a retried write adds nothing (test namespace)", { skip }, async () => {
  if (!config) return;
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const namespace = `${TEST_NAMESPACE_ROOT}${runId}:payee:live`;
  const signer = recordSignerFromSeed(randomBytes(32).toString("base64"));
  const writer = new MemWalMemory(config);
  const records: PayeeVersionRecord[] = Array.from({ length: RECORDS }, (_, i) => ({
    type: "payee_version", payeeId: "live", version: i + 1, address: testAddress(), status: i === 0 ? "VERIFIED" : "STATED",
    supersedes: i === 0 ? null : 1, evidence: { kind: "owner_onboarding", ownerConfirmationId: `live-test-${runId}` }, createdAt: new Date().toISOString(),
  }));
  const texts = records.map((record) => sealRecord(signer, record));
  const writes: { key: string; blobId: string; ms: number }[] = [];
  for (const [i, text] of texts.entries()) {
    if (i > 0) await pause();
    const key = `live:${runId}:${i + 1}`;
    const started = Date.now();
    const written = await writer.remember(namespace, text, key);
    assert.equal(written.status, "WRITTEN", `write ${i + 1} was ${written.status} (${writer.lastWriteProblem ?? "no detail"})`);
    if (written.status === "WRITTEN") writes.push({ key, blobId: written.blobId, ms: Date.now() - started });
  }

  await pause();
  const reader = new MemWalMemory(config);
  const read = await reader.readAll(namespace);
  const listedCount = await reader.countIn(namespace);
  const listedBlobIds = await reader.listedBlobIds(namespace);
  const recalled = await reader.recallEverything(namespace);

  await pause();
  const firstWrite = writes[0];
  assert.ok(firstWrite && texts[0]);
  const retried = await writer.remember(namespace, texts[0], firstWrite.key);
  const countAfterRetry = await reader.countIn(namespace);

  const realUseOwner = process.env["OWNER_ID"] ?? "owner";
  const evidence = {
    runId, relayer: writer.environment, namespace, classification: "live test data, signed by a throwaway test key, excluded from real-use counts",
    writes, listedCount, listedBlobIds, recalledBlobIds: recalled.blobIds, droppedCount: recalled.droppedCount,
    readAll: read.complete ? { complete: true, records: read.texts.length } : read,
    retry: { sameKey: firstWrite.key, result: retried, countAfterRetry }, countedAsRealUse: isRealUseNamespace(realUseOwner, namespace),
  };
  mkdirSync("evidence/live", { recursive: true });
  writeFileSync(`evidence/live/memwal-${runId}.json`, JSON.stringify(evidence, null, 2));

  assert.equal(read.complete, true);
  if (!read.complete) return;
  assert.equal(read.texts.length, RECORDS);
  assert.ok(read.texts.every((text) => openRecord(signer, text).ok));
  assert.equal(listedCount, RECORDS);
  assert.deepEqual(new Set(listedBlobIds), new Set(writes.map((w) => w.blobId)));
  assert.deepEqual(new Set(recalled.blobIds), new Set(writes.map((w) => w.blobId)));
  assert.deepEqual(retried, { status: "WRITTEN", blobId: firstWrite.blobId });
  assert.equal(countAfterRetry, RECORDS);
  assert.equal(isRealUseNamespace(realUseOwner, namespace), false);
});
