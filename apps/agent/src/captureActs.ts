import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { isRealUseNamespace } from "@countersign/core";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { PostgresIndex, openPostgres } from "@countersign/adapters/postgres";

const AGGREGATOR = "https://aggregator.walrus-mainnet.walrus.space/v1/blobs/";
const ACTS: Record<string, { readonly title: string; readonly classification: string }> = {
  "2": { title: "Act 2: a look-alike of Rent's verified address is refused with the comparison view", classification: "real use: the owner forwarded the message to the deployed bot on Render; memory on the Walrus Memory mainnet relayer; no money moved (refusal)" },
  "3": { title: "Act 3: the same message again is refused as a known attack, citing the Act 2 receipt", classification: "real use: the owner forwarded the message to the deployed bot on Render; memory on the Walrus Memory mainnet relayer; no money moved (refusal)" },
  "4": { title: "Act 4: Rent's address changes only after its current wallet and then the new wallet sign; the next payment goes to the new wallet", classification: "real use on Sui testnet with test USDC: the owner signed the change on the deployed signing page with Rent's current wallet, then the new wallet (both the owner's Slush accounts); the 0.01 test USDC payment was made by the operator command apps/agent/src/payPayee.ts through the same engine checks against the deployed agent's Postgres ledger; memory on the Walrus Memory mainnet relayer" },
};

const [act = "", ...rest] = process.argv.slice(2);
const signAt = rest.indexOf("--sign");
const signNonce = signAt >= 0 ? rest[signAt + 1] ?? "" : null;
const receipts = signAt >= 0 ? rest.slice(0, signAt) : rest;
const spec = ACTS[act];
if (!spec || receipts.length === 0) throw new Error("Usage: captureActs.ts <act 2|3|4> <receipt id>... [--sign <nonce>]");
const env = process.env;
const base = (env["PUBLIC_BASE_URL"] ?? "").replace(/\/+$/, "");
if (!/^https:\/\//.test(base)) throw new Error("Set PUBLIC_BASE_URL to the deployed agent's https origin.");
const dir = `evidence/acts/act${act}`;
mkdirSync(dir, { recursive: true });
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

async function shoot(browser: Browser, url: string, name: string): Promise<string[]> {
  const shots: string[] = [];
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: "dark" });
    await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
    const file = `${dir}/${name}-${width}.png`;
    await page.screenshot({ path: file, fullPage: true });
    shots.push(file);
    await page.close();
  }
  return shots;
}

const browser = await chromium.launch();
const captured = [];
for (const id of receipts) {
  const record = await index.receipt(id);
  if (!record) throw new Error(`No receipt ${id} in the index.`);
  const blobId = await index.receiptBlobId(id);
  const blob = blobId ? await fetch(`${AGGREGATOR}${blobId}`).then(async (r) => ({ status: r.status, bytes: (await r.arrayBuffer()).byteLength })) : null;
  const screenshots = await shoot(browser, `${base}/r/${id}`, receipts.length === 1 ? "receipt-page" : `receipt-${record.verdict.toLowerCase()}`);
  captured.push({
    receiptPage: `${base}/r/${id}`, receipt: record,
    receiptBlob: blobId ? { blobId, aggregator: `${AGGREGATOR}${blobId}`, httpStatus: blob?.status ?? null, encryptedBytes: blob?.bytes ?? null } : null,
    transaction: record.suiDigest ? `https://suiscan.xyz/${record.network}/tx/${record.suiDigest}` : null,
    screenshots,
  });
  console.log(`${id}: ${record.verdict} ${record.reason ?? ""}, blob ${blobId ? `${blob?.status} (${blob?.bytes} bytes)` : "unknown"}`);
}
const signPage = signNonce ? { url: `${base}/sign/${signNonce}`, state: await fetch(`${base}/api/sign/${signNonce}`).then((r) => r.json()) as unknown, screenshots: await shoot(browser, `${base}/sign/${signNonce}`, "sign-link-used") } : null;
await browser.close();
await pool.end();
writeFileSync(`${dir}/records.json`, `${JSON.stringify({ capturedAt: new Date().toISOString(), act: spec.title, classification: spec.classification, receipts: captured, signPage, memoryCounts }, null, 2)}\n`);
console.log(memoryCounts ? `real-use memories: ${memoryCounts.realUseMemories} (${memoryCounts.realUseNamespaces.map((n) => `${n.suffix} ${n.count}`).join(", ")})` : "memory count unavailable");
