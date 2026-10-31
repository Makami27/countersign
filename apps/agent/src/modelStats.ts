import type { Extraction } from "@countersign/adapters/gemini";
import type { ModelStatus } from "@countersign/web/status";

export class ModelStats {
  #status: ModelStatus = { calls: 0, failures: 0, answeredByCode: 0, lastLatencyMs: null, lastOkAt: null, lastError: null };

  tracked(extract: (text: string, payeeIds: readonly string[]) => Promise<Extraction>): (text: string, payeeIds: readonly string[]) => Promise<Extraction> {
    return async (text, payeeIds) => {
      const started = Date.now();
      const result = await extract(text, payeeIds);
      const at = new Date().toISOString();
      const lastLatencyMs = Date.now() - started;
      if (result.status === "READ") this.#status = { ...this.#status, calls: this.#status.calls + 1, lastLatencyMs, lastOkAt: at };
      else {
        this.#status = { ...this.#status, calls: this.#status.calls + 1, failures: this.#status.failures + 1, lastLatencyMs, lastError: { problem: result.problem, httpStatus: result.httpStatus, attempts: result.attempts, at } };
        console.error(`model: ${result.problem}${result.httpStatus === null ? "" : ` (HTTP ${result.httpStatus})`} after ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}, ${lastLatencyMs} ms`);
      }
      return result;
    };
  }

  answeredByCode(): void {
    this.#status = { ...this.#status, answeredByCode: this.#status.answeredByCode + 1 };
  }

  view(): ModelStatus {
    return this.#status;
  }
}
