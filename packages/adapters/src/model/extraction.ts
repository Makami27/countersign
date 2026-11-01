import type { Proposal } from "@countersign/core";

export type ModelProvider = "groq" | "gemini";
export type ModelProblem = "TIMEOUT" | "NETWORK" | "RATE_LIMITED" | "UNAVAILABLE" | "HTTP" | "NO_ANSWER";

export type Extraction =
  | { readonly provider: ModelProvider; readonly status: "READ"; readonly proposal: Proposal; readonly modelVersion: string | null; readonly modelText: string }
  | { readonly provider: ModelProvider; readonly status: "UNKNOWN"; readonly problem: ModelProblem; readonly httpStatus: number | null; readonly attempts: number };

export type ModelReader = (text: string, payeeIds: readonly string[]) => Promise<Extraction>;

export function problemForStatus(status: number): ModelProblem {
  if (status === 429) return "RATE_LIMITED";
  if (status === 503 || status === 500 || status === 502 || status === 504) return "UNAVAILABLE";
  return "HTTP";
}

export const INSTRUCTIONS = [
  "You read one message sent to a payment assistant and classify it.",
  "kind=pay when the owner asks to pay a known payee. Give payeeId from the list, and amountText as the number of USDC exactly as written in the message, digits and one dot only, no currency sign or word.",
  "kind=change_address when the message says a payee's wallet address changed. Copy newAddress exactly as written.",
  "kind=none otherwise.",
  "For pay and for change_address, payeeId is the known payee the message is about, copied exactly from the list of known payees (for example 'Landlord here' or 'the landlord moved' means landlord).",
  "Always fill every field; use an empty string for a field that does not apply.",
  "reasonQuote must be copied verbatim from the message. Never paraphrase. Never invent an address or an amount. Never convert units.",
].join("\n");

export function withFallback(primary: ModelReader, fallback: ModelReader | null): ModelReader {
  return async (text, payeeIds) => {
    const first = await primary(text, payeeIds);
    if (first.status === "READ" || !fallback) return first;
    return fallback(text, payeeIds);
  };
}
