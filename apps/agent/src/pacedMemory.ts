import type { MemoryPort, MemoryRead, MemoryWrite } from "@countersign/core";
import type { MemWalMemory } from "@countersign/adapters/memwal";

export class PacedMemory implements MemoryPort {
  readonly #inner: MemWalMemory;
  readonly #gapMs: number;
  #nextAt = 0;
  #calls = 0;
  #unconfirmed = 0;

  constructor(inner: MemWalMemory, gapMs: number) {
    this.#inner = inner;
    this.#gapMs = gapMs;
  }

  async #slot(): Promise<void> {
    const wait = this.#nextAt - Date.now();
    this.#nextAt = Math.max(Date.now(), this.#nextAt) + this.#gapMs;
    this.#calls += 1;
    if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
  }

  async remember(namespace: string, text: string, idempotencyKey: string): Promise<MemoryWrite> {
    await this.#slot();
    const written = await this.#inner.remember(namespace, text, idempotencyKey);
    if (written.status !== "WRITTEN") this.#unconfirmed += 1;
    return written;
  }

  async readAll(namespace: string): Promise<MemoryRead> {
    await this.#slot();
    const read = await this.#inner.readAll(namespace);
    if (!read.complete) this.#unconfirmed += 1;
    return read;
  }

  async listNamespaces(prefix: string): Promise<readonly string[] | null> {
    await this.#slot();
    const names = await this.#inner.listNamespaces(prefix);
    if (!names) this.#unconfirmed += 1;
    return names;
  }

  counts(): { readonly calls: number; readonly unconfirmedOrIncomplete: number } {
    return { calls: this.#calls, unconfirmedOrIncomplete: this.#unconfirmed };
  }
}
