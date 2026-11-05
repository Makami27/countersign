import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import { REASONS, formatUsdc } from "@countersign/core";
import { problem, send } from "./http.ts";
import type { OwnerContext } from "./ownerContext.ts";
import { NOTHING_ASKED, amountQuestion, questionWords, quickAmounts, saidNotProvenWords } from "./paymentReading.ts";

const MAX_PASTE_CHARS = 4_000;

async function nameOf(ctx: OwnerContext, payeeId: string): Promise<string> {
  return [...(await ctx.index.payeeVersions(payeeId))].sort((a, b) => b.version - a.version)[0]?.name ?? payeeId;
}

export async function pasteRoute(ctx: OwnerContext, res: ServerResponse, input: Record<string, unknown>): Promise<void> {
  const text = String(input["text"] ?? "").trim();
  if (!text || text.length > MAX_PASTE_CHARS) return problem(res, 400, `Paste the message you received (up to ${MAX_PASTE_CHARS} characters). Nothing was changed.`);
  const reading = await ctx.read(text);
  if (reading.status === "UNKNOWN") return problem(res, 503, "The message couldn't be read just now: the model didn't answer. Nothing was changed. Try again shortly.");
  if (reading.status === "QUESTION") {
    const { question, payeeNames } = reading;
    const says = questionWords(question, payeeNames);
    if (question.kind !== "ask_amount") return send(res, 200, { by: "code", says });
    return send(res, 200, { by: "code", says, ask: { payeeId: question.payee.id, name: question.payee.name, question: amountQuestion(question.payee.name), amounts: quickAmounts(ctx.settings.values().perPaymentBaseUnits) } });
  }
  const inbound = { id: `paste:${randomBytes(8).toString("hex")}`, channel: "paste" as const, from: "pasted", text, receivedAt: new Date().toISOString() };
  const proposal = reading.proposal;
  if (proposal.kind === "pay") {
    const preview = await ctx.engine.previewPayment(inbound, proposal);
    if (preview.verdict === "REFUSED") return send(res, 200, { by: reading.by, refusal: { ...REASONS[preview.reason], reason: preview.reason, receipt: preview.receipt } });
    return send(res, 200, { by: reading.by, says: `This reads as a request to pay ${preview.name} ${formatUsdc(preview.amountBaseUnits)} USDC. Nothing was sent.`, preview: { payeeId: preview.payeeId, name: preview.name, amount: formatUsdc(preview.amountBaseUnits) } });
  }
  const outcome = await ctx.engine.handle(inbound, proposal);
  if (outcome.verdict === "REFUSED") return send(res, 200, { by: reading.by, refusal: { ...REASONS[outcome.reason], reason: outcome.reason, receipt: outcome.receipt, cites: outcome.cites, seenElsewhere: outcome.seenElsewhere ?? null } });
  if (outcome.verdict === "CHANGE_STARTED") return send(res, 200, { by: reading.by, says: saidNotProvenWords(await nameOf(ctx, proposal.kind === "change_address" ? proposal.payeeId : "")), signUrl: `${ctx.publicUrl ?? ""}/sign/${outcome.nonce}` });
  return send(res, 200, { by: reading.by, says: NOTHING_ASKED });
}
