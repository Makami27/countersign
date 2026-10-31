import { ownerNamespace, payeeIdFromNamespace, receiptsNamespace } from "./payeeBook.ts";
import { openRecord } from "./records.ts";
import type { IndexStore, MemoryPort, RecordSigner, StoredText } from "./ports.ts";
import type { MemoryRecord, PayeeVersionRecord } from "./types.ts";

export type StoredVersion = { readonly record: PayeeVersionRecord; readonly blobId: string };

export type RestoreResult = { readonly ok: true; readonly ignored: number; readonly legacy: number; readonly payees: number } | { readonly ok: false; readonly reason: "MEMORY_INCOMPLETE" };

export type RestoreDeps = {
  readonly ownerId: string;
  readonly memory: MemoryPort & { listNamespaces(prefix: string): Promise<readonly string[] | null> };
  readonly index: IndexStore;
  readonly signer: RecordSigner;
};

export async function indexRecord(index: IndexStore, record: MemoryRecord, blobId: string | null): Promise<void> {
  if (record.type === "payee_version") await index.putPayeeVersion(record);
  else if (record.type === "receipt") await index.putReceipt(record, blobId);
}

export function versionsFrom(signer: RecordSigner, records: readonly StoredText[], payeeId: string): StoredVersion[] {
  const versions: StoredVersion[] = [];
  for (const { text, blobId } of records) {
    const opened = openRecord(signer, text);
    if (opened.ok && opened.record.type === "payee_version" && opened.record.payeeId === payeeId) versions.push({ record: opened.record, blobId });
  }
  return versions;
}

function belongs(ownerId: string, record: MemoryRecord, namespace: string, payeeId: string | null): boolean {
  if (record.type === "payee_version") return payeeId !== null && record.payeeId === payeeId;
  if (record.type === "owner_wallet") return namespace === ownerNamespace(ownerId) && record.ownerId === ownerId;
  return namespace === receiptsNamespace(ownerId);
}

export async function restoreIndex(deps: RestoreDeps): Promise<RestoreResult> {
  const namespaces = await deps.memory.listNamespaces(`countersign:${deps.ownerId}:`);
  if (!namespaces) return { ok: false, reason: "MEMORY_INCOMPLETE" };
  const reads = await Promise.all(namespaces.map(async (ns) => ({ ns, read: await deps.memory.readAll(ns) })));
  if (reads.some((r) => !r.read.complete)) return { ok: false, reason: "MEMORY_INCOMPLETE" };
  await deps.index.clearIndex();
  let ignored = 0;
  let legacy = 0;
  let payees = 0;
  for (const { ns, read } of reads) {
    if (!read.complete) continue;
    const payeeId = payeeIdFromNamespace(deps.ownerId, ns);
    if (payeeId) payees += 1;
    for (const { text, blobId } of read.records) {
      const opened = openRecord(deps.signer, text);
      if (!opened.ok && opened.why === "LEGACY_RECORD") legacy += 1;
      else if (!opened.ok || !belongs(deps.ownerId, opened.record, ns, payeeId)) ignored += 1;
      else await indexRecord(deps.index, opened.record, blobId);
    }
  }
  return { ok: true, ignored, legacy, payees };
}
