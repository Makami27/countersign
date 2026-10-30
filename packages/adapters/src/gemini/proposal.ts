import { z } from "zod";
import { usdcToBaseUnits, type Proposal } from "@countersign/core";

export { usdcToBaseUnits } from "@countersign/core";

const MAX_QUOTE_CHARS = 500;

export const ModelOutput = z
  .object({
    kind: z.enum(["pay", "change_address", "none"]),
    payeeId: z.string().max(64).optional(),
    amountText: z.string().max(32).optional(),
    newAddress: z.string().max(80).optional(),
    reasonQuote: z.string().max(MAX_QUOTE_CHARS).optional(),
  })
  .strict();

export function amountStandsAloneIn(amountText: string, sourceText: string): boolean {
  const escaped = amountText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d.])${escaped}(?!\\.?\\d)`).test(sourceText);
}

export function toProposal(raw: unknown, sourceText: string, payeeIds: readonly string[]): Proposal {
  const parsed = ModelOutput.safeParse(raw);
  if (!parsed.success) return { kind: "none" };
  const output = parsed.data;
  const quote = output.reasonQuote ?? "";
  if (quote.length === 0 || !sourceText.includes(quote)) return { kind: "none" };
  const payeeId = output.payeeId ?? "";
  if (payeeIds.filter((id) => id === payeeId).length !== 1) return { kind: "none" };
  if (output.kind === "pay") {
    const amountText = output.amountText ?? "";
    const amountBaseUnits = usdcToBaseUnits(amountText);
    if (!amountBaseUnits || !amountStandsAloneIn(amountText, sourceText)) return { kind: "none" };
    return { kind: "pay", payeeId, amountBaseUnits, reasonQuote: quote };
  }
  if (output.kind === "change_address" && output.newAddress) return { kind: "change_address", payeeId, newAddress: output.newAddress, reasonQuote: quote };
  return { kind: "none" };
}
