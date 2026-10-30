import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { TEST_NAMESPACE_ROOT, isRealUseNamespace } from "@countersign/core";
import { MAINNET_RELAYER_URL, MemWalMemory } from "@countersign/adapters/memwal";

const RECORDS = Number(process.argv[2] ?? "100");
const SPACING_MS = Number(process.argv[3] ?? "60000");
const runId = process.argv[4] ?? new Date().toISOString().replace(/[:.]/g, "-");
const key = process.env["MEMWAL_PRIVATE_KEY"] ?? "";
const accountId = process.env["MEMWAL_ACCOUNT_ID"] ?? "";
if (key === "" || accountId === "") throw new Error("MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID are required. Nothing was written.");

const memory = new MemWalMemory({ key, accountId, serverUrl: MAINNET_RELAYER_URL });
const namespace = `${TEST_NAMESPACE_ROOT}s12-scale-${runId}`;
const file = `evidence/live/s12-scale-${runId}.json`;
const writes: { i: number; ms: number; status: string; blobId: string | null; problem: string | null }[] = [];
mkdirSync("evidence/live", { recursive: true });

function save(extra: Record<string, unknown>): void {
  writeFileSync(file, JSON.stringify({ runId, relayer: memory.environment, namespace, classification: "S12 at scale: labelled test data in a countersign-test: namespace, excluded from real-use counts", countedAsRealUse: isRealUseNamespace(process.env["OWNER_ID"] ?? "owner", namespace), records: RECORDS, spacingMs: SPACING_MS, writes, ...extra }, null, 2));
}

for (let i = 1; i <= RECORDS; i++) {
  const started = Date.now();
  const text = JSON.stringify({ record: { type: "s12-scale-test", runId, i, filler: randomBytes(8).toString("hex") }, sig: "test" });
  const written = await memory.remember(namespace, text, `s12:${runId}:${i}`);
  writes.push({ i, ms: Date.now() - started, status: written.status, blobId: written.status === "WRITTEN" ? written.blobId : null, problem: memory.lastWriteProblem });
  save({ phase: "writing" });
  console.log(`${i}/${RECORDS} ${written.status} ${Date.now() - started} ms`);
  const wait = SPACING_MS - (Date.now() - started);
  if (i < RECORDS && wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

const written = writes.filter((w) => w.status === "WRITTEN").length;
const listed = await memory.countIn(namespace);
const listedBlobIds = await memory.listedBlobIds(namespace);
const t0 = Date.now();
const read = await memory.readAll(namespace);
const readMs = Date.now() - t0;
const recalled = await memory.recallEverything(namespace).catch((error: unknown) => ({ texts: [], blobIds: [], droppedCount: -1, error: String(error) }));
const outcome = read.complete && read.records.length === written && listed === written ? "CONFIRMED" : "WRONG";
save({ phase: "done", outcome, written, listedCount: listed, listedBlobCount: listedBlobIds?.length ?? null, recalledCount: recalled.blobIds.length, droppedCount: recalled.droppedCount, readAll: read.complete ? { complete: true, records: read.records.length } : read, readMs });
console.log(`S12 at scale ${outcome}: written ${written}, listed ${listed}, recalled ${recalled.blobIds.length}, dropped ${recalled.droppedCount}. ${file}`);
