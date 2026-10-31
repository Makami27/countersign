import { headOf, payeeNamespace } from "./payeeBook.ts";
import { versionsFrom } from "./memoryBook.ts";
import { CheckTrail } from "./receipts.ts";
import { refuse, type Subject } from "./engineWrites.ts";
import type { EngineDeps } from "./engineDeps.ts";
import type { Refused, SuiAddress } from "./types.ts";

export type CheckedPayment = { readonly name: string; readonly version: number; readonly address: SuiAddress; readonly amount: bigint; readonly payeeBlobId: string | null; readonly subject: Subject; readonly trail: CheckTrail };

export async function checkPayment(d: EngineDeps, ref: string, payeeId: string, amountBaseUnits: string): Promise<CheckedPayment | Refused> {
  const trail = new CheckTrail();
  const subject = { ref, payeeId, address: null, amountBaseUnits };
  const read = await d.memory.readAll(payeeNamespace(d.ownerId, payeeId));
  if (!read.complete) return refuse(d, "REFUSED", "MEMORY_INCOMPLETE", subject, trail, "MEMORY_COMPLETE");
  trail.pass("MEMORY_COMPLETE");
  const stored = versionsFrom(d.signer, read.records, payeeId);
  if (stored.length === 0) return refuse(d, "REFUSED", "UNKNOWN_PAYEE", subject, trail, "PAYEE_VERIFIED");
  const head = headOf(stored.map((s) => s.record));
  if (head.kind === "none") return refuse(d, "REFUSED", "PAYEE_NOT_VERIFIED", subject, trail, "PAYEE_VERIFIED");
  if (head.kind === "conflict") return refuse(d, "REFUSED", "CONFLICT", subject, trail, "PAYEE_VERIFIED");
  trail.pass("PAYEE_VERIFIED");
  const payee = { ...subject, address: head.version.address };
  if (!/^[1-9]\d*$/.test(amountBaseUnits)) return refuse(d, "REFUSED", "AMOUNT_INVALID", payee, trail, "AMOUNT_VALID");
  trail.pass("AMOUNT_VALID");
  const amount = BigInt(amountBaseUnits);
  if (amount > d.caps.perPaymentBaseUnits) return refuse(d, "REFUSED", "CAP_EXCEEDED", payee, trail, "WITHIN_CAPS");
  const payeeBlobId = stored.find((s) => s.record.version === head.version.version)?.blobId ?? null;
  return { name: head.version.name, version: head.version.version, address: head.version.address, amount, payeeBlobId, subject: payee, trail };
}
