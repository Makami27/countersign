import { toProposal } from "../gemini/proposal.ts";
import { INSTRUCTIONS, problemForStatus, type Extraction } from "../model/extraction.ts";

const REQUEST_TIMEOUT_MS = 20_000;
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
const ANSWER_SHAPE = "Answer with one JSON object with exactly these keys: kind, payeeId, amountText, newAddress, reasonQuote.";

export type GroqConfig = { readonly apiKey: string; readonly model: string; readonly baseUrl?: string };
export type GroqQuota = { readonly remainingRequests: number | null; readonly limitRequests: number | null; readonly resetRequests: string | null; readonly at: string };

type ChatResponse = { readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[]; readonly model?: unknown };

function headerNumber(response: Response, name: string): number | null {
  const value = Number(response.headers.get(name));
  return response.headers.has(name) && Number.isFinite(value) ? value : null;
}

export function normalizeAnswer(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null) continue;
    cleaned[key] = key === "amountText" && typeof value === "string" ? value.replace(/\s*usdc\s*$/i, "") : value;
  }
  return cleaned;
}

export async function extractWithGroq(config: GroqConfig, text: string, payeeIds: readonly string[], onQuota: (quota: GroqQuota) => void = () => undefined): Promise<Extraction> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl ?? GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model, temperature: 0, response_format: { type: "json_object" },
        messages: [{ role: "system", content: `${INSTRUCTIONS}\n${ANSWER_SHAPE}\nKnown payees: ${payeeIds.join(", ")}` }, { role: "user", content: text }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { provider: "groq", status: "UNKNOWN", problem: error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK", httpStatus: null, attempts: 1 };
  }
  onQuota({ remainingRequests: headerNumber(response, "x-ratelimit-remaining-requests"), limitRequests: headerNumber(response, "x-ratelimit-limit-requests"), resetRequests: response.headers.get("x-ratelimit-reset-requests"), at: new Date().toISOString() });
  if (!response.ok) return { provider: "groq", status: "UNKNOWN", problem: problemForStatus(response.status), httpStatus: response.status, attempts: 1 };
  const body = (await response.json().catch(() => null)) as ChatResponse | null;
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return { provider: "groq", status: "UNKNOWN", problem: "NO_ANSWER", httpStatus: response.status, attempts: 1 };
  const modelVersion = typeof body?.model === "string" ? body.model : null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { provider: "groq", status: "READ", proposal: { kind: "none" }, modelVersion, modelText: content };
  }
  return { provider: "groq", status: "READ", proposal: toProposal(normalizeAnswer(parsed), text, payeeIds), modelVersion, modelText: content };
}
