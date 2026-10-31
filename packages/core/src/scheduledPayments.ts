import { isPayeeHead, payeeNamespace } from "./payeeBook.ts";
import { versionsFrom } from "./memoryBook.ts";
import { checkPayment } from "./paymentChecks.ts";
import { CheckTrail } from "./receipts.ts";
import { refuse } from "./engineWrites.ts";
import { scheduleHeads, scheduleRunKey, scheduledPaymentId, schedulesNamespace } from "./schedule.ts";
import type { EngineDeps } from "./engineDeps.ts";
import type { PaymentIntent } from "./payments.ts";
import type { PayReserved, Refused } from "./types.ts";

export type ScheduledReservation =
  | PayReserved
  | Refused
  | { readonly verdict: "ALREADY_RESERVED"; readonly payment: PaymentIntent }
  | { readonly verdict: "NOT_ACTIVE" };

export const PAYEE_CHANGED_AFTER_RESERVING = "Nothing was sent: the payee's verified address changed after this scheduled run was reserved.";

async function already(d: EngineDeps, id: string): Promise<ScheduledReservation | null> {
  const payment = await d.payments.payment(id);
  return payment ? { verdict: "ALREADY_RESERVED", payment } : null;
}

export async function reserveScheduled(d: EngineDeps, scheduleId: string, period: string, payeeId: string): Promise<ScheduledReservation> {
  const id = scheduledPaymentId(scheduleId, period);
  const ran = await already(d, id);
  if (ran) return ran;
  const ref = scheduleRunKey(scheduleId, period);
  const read = await d.memory.readAll(schedulesNamespace(d.ownerId));
  if (!read.complete) return refuse(d, "REFUSED", "MEMORY_INCOMPLETE", { ref, payeeId, address: null }, new CheckTrail(), "MEMORY_COMPLETE");
  const schedule = scheduleHeads(d.signer, d.ownerId, read.records).get(scheduleId);
  if (!schedule || schedule.status !== "ACTIVE" || schedule.payeeId !== payeeId) return { verdict: "NOT_ACTIVE" };
  const checked = await checkPayment(d, ref, payeeId, schedule.amountBaseUnits);
  if (!("payeeBlobId" in checked)) return checked;
  const now = d.clock.now().toISOString();
  const intent = { id, payeeId, payeeVersion: checked.version, payeeBlobId: checked.payeeBlobId, address: checked.address, amountBaseUnits: checked.amount, period: now.slice(0, 10), createdAt: now };
  const reservation = await d.payments.reservePayment(intent, d.caps.perDayBaseUnits);
  if (reservation === "DUPLICATE") return (await already(d, id)) ?? { verdict: "NOT_ACTIVE" };
  if (reservation === "PAYEE_CHANGED") return refuse(d, "REFUSED", "PAYEE_CHANGED", checked.subject, checked.trail, "PAYEE_VERIFIED");
  if (reservation === "CAP_EXCEEDED") return refuse(d, "REFUSED", "CAP_EXCEEDED", checked.subject, checked.trail, "WITHIN_CAPS");
  return { verdict: "PAY_RESERVED", paymentId: id, address: intent.address, amountBaseUnits: intent.amountBaseUnits };
}

export async function recheckReserved(d: EngineDeps, intent: PaymentIntent): Promise<"SEND" | "WAIT" | "PAYEE_CHANGED"> {
  if (intent.state !== "RESERVED") return "WAIT";
  const read = await d.memory.readAll(payeeNamespace(d.ownerId, intent.payeeId));
  if (!read.complete) return "WAIT";
  if (isPayeeHead(versionsFrom(d.signer, read.records, intent.payeeId).map((s) => s.record), intent)) return "SEND";
  const moved = await d.payments.movePayment(intent.id, { to: "FAILED", at: d.clock.now().toISOString(), detail: PAYEE_CHANGED_AFTER_RESERVING, reason: "PAYEE_CHANGED" });
  return moved ? "PAYEE_CHANGED" : "WAIT";
}
