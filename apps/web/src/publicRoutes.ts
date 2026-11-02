import type { ServerResponse } from "node:http";
import type { SqlRows } from "@countersign/adapters/sql";
import { SECURITY_HEADERS } from "./http.ts";
import { readClaims } from "./claims.ts";
import { within } from "./deadline.ts";
import { readProof } from "./proof.ts";
import { proofPageHtml, readMeasurement } from "./proofPage.ts";
import { statusPageHtml } from "./statusPage.ts";
import type { OwnerContext } from "./ownerContext.ts";
import type { StatusView } from "./status.ts";

const MEMORY_DEADLINE_MS = 8_000;
const LIVE_CACHE_MS = 5 * 60 * 1000;

export type LiveCounts = { readonly memories: number | null; readonly sharedAgents: number | null; readonly sharedReports: number | null };
let liveCache: { readonly at: number; readonly value: LiveCounts } | null = null;

export async function liveCounts(owner: OwnerContext | null, now = Date.now()): Promise<LiveCounts> {
  if (liveCache && now - liveCache.at < LIVE_CACHE_MS) return liveCache.value;
  const memory = await memoryCounts(owner);
  const shared = owner?.shared.summary() ?? null;
  const value = { memories: memory.counts?.realUseMemories ?? null, sharedAgents: shared?.agents ?? null, sharedReports: shared?.reports ?? null };
  if (owner) liveCache = { at: now, value };
  return value;
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...SECURITY_HEADERS });
  res.end(body);
}

async function memoryCounts(owner: OwnerContext | null) {
  if (!owner) return { counts: null, why: "This server isn't connected to the live agent." };
  try {
    const counts = await within(MEMORY_DEADLINE_MS, "Walrus Memory (memory count)", owner.memoryCounts());
    return { counts, why: counts ? null : "Walrus Memory didn't list the namespaces." };
  } catch (error) {
    return { counts: null, why: error instanceof Error ? error.message : "Walrus Memory didn't answer." };
  }
}

export async function proofPageRoute(res: ServerResponse, rows: SqlRows | undefined, network: "mainnet" | "testnet", owner: OwnerContext | null): Promise<void> {
  const [proof, memory, claims, measurement] = await Promise.all([readProof(rows, network), memoryCounts(owner), readClaims(), readMeasurement()]);
  html(res, proofPageHtml({ proof, memory, claims, measurement }));
}

export async function statusPageRoute(res: ServerResponse, status: (() => Promise<StatusView>) | undefined): Promise<void> {
  html(res, statusPageHtml(status ? await status() : null));
}
