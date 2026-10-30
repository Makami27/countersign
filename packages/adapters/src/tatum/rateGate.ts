import { DatabaseSync } from "node:sqlite";
import { UnaryCall, type RpcInterceptor } from "@protobuf-ts/runtime-rpc";

export interface RateGate {
  acquire(): Promise<void>;
}

export const TATUM_FREE_TIER_INTERVAL_MS = 500;
const BUSY_TIMEOUT_MS = 5_000;
const SCHEMA = "CREATE TABLE IF NOT EXISTS rate_slots (name TEXT PRIMARY KEY, next_at INTEGER NOT NULL CHECK (next_at >= 0))";

export class SqliteRateGate implements RateGate {
  readonly #db: DatabaseSync;
  readonly #name: string;
  readonly #intervalMs: number;

  constructor(databasePath: string, name: string, intervalMs: number) {
    this.#db = new DatabaseSync(databasePath);
    this.#db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
    this.#db.exec(SCHEMA);
    this.#name = name;
    this.#intervalMs = intervalMs;
  }

  async acquire(): Promise<void> {
    const waitMs = this.#reserveSlot(Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  close(): void {
    this.#db.close();
  }

  #reserveSlot(now: number): number {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#db.prepare("SELECT next_at FROM rate_slots WHERE name = ?").get(this.#name);
      const slot = Math.max(now, row ? Number(row["next_at"]) : 0);
      this.#db.prepare("INSERT INTO rate_slots (name, next_at) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET next_at = excluded.next_at").run(this.#name, slot + this.#intervalMs);
      this.#db.exec("COMMIT");
      return slot - now;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
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
