import { writeFileSync } from "node:fs";
import { isRealUseNamespace, openRecord } from "@countersign/core";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { loadConfig } from "./config.ts";

const config = loadConfig(process.env);
const memory = new MemWalMemory(config.memwal);
const signer = recordSignerFromSeed(config.recordSigningKey);
const prefix = `countersign:${config.ownerId}:`;
const counts = await memory.namespaceCounts(prefix);
if (!counts) throw new Error("Walrus Memory didn't list the namespaces. Nothing was written.");
const namespaces = [];
for (const { name, count } of counts.filter((c) => isRealUseNamespace(config.ownerId, c.name))) {
  const read = await memory.readAll(name);
  if (!read.complete) throw new Error(`${name} could not be read completely (${read.why}). Nothing was written.`);
  const records = read.records.map(({ text, blobId }) => {
    const opened = openRecord(signer, text);
    if (!opened.ok) return { blobId, signedByAgent: false, why: opened.why };
    const r = opened.record;
    const what = r.type === "payee_version" ? `${r.payeeId} v${r.version} ${r.status} (${r.evidence.kind})` : r.type === "receipt" ? `${r.verdict}${r.reason ? ` ${r.reason}` : ""} ${r.receipt}` : r.type === "owner_wallet" ? `owner wallet v${r.version} (${r.how})` : `schedule ${r.scheduleId} v${r.version} ${r.status}`;
    return { blobId, signedByAgent: true, type: r.type, what, createdAt: r.createdAt };
  });
  namespaces.push({ suffix: name.slice(prefix.length), listedCount: count, readCount: records.length, records });
}
const total = namespaces.reduce((sum, n) => sum + n.readCount, 0);
const out = { countedAt: new Date().toISOString(), relayer: memory.environment, ownerPrefix: "countersign:<owner>:", excluded: "test namespaces (countersign-test:), other owners, and countersign:shared:attacks", total, namespaces };
writeFileSync("evidence/a02-memory-count.json", `${JSON.stringify(out, null, 2)}\n`);
console.log(`${memory.environment}: ${total} records`);
for (const n of namespaces) for (const r of n.records) console.log(`${n.suffix}\t${"what" in r ? r.what : `UNSIGNED ${r.why}`}\t${"createdAt" in r ? r.createdAt : ""}`);
