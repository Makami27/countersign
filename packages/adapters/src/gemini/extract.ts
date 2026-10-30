import type { Proposal } from "@countersign/core";
import { toProposal } from "./proposal.ts";

export { toProposal, usdcToBaseUnits, amountStandsAloneIn } from "./proposal.ts";

const REQUEST_TIMEOUT_MS = 20_000;
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["pay", "change_address", "none"] },
    payeeId: { type: "STRING" },
    amountText: { type: "STRING" },
    newAddress: { type: "STRING" },
    reasonQuote: { type: "STRING" },
  },
  required: ["kind", "payeeId", "amountText", "newAddress", "reasonQuote"],
  propertyOrdering: ["kind", "payeeId", "amountText", "newAddress", "reasonQuote"],
} as const;

const INSTRUCTIONS = [
  "You read one message sent to a payment assistant and classify it.",
  "kind=pay when the owner asks to pay a known payee. Give payeeId from the list, and amountText as the number of USDC exactly as written in the message, digits and one dot only, no currency sign or word.",
  "kind=change_address when the message says a payee's wallet address changed. Copy newAddress exactly as written.",
  "kind=none otherwise.",
  "Always fill every field; use an empty string for a field that does not apply.",
  "reasonQuote must be copied verbatim from the message. Never paraphrase. Never invent an address or an amount. Never convert units.",
].join("\n");

export type GeminiConfig = { readonly apiKey: string; readonly model: string; readonly baseUrl?: string };

export type ModelProblem = "TIMEOUT" | "NETWORK" | "RATE_LIMITED" | "UNAVAILABLE" | "HTTP" | "NO_ANSWER";

export type Extraction =
  | { readonly status: "READ"; readonly proposal: Proposal; readonly modelVersion: string | null; readonly modelText: string }
  | { readonly status: "UNKNOWN"; readonly problem: ModelProblem };

type GenerateResponse = { readonly candidates?: readonly { readonly content?: { readonly parts?: readonly { readonly text?: unknown }[] } }[]; readonly modelVersion?: unknown };

function problemForStatus(status: number): ModelProblem {
  if (status === 429) return "RATE_LIMITED";
  if (status === 503 || status === 500 || status === 502 || status === 504) return "UNAVAILABLE";
  return "HTTP";
}

const RETRYABLE: readonly ModelProblem[] = ["RATE_LIMITED", "UNAVAILABLE", "TIMEOUT"];
const RETRY_DELAYS_MS = [2_000, 5_000] as const;

export async function extractProposal(config: GeminiConfig, text: string, payeeIds: readonly string[], sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<Extraction> {
  let result = await extractOnce(config, text, payeeIds);
  for (const delay of RETRY_DELAYS_MS) {
    if (result.status !== "UNKNOWN" || !RETRYABLE.includes(result.problem)) return result;
    await sleep(delay);
    result = await extractOnce(config, text, payeeIds);
  }
  return result;
}

async function extractOnce(config: GeminiConfig, text: string, payeeIds: readonly string[]): Promise<Extraction> {
  const url = `${config.baseUrl ?? GEMINI_BASE_URL}/models/${encodeURIComponent(config.model)}:generateContent`;
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { status: "UNKNOWN", problem: error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK" };
  }
  if (!response.ok) return { status: "UNKNOWN", problem: problemForStatus(response.status) };
  const body = (await response.json().catch(() => null)) as GenerateResponse | null;
  const candidateText = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof candidateText !== "string") return { status: "UNKNOWN", problem: "NO_ANSWER" };
  const modelVersion = typeof body?.modelVersion === "string" ? body.modelVersion : null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidateText);
  } catch {
    return { status: "READ", proposal: { kind: "none" }, modelVersion, modelText: candidateText };
  }
  return { status: "READ", proposal: toProposal(parsed, text, payeeIds), modelVersion, modelText: candidateText };
}
