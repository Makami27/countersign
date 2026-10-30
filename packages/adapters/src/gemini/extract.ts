import type { Proposal } from "@countersign/core";

const AMOUNT_PATTERN = /^(0|[1-9]\d*)$/;
const MAX_QUOTE_CHARS = 500;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["pay", "change_address", "none"] },
    payeeId: { type: "STRING" },
    amountBaseUnits: { type: "STRING" },
    newAddress: { type: "STRING" },
    reasonQuote: { type: "STRING" },
  },
  required: ["kind"],
} as const;

const INSTRUCTIONS = [
  "You read one message sent to a payment assistant and classify it.",
  "kind=pay when the owner asks to pay a known payee; give payeeId from the list and amountBaseUnits as an integer string of USDC base units (6 decimals).",
  "kind=change_address when the message says a payee's wallet address changed; copy newAddress exactly as written.",
  "kind=none otherwise.",
  "reasonQuote must be copied verbatim from the message. Never paraphrase. Never invent an address.",
].join("\n");

export type GeminiConfig = { readonly apiKey: string; readonly model: string };

export async function extractProposal(config: GeminiConfig, text: string, payeeIds: readonly string[]): Promise<Proposal> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${INSTRUCTIONS}\nKnown payees: ${payeeIds.join(", ")}` }] },
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { kind: "none" };
  }
  if (!response.ok) return { kind: "none" };
  const body: unknown = await response.json().catch(() => null);
  const candidateText = (body as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null)?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof candidateText !== "string") return { kind: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidateText);
  } catch {
    return { kind: "none" };
  }
  return toProposal(parsed, text, payeeIds);
}

export function toProposal(raw: unknown, sourceText: string, payeeIds: readonly string[]): Proposal {
  if (raw === null || typeof raw !== "object") return { kind: "none" };
  const r = raw as Record<string, unknown>;
  const quote = typeof r["reasonQuote"] === "string" ? r["reasonQuote"] : "";
  if (quote.length === 0 || quote.length > MAX_QUOTE_CHARS || !sourceText.includes(quote)) return { kind: "none" };
  const payeeId = typeof r["payeeId"] === "string" ? r["payeeId"] : "";
  if (!payeeIds.includes(payeeId)) return { kind: "none" };
  if (r["kind"] === "pay" && typeof r["amountBaseUnits"] === "string" && AMOUNT_PATTERN.test(r["amountBaseUnits"])) {
    return { kind: "pay", payeeId, amountBaseUnits: r["amountBaseUnits"], reasonQuote: quote };
  }
  if (r["kind"] === "change_address" && typeof r["newAddress"] === "string") {
    return { kind: "change_address", payeeId, newAddress: r["newAddress"], reasonQuote: quote };
  }
  return { kind: "none" };
}
