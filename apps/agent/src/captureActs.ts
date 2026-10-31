import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { isRealUseNamespace } from "@countersign/core";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { PostgresIndex, openPostgres } from "@countersign/adapters/postgres";

const BASE = "https://countersign-agent-7u1c.onrender.com";
const AGGREGATOR = "https://aggregator.walrus-mainnet.walrus.space/v1/blobs/";
const acts = [
  { dir: "evidence/acts/act2", act: "Act 2: a look-alike of Rent's verified address is refused with the comparison view", receipt: process.argv[2] ?? "" },
  { dir: "evidence/acts/act3", act: "Act 3: the same message again is refused as a known attack, citing the Act 2 receipt", receipt: process.argv[3] ?? "" },
];
if (acts.some((a) => !a.receipt)) throw new Error("Usage: captureActs.ts <act 2 receipt id> <act 3 receipt id>");
const env = process.env;
const ownerId = env["OWNER_ID"] ?? "";
const pool = openPostgres({ url: env["DATABASE_URL"] ?? "" });
const index = await PostgresIndex.open(pool);
const memory = new MemWalMemory({ key: env["MEMWAL_PRIVATE_KEY"] ?? "", accountId: env["MEMWAL_ACCOUNT_ID"] ?? "", serverUrl: env["MEMWAL_RELAYER_URL"] ?? "" });
const counts = await memory.namespaceCounts(`countersign:${ownerId}:`);
const real = (counts ?? []).filter((c) => isRealUseNamespace(ownerId, c.name));
const memoryCounts = counts === null ? null : {
  realUseMemories: real.reduce((sum, c) => sum + c.count, 0),
  realUseNamespaces: real.map((c) => ({ suffix: c.name.slice(`countersign:${ownerId}:`.length), count: c.count })),
  readAt: new Date().toISOString(),
};
const browser = await chromium.launch();
for (const act of acts) {
  mkdirSync(act.dir, { recursive: true });
  const record = await index.receipt(act.receipt);
  if (!record) throw new Error(`No receipt ${act.receipt} in the index.`);
  const blobId = await index.receiptBlobId(act.receipt);
  const blob = blobId ? await fetch(`${AGGREGATOR}${blobId}`).then(async (r) => ({ status: r.status, bytes: (await r.arrayBuffer()).byteLength })) : null;
  const shots: string[] = [];
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: "dark" });
    await page.goto(`${BASE}/r/${act.receipt}`, { waitUntil: "networkidle", timeout: 90_000 });
    const file = `${act.dir}/receipt-page-${width}.png`;
    await page.screenshot({ path: file, fullPage: true });
    shots.push(file);
    await page.close();
  }
  writeFileSync(`${act.dir}/records.json`, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    act: act.act,
    classification: "real use: the owner forwarded the message to the deployed bot on Render; memory on the Walrus Memory mainnet relayer; no money moved (refusal)",
    receiptPage: `${BASE}/r/${act.receipt}`,
    receipt: record,
    receiptBlob: blobId ? { blobId, aggregator: `${AGGREGATOR}${blobId}`, httpStatus: blob?.status ?? null, encryptedBytes: blob?.bytes ?? null } : null,
    screenshots: shots,
    memoryCounts,
  }, null, 2)}\n`);
  console.log(`${act.dir}: ${record.verdict} ${record.reason ?? ""}, blob ${blobId ? `${blob?.status} (${blob?.bytes} bytes)` : "unknown"}`);
}
await browser.close();
await pool.end();
console.log(memoryCounts ? `real-use memories: ${memoryCounts.realUseMemories} (${memoryCounts.realUseNamespaces.map((n) => `${n.suffix} ${n.count}`).join(", ")})` : "memory count unavailable");
