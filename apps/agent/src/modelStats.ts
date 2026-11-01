import type { Extraction, ModelReader } from "@countersign/adapters/model";
import type { GroqQuota } from "@countersign/adapters/groq";
import type { ModelStatus } from "@countersign/web/status";

export class ModelStats {
  #status: ModelStatus;

  constructor(primary: string, fallback: string | null) {
    this.#status = { calls: 0, failures: 0, answeredByCode: 0, lastLatencyMs: null, lastOkAt: null, lastError: null, primary, fallback, lastProvider: null, fallbacksUsed: 0, quota: null };
  }

  tracked(extract: ModelReader): ModelReader {
    return async (text, payeeIds) => {
      const started = Date.now();
      const result: Extraction = await extract(text, payeeIds);
      const at = new Date().toISOString();
      const lastLatencyMs = Date.now() - started;
      const fellBack = result.provider !== this.#status.primary ? 1 : 0;
      const base = { ...this.#status, calls: this.#status.calls + 1, lastLatencyMs, lastProvider: result.provider, fallbacksUsed: this.#status.fallbacksUsed + fellBack };
      if (result.status === "READ") this.#status = { ...base, lastOkAt: at };
      else {
        this.#status = { ...base, failures: this.#status.failures + 1, lastError: { problem: `${result.provider}: ${result.problem}`, httpStatus: result.httpStatus, attempts: result.attempts, at } };
        console.error(`model: ${result.provider} ${result.problem}${result.httpStatus === null ? "" : ` (HTTP ${result.httpStatus})`} after ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}, ${lastLatencyMs} ms`);
      }
      return result;
    };
  }

  quota(quota: GroqQuota): void {
    this.#status = { ...this.#status, quota: { provider: "groq", ...quota } };
  }

  answeredByCode(): void {
    this.#status = { ...this.#status, answeredByCode: this.#status.answeredByCode + 1 };
  }

  view(): ModelStatus {
    return this.#status;
  }
}
