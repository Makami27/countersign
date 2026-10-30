export type GraphqlResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly kind: "RATE_LIMITED" | "HTTP" | "NETWORK" | "GRAPHQL" | "TIMEOUT"; readonly detail: string };

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const REQUEST_TIMEOUT_MS = 15_000;

export class TatumGraphql {
  readonly #url: string;
  readonly #apiKey: string;

  constructor(url: string, apiKey: string) {
    this.#url = url;
    this.#apiKey = apiKey;
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<GraphqlResult<T>> {
    let last: GraphqlResult<T> = { ok: false, kind: "NETWORK", detail: "not attempted" };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      last = await this.#once<T>(query, variables);
      const retryable = !last.ok && (last.kind === "RATE_LIMITED" || last.kind === "NETWORK" || last.kind === "TIMEOUT" || (last.kind === "HTTP" && last.detail.startsWith("5")));
      if (!retryable) return last;
      await new Promise((resolve) => setTimeout(resolve, BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 200));
    }
    return last;
  }

  async #once<T>(query: string, variables: Record<string, unknown>): Promise<GraphqlResult<T>> {
    let response: Response;
    try {
      response = await fetch(this.#url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.#apiKey },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      return { ok: false, kind: timedOut ? "TIMEOUT" : "NETWORK", detail: timedOut ? "timeout" : "fetch failed" };
    }
    if (response.status === 429) return { ok: false, kind: "RATE_LIMITED", detail: "429" };
    if (!response.ok) return { ok: false, kind: "HTTP", detail: String(response.status) };
    const body: unknown = await response.json().catch(() => null);
    if (body === null || typeof body !== "object") return { ok: false, kind: "GRAPHQL", detail: "non-JSON body" };
    const { data, errors } = body as { data?: unknown; errors?: unknown };
    if (Array.isArray(errors) && errors.length > 0) return { ok: false, kind: "GRAPHQL", detail: JSON.stringify(errors).slice(0, 300) };
    if (data === undefined || data === null) return { ok: false, kind: "GRAPHQL", detail: "no data" };
    return { ok: true, data: data as T };
  }
}
