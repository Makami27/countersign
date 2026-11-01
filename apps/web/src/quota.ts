export type QuotaKind = "walrus" | "tatum" | "model";
export type QuotaLimits = Readonly<Record<QuotaKind, number>>;

export const DEFAULT_HOURLY_LIMITS: QuotaLimits = { walrus: 60, tatum: 200, model: 60 };
export const BUSY = "Busy: your agent used its hourly allowance for Walrus Memory, Tatum or the model. Nothing was changed. Try again in a few minutes.";
const WINDOW_MS = 60 * 60 * 1000;

export class QuotaMeter {
  readonly #limits: QuotaLimits | null;
  readonly #now: () => number;
  readonly #uses: Record<QuotaKind, number[]> = { walrus: [], tatum: [], model: [] };

  constructor(limits: QuotaLimits | null, now: () => number = Date.now) {
    this.#limits = limits;
    this.#now = now;
  }

  record(kind: QuotaKind): void {
    this.#uses[kind].push(this.#now());
  }

  used(kind: QuotaKind): number {
    const since = this.#now() - WINDOW_MS;
    this.#uses[kind] = this.#uses[kind].filter((at) => at > since);
    return this.#uses[kind].length;
  }

  busy(): boolean {
    const limits = this.#limits;
    return limits !== null && (["walrus", "tatum", "model"] as const).some((kind) => this.used(kind) >= limits[kind]);
  }

  view(): { readonly limits: QuotaLimits | null; readonly lastHour: QuotaLimits } {
    return { limits: this.#limits, lastHour: { walrus: this.used("walrus"), tatum: this.used("tatum"), model: this.used("model") } };
  }
}
