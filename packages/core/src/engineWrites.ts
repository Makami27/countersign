import { receiptsNamespace } from "./payeeBook.ts";
import { sealRecord } from "./records.ts";
import { indexRecord } from "./memoryBook.ts";
import type { CheckTrail } from "./receipts.ts";
import type { EngineDeps } from "./engineDeps.ts";
import type { MemoryWrite } from "./ports.ts";
import { SHARED_REASONS, type CheckCode, type ReasonCode, type SharedReason } from "./vocabulary.ts";
import type { Evidence, MemoryRecord, PayeeVersionRecord, ReceiptRecord, ReceiptVerdict, Refused, SeenElsewhere, SuiAddress } from "./types.ts";

export type Subject = { readonly ref: string; readonly payeeId: string | null; readonly address: SuiAddress | null; readonly amountBaseUnits?: string; readonly seenElsewhere?: SeenElsewhere };
export type ReceiptWrite = { readonly receipt: string; readonly blobId: string | null };

export async function writeRecord(d: EngineDeps, namespace: string, record: MemoryRecord, idempotencyKey: string): Promise<MemoryWrite> {
  return d.memory.remember(namespace, sealRecord(d.signer, record), idempotencyKey);
}

export async function writeReceipt(d: EngineDeps, verdict: ReceiptVerdict, reason: ReasonCode | null, subject: Subject, trail: CheckTrail, memoryBlobIds: readonly string[], suiDigest: string | null, id: string = `rcpt_${d.nonces.next()}`, at: string = d.clock.now().toISOString()): Promise<ReceiptWrite> {
  const record: ReceiptRecord = {
    type: "receipt", receipt: id, verdict, reason, ref: subject.ref, payeeId: subject.payeeId, address: subject.address, amountBaseUnits: subject.amountBaseUnits ?? null,
    checks: trail.checks, memoryBlobIds, suiDigest, network: d.network, createdAt: at, ...(subject.seenElsewhere ? { seenElsewhere: subject.seenElsewhere } : {}),
  };
  const written = await writeRecord(d, receiptsNamespace(d.ownerId), record, `receipt:${id}`);
  const blobId = written.status === "WRITTEN" ? written.blobId : null;
  await indexRecord(d.index, record, blobId);
  return { receipt: id, blobId };
}

export async function refuse(d: EngineDeps, verdict: "REFUSED" | "CHANGE_REJECTED", reason: ReasonCode, subject: Subject, trail: CheckTrail, failed: CheckCode | null = null, cites: string | null = null): Promise<Refused> {
  if (failed) trail.fail(failed);
  const written = await writeReceipt(d, verdict, reason, subject, trail, [], null);
  if (subject.address && isShared(reason)) await d.shared.report({ address: subject.address, reason, receipt: written.receipt });
  return { verdict: "REFUSED", reason, receipt: written.receipt, cites, ...(subject.seenElsewhere ? { seenElsewhere: subject.seenElsewhere } : {}) };
}

function isShared(reason: ReasonCode): reason is SharedReason {
  return (SHARED_REASONS as readonly ReasonCode[]).includes(reason);
}

export function payeeVersion(d: EngineDeps, payeeId: string, name: string, version: number, address: SuiAddress, status: PayeeVersionRecord["status"], supersedes: number | null, evidence: Evidence): PayeeVersionRecord {
  return { type: "payee_version", payeeId, name, version, address, status, supersedes, evidence, createdAt: d.clock.now().toISOString() };
}
