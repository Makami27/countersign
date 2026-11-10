import type { ServerResponse } from "node:http";
import type { SqlRows } from "@countersign/adapters/sql";
import { SECURITY_HEADERS } from "./http.ts";
import { readClaims } from "./claims.ts";
import { within } from "./deadline.ts";
import { readProof } from "./proof.ts";
import { proofPageHtml, readMeasurement } from "./proofPage.ts";
import { statusPageHtml } from "./statusPage.ts";
import { inChosenTheme } from "./publicPage.ts";
import type { OwnerContext } from "./ownerContext.ts";
import type { StatusView } from "./status.ts";

const MEMORY_DEADLINE_MS = 8_000;

function html(res: ServerResponse, body: string, dark: boolean): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", vary: "cookie", ...SECURITY_HEADERS });
  res.end(inChosenTheme(body, dark));
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

export async function proofPageRoute(res: ServerResponse, rows: SqlRows | undefined, network: "mainnet" | "testnet", owner: OwnerContext | null, dark: boolean): Promise<void> {
  const [proof, memory, claims, measurement] = await Promise.all([readProof(rows, network), memoryCounts(owner), readClaims(), readMeasurement()]);
  html(res, proofPageHtml({ proof, memory, claims, measurement }), dark);
}

export async function statusPageRoute(res: ServerResponse, status: (() => Promise<StatusView>) | undefined, dark: boolean): Promise<void> {
  html(res, statusPageHtml(status ? await status() : null), dark);
}
