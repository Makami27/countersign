import type { Proposal } from "@countersign/core";
import { toProposal } from "./proposal.ts";
import { INSTRUCTIONS, problemForStatus, type Extraction, type ModelProblem } from "../model/extraction.ts";

export type { Extraction, ModelProblem } from "../model/extraction.ts";

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

export type GeminiConfig = { readonly apiKey: string; readonly model: string; readonly baseUrl?: string };

type GenerateResponse = { readonly candidates?: readonly { readonly content?: { readonly parts?: readonly { readonly text?: unknown }[] } }[]; readonly modelVersion?: unknown };

const RETRYABLE: readonly ModelProblem[] = ["RATE_LIMITED", "UNAVAILABLE"];
const RETRY_DELAY_MS = 2_000;

export async function extractProposal(config: GeminiConfig, text: string, payeeIds: readonly string[], sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<Extraction> {
  const first = await extractOnce(config, text, payeeIds, 1);
  if (first.status !== "UNKNOWN" || !RETRYABLE.includes(first.problem)) return first;
  await sleep(RETRY_DELAY_MS);
  return extractOnce(config, text, payeeIds, 2);
}

async function extractOnce(config: GeminiConfig, text: string, payeeIds: readonly string[], attempts: number): Promise<Extraction> {
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
    return { provider: "gemini", status: "UNKNOWN", problem: error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK", httpStatus: null, attempts };
  }
  if (!response.ok) return { provider: "gemini", status: "UNKNOWN", problem: problemForStatus(response.status), httpStatus: response.status, attempts };
  const body = (await response.json().catch(() => null)) as GenerateResponse | null;
  const candidateText = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof candidateText !== "string") return { provider: "gemini", status: "UNKNOWN", problem: "NO_ANSWER", httpStatus: response.status, attempts };
  const modelVersion = typeof body?.modelVersion === "string" ? body.modelVersion : null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidateText);
  } catch {
    return { provider: "gemini", status: "READ", proposal: { kind: "none" }, modelVersion, modelText: candidateText };
  }
  return { provider: "gemini", status: "READ", proposal: toProposal(parsed, text, payeeIds), modelVersion, modelText: candidateText };
}
