import { MemWal, MemWalRateLimitedError, MemWalRememberJobFailedError, MemWalRememberJobTimeoutError } from "@mysten-incubation/memwal";
import type { MemoryPort, MemoryRead, MemoryWrite } from "@countersign/core";

export const RECALL_CEILING = 100;
const RECALL_QUERY = "countersign signed record";
const WRITE_TIMEOUT_MS = 90_000;
const MAX_LIST_PAGES = 50;

export const MAINNET_RELAYER_URL = "https://relayer.memory.walrus.xyz";
export const DEV_RELAYER_URL = "https://relayer.dev.memwal.ai";

export type RelayerEnvironment = "mainnet relayer" | "dev relayer";

export type MemWalConfig = { readonly key: string; readonly accountId: string; readonly serverUrl: string };

export type Recalled = { readonly texts: readonly string[]; readonly blobIds: readonly string[]; readonly droppedCount: number };

export type WriteProblem = "TIMEOUT" | "RATE_LIMITED" | "JOB_FAILED" | "REQUEST_FAILED";

export function relayerEnvironment(serverUrl: string): RelayerEnvironment | null {
  const normalized = serverUrl.replace(/\/+$/, "");
  if (normalized === MAINNET_RELAYER_URL) return "mainnet relayer";
  if (normalized === DEV_RELAYER_URL) return "dev relayer";
  return null;
}

export function writeProblemOf(error: unknown): WriteProblem {
  if (error instanceof MemWalRememberJobTimeoutError) return "TIMEOUT";
  if (error instanceof MemWalRateLimitedError) return "RATE_LIMITED";
  if (error instanceof MemWalRememberJobFailedError) return "JOB_FAILED";
  return "REQUEST_FAILED";
}

export class MemWalMemory implements MemoryPort {
  readonly #client: ReturnType<typeof MemWal.create>;
  readonly environment: RelayerEnvironment;
  lastWriteProblem: WriteProblem | null = null;

  constructor(config: MemWalConfig) {
    const environment = relayerEnvironment(config.serverUrl);
    if (!environment) throw new Error(`Unknown Walrus Memory relayer ${config.serverUrl}. Use ${MAINNET_RELAYER_URL} or ${DEV_RELAYER_URL}. Nothing was started.`);
    this.environment = environment;
    this.#client = MemWal.create({ key: config.key, accountId: config.accountId, serverUrl: config.serverUrl, namespace: "countersign" });
  }

  async remember(namespace: string, text: string, idempotencyKey: string): Promise<MemoryWrite> {
    try {
      const written = await this.#client.rememberAndWait(text, namespace, { idempotencyKey, timeoutMs: WRITE_TIMEOUT_MS });
      this.lastWriteProblem = null;
      return { status: "WRITTEN", blobId: written.blob_id };
    } catch (error) {
      this.lastWriteProblem = writeProblemOf(error);
      return { status: "UNKNOWN" };
    }
  }

  async readAll(namespace: string): Promise<MemoryRead> {
    const expected = await this.countIn(namespace);
    if (expected === null) return { complete: false, why: "UNREACHABLE" };
    if (expected === 0) return { complete: true, records: [] };
    if (expected > RECALL_CEILING) return { complete: false, why: "COUNT_MISMATCH" };
    let recalled: Recalled;
    try {
      recalled = await this.recallEverything(namespace);
    } catch {
      return { complete: false, why: "UNREACHABLE" };
    }
    if (recalled.droppedCount > 0) return { complete: false, why: "DROPPED" };
    const distinctBlobs = new Set(recalled.blobIds).size;
    if (recalled.texts.length !== expected || distinctBlobs !== expected) return { complete: false, why: "COUNT_MISMATCH" };
    return { complete: true, records: recalled.texts.map((text, i) => ({ text, blobId: recalled.blobIds[i] ?? "" })) };
  }

  async listNamespaces(prefix: string): Promise<readonly string[] | null> {
    const names: string[] = [];
    let cursor: string | undefined;
    try {
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const result = await this.#client.listNamespaces(cursor ? { cursor } : {});
        names.push(...result.namespaces.map((n) => n.name).filter((name) => name.startsWith(prefix)));
        if (!result.has_more || !result.next_cursor) return names;
        cursor = result.next_cursor;
      }
    } catch {
      return null;
    }
    return null;
  }

  async namespaceCounts(prefix: string): Promise<readonly { readonly name: string; readonly count: number }[] | null> {
    const found: { name: string; count: number }[] = [];
    let cursor: string | undefined;
    try {
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const result = await this.#client.listNamespaces(cursor ? { cursor } : {});
        found.push(...result.namespaces.filter((n) => n.name.startsWith(prefix)).map((n) => ({ name: n.name, count: n.memory_count })));
        if (!result.has_more || !result.next_cursor) return found;
        cursor = result.next_cursor;
      }
    } catch {
      return null;
    }
    return null;
  }

  async countIn(namespace: string): Promise<number | null> {
    let cursor: string | undefined;
    try {
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const result = await this.#client.listNamespaces(cursor ? { cursor } : {});
        const hit = result.namespaces.find((n) => n.name === namespace);
        if (hit) return hit.memory_count;
        if (!result.has_more || !result.next_cursor) return 0;
        cursor = result.next_cursor;
      }
    } catch {
      return null;
    }
    return null;
  }

  async listedBlobIds(namespace: string): Promise<readonly string[] | null> {
    const blobIds: string[] = [];
    let cursor: string | undefined;
    try {
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const result = await this.#client.listMemories(cursor ? { cursor, namespace } : { namespace });
        blobIds.push(...result.memories.map((m) => m.blob_id));
        if (!result.has_more || !result.next_cursor) return blobIds;
        cursor = result.next_cursor;
      }
    } catch {
      return null;
    }
    return null;
  }

  async recallEverything(namespace: string): Promise<Recalled> {
    const recalled = await this.#client.recall({ query: RECALL_QUERY, topK: RECALL_CEILING, namespace });
    return { texts: recalled.results.map((r) => r.text), blobIds: recalled.results.map((r) => r.blob_id), droppedCount: recalled.dropped_count ?? 0 };
  }
}
