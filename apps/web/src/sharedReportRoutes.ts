import type { ServerResponse } from "node:http";
import { REASONS, SHARED_REASONS, type ReasonCode } from "@countersign/core";
import { problem, send } from "./http.ts";
import { ownerSigned } from "./ownerGate.ts";
import type { OwnerContext } from "./ownerContext.ts";

export async function retractSharedReport(ctx: OwnerContext, res: ServerResponse, receiptId: string, input: Record<string, unknown>): Promise<void> {
  const receipt = await ctx.engine.receiptRecord(receiptId);
  const address = receipt?.address ?? null;
  if (!receipt || !address || !(SHARED_REASONS as readonly (ReasonCode | null)[]).includes(receipt.reason)) return problem(res, 404, "This agent shared no scam report for that receipt. Nothing was changed.");
  if (!(await ownerSigned(ctx, res, input, "retract_shared_report", { receipt: receipt.receipt, address }))) return;
  const written = await ctx.shared.retract({ address, receipt: receipt.receipt });
  if (written.status !== "WRITTEN") return problem(res, 503, REASONS.MEMORY_WRITE_UNCONFIRMED.message);
  await ctx.notify(`Shared scam report retracted with your owner wallet's signature: ${address} (receipt ${receipt.receipt}). Other agents stop counting it when they next read shared memory.`);
  return send(res, 200, { retracted: receipt.receipt });
}
