import { MemWal, MemWalRateLimitedError, MemWalRememberJobTimeoutError } from "@mysten-incubation/memwal";
import type { MemoryPort, MemoryRead, MemoryWrite } from "@countersign/core";

export const RECALL_CEILING = 100;
const RECALL_QUERY = "countersign signed record";
const WRITE_TIMEOUT_MS = 90_000;

export type MemWalConfig = { readonly key: string; readonly accountId: string; readonly serverUrl: string };

export class MemWalMemory implements MemoryPort {
  readonly #client: ReturnType<typeof MemWal.create>;

  constructor(config: MemWalConfig) {
    this.#client = MemWal.create({ key: config.key, accountId: config.accountId, serverUrl: config.serverUrl, namespace: "countersign" });
  }

  async remember(namespace: string, text: string, idempotencyKey: string): Promise<MemoryWrite> {
    try {
      const written = await this.#client.rememberAndWait(text, namespace, { idempotencyKey, timeoutMs: WRITE_TIMEOUT_MS });
      return { status: "WRITTEN", blobId: written.blob_id };
    } catch (error) {
      if (error instanceof MemWalRememberJobTimeoutError || error instanceof MemWalRateLimitedError) return { status: "UNKNOWN" };
      throw error;
    }
  }

  async readAll(namespace: string): Promise<MemoryRead> {
    const expected = await this.#countIn(namespace);
    if (expected === null) return { complete: false, why: "UNREACHABLE" };
    if (expected === 0) return { complete: true, texts: [] };
    if (expected > RECALL_CEILING) return { complete: false, why: "COUNT_MISMATCH" };
    const recalled = await this.#client.recall({ query: RECALL_QUERY, topK: RECALL_CEILING, namespace });
    if ((recalled.dropped_count ?? 0) > 0) return { complete: false, why: "DROPPED" };
    if (recalled.results.length !== expected) return { complete: false, why: "COUNT_MISMATCH" };
    return { complete: true, texts: recalled.results.map((r) => r.text) };
  }

  async listNamespaces(prefix: string): Promise<readonly string[] | null> {
    const names: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const result = await this.#client.listNamespaces(cursor ? { cursor } : {});
      names.push(...result.namespaces.map((n) => n.name).filter((name) => name.startsWith(prefix)));
      if (!result.has_more || !result.next_cursor) return names;
      cursor = result.next_cursor;
    }
    return null;
  }

  async #countIn(namespace: string): Promise<number | null> {
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const result = await this.#client.listNamespaces(cursor ? { cursor } : {});
      const hit = result.namespaces.find((n) => n.name === namespace);
      if (hit) return hit.memory_count;
      if (!result.has_more || !result.next_cursor) return 0;
      cursor = result.next_cursor;
    }
    return null;
  }
}
