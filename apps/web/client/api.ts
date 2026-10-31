export type ApiError = { readonly status: number; readonly message: string; readonly body: Record<string, unknown> | null };
export type ApiResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ApiError };

const NETWORK_FAILURE = "The server couldn't be reached. Nothing was changed. Check your connection and try again.";
const READ_TIMEOUT_MS = 25_000;
const WRITE_TIMEOUT_MS = 90_000;

function timedOut(method: string, ms: number): string {
  return method === "GET"
    ? `The agent didn't answer within ${ms / 1000} s. Nothing was changed. Try again in a moment.`
    : `The agent didn't answer within ${ms / 1000} s, so the outcome isn't known yet. Check Activity before trying again.`;
}

export async function api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  const ms = method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;
  const signal = AbortSignal.timeout(ms);
  try {
    response = await fetch(path, {
      method,
      signal,
      credentials: "same-origin",
      headers: method === "GET" ? {} : { "content-type": "application/json", "x-countersign": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, error: { status: 0, message: signal.aborted ? timedOut(method, ms) : NETWORK_FAILURE, body: null } };
  }
  const parsed: unknown = await response.json().catch(() => null);
  const record = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  if (!response.ok) {
    const message = typeof record?.["error"] === "string" ? record["error"] : `The server answered ${response.status}. Nothing was changed.`;
    return { ok: false, error: { status: response.status, message, body: record } };
  }
  return { ok: true, data: parsed as T };
}
