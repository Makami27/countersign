import { UnaryCall, type RpcInterceptor } from "@protobuf-ts/runtime-rpc";
import type { SqlRows } from "../sql/rows.ts";
import { SqliteRows } from "../sqlite/rows.ts";

export interface RateGate {
  acquire(): Promise<void>;
}

export const TATUM_FREE_TIER_INTERVAL_MS = 500;
const SCHEMA = "CREATE TABLE IF NOT EXISTS rate_slots (name TEXT PRIMARY KEY, next_at BIGINT NOT NULL CHECK (next_at >= 0))";

export class SharedRateGate implements RateGate {
  readonly #rows: SqlRows;
  readonly #name: string;
  readonly #intervalMs: number;
  readonly #ready: Promise<void>;

  constructor(rows: SqlRows, name: string, intervalMs: number) {
    this.#rows = rows;
    this.#name = name;
    this.#intervalMs = intervalMs;
    this.#ready = rows.exec(SCHEMA);
    this.#ready.catch(() => undefined);
  }

  async acquire(): Promise<void> {
    await this.#ready;
    const now = Date.now();
    const larger = this.#rows.dialect === "postgres" ? "GREATEST" : "max";
    const row = await this.#rows.get(`INSERT INTO rate_slots (name, next_at) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET next_at = ${larger}(rate_slots.next_at, excluded.next_at - ?) + ? RETURNING next_at`, [this.#name, now + this.#intervalMs, this.#intervalMs, this.#intervalMs]);
    const waitMs = Number(row?.["next_at"] ?? now) - this.#intervalMs - now;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

export class SqliteRateGate extends SharedRateGate {
  readonly #rows: SqliteRows;

  constructor(databasePath: string, name: string, intervalMs: number) {
    const rows = new SqliteRows(databasePath);
    super(rows, name, intervalMs);
    this.#rows = rows;
  }

  close(): void {
    this.#rows.close();
  }
}

export function rateGateInterceptor(gate: RateGate): RpcInterceptor {
  return {
    interceptUnary(next, method, input, options) {
      const call = gate.acquire().then(() => next(method, input, options));
      return new UnaryCall(method, options.meta ?? {}, input, call.then((c) => c.headers), call.then((c) => c.response), call.then((c) => c.status), call.then((c) => c.trailers));
    },
  };
}
