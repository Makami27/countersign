import { within } from "./deadline.ts";
import type { OwnerContext } from "./ownerContext.ts";

const FULL_READ_KEEPS_MS = 5 * 60 * 1000;
const PARTIAL_READ_KEEPS_MS = 20 * 1000;
const LAST_KNOWN_KEEPS_MS = 60 * 60 * 1000;
const DEADLINE_MS = 8_000;

export type LiveCounts = { readonly memories: number | null; readonly sharedAgents: number | null; readonly sharedReports: number | null };
export type LiveSource = Pick<OwnerContext, "memoryCounts" | "shared">;
export type LiveOptions = { readonly now?: () => number; readonly deadlineMs?: number };

const UNKNOWN: LiveCounts = { memories: null, sharedAgents: null, sharedReports: null };

async function attempt<T>(deadlineMs: number, what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await within(deadlineMs, what, read());
  } catch {
    return null;
  }
}

export class LiveCounter {
  readonly #source: () => LiveSource | null;
  readonly #now: () => number;
  readonly #deadlineMs: number;
  #latest: { readonly at: number; readonly value: LiveCounts; readonly full: boolean } | null = null;
  readonly #seen = new Map<keyof LiveCounts, { readonly at: number; readonly count: number }>();
  #reading: Promise<LiveCounts> | null = null;

  constructor(source: () => LiveSource | null, options: LiveOptions = {}) {
    this.#source = source;
    this.#now = options.now ?? Date.now;
    this.#deadlineMs = options.deadlineMs ?? DEADLINE_MS;
  }

  #lastKnown(field: keyof LiveCounts): number | null {
    const seen = this.#seen.get(field);
    return seen && this.#now() - seen.at < LAST_KNOWN_KEEPS_MS ? seen.count : null;
  }

  known(): LiveCounts {
    return { memories: this.#lastKnown("memories"), sharedAgents: this.#lastKnown("sharedAgents"), sharedReports: this.#lastKnown("sharedReports") };
  }

  current(): Promise<LiveCounts> {
    const latest = this.#latest;
    if (latest && this.#now() - latest.at < (latest.full ? FULL_READ_KEEPS_MS : PARTIAL_READ_KEEPS_MS)) return Promise.resolve(latest.value);
    this.#reading ??= this.#read().finally(() => {
      this.#reading = null;
    });
    return this.#reading;
  }

  async #read(): Promise<LiveCounts> {
    const source = this.#source();
    if (!source) return UNKNOWN;
    const counts = await attempt(this.#deadlineMs, "Walrus Memory (memory count)", () => source.memoryCounts());
    let shared = source.shared.summary();
    if (!shared) {
      await attempt(this.#deadlineMs, "Walrus Memory (shared reports)", () => source.shared.refresh());
      shared = source.shared.summary();
    }
    const read = { memories: counts?.realUseMemories ?? null, sharedAgents: shared?.agents ?? null, sharedReports: shared?.reports ?? null };
    const at = this.#now();
    for (const field of ["memories", "sharedAgents", "sharedReports"] as const) {
      const count = read[field];
      if (count !== null) this.#seen.set(field, { at, count });
    }
    const value = this.known();
    this.#latest = { at, value, full: read.memories !== null && read.sharedReports !== null };
    return value;
  }
}
