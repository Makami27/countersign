import type { SqlRows } from "@countersign/adapters/sql";
import type { MemWalMemory } from "@countersign/adapters/memwal";
import type { TatumGraphql } from "@countersign/adapters/tatum";
import type { MemoryView } from "@countersign/web/ownerContext";
import type { StatusCheck, StatusView } from "@countersign/web/status";

const CHECK_DEADLINE_MS = 8_000;
const STATUS_CACHE_MS = 30_000;

export type StatusDeps = {
  readonly network: "mainnet" | "testnet";
  readonly version: string | null;
  readonly database: { readonly label: string; readonly rows: SqlRows };
  readonly graphql: TatumGraphql;
  readonly grpcBalance: () => Promise<{ readonly status: "KNOWN" } | { readonly status: "UNKNOWN"; readonly detail: string }>;
  readonly walrus: MemWalMemory | null;
  readonly ownerPrefix: string;
  readonly memory: () => MemoryView;
  readonly telegramPolling: () => boolean;
};

async function check(name: string, work: () => Promise<string | null>): Promise<StatusCheck> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(`no answer within ${CHECK_DEADLINE_MS / 1000} s`), CHECK_DEADLINE_MS);
  });
  const problem = await Promise.race([work().catch((error: Error) => error.message.slice(0, 160)), late]);
  clearTimeout(timer);
  const ms = Date.now() - started;
  if (problem) console.error(`status: ${name} failed after ${ms} ms (${problem})`);
  return { name, ok: problem === null, ms, detail: problem };
}

export function statusProbe(deps: StatusDeps): () => Promise<StatusView> {
  let cache: { at: number; view: StatusView } | null = null;
  return async () => {
    if (cache && Date.now() - cache.at < STATUS_CACHE_MS) return cache.view;
    const checks = await Promise.all([
      check(`Database (${deps.database.label})`, async () => ((await deps.database.rows.get("SELECT 1 AS ok")) ? null : "no row returned")),
      check("Tatum gRPC", async () => {
        const read = await deps.grpcBalance();
        return read.status === "KNOWN" ? null : read.detail;
      }),
      check("Tatum GraphQL", async () => {
        const result = await deps.graphql.query<{ chainIdentifier: string }>("query { chainIdentifier }");
        return result.ok ? null : `${result.kind}: ${result.detail}`;
      }),
      check("Walrus Memory relayer", async () => {
        if (!deps.walrus) return "sandbox memory: not connected to Walrus Memory";
        return (await deps.walrus.namespaceCounts(deps.ownerPrefix)) ? null : "the relayer didn't list namespaces";
      }),
      check("Telegram polling", async () => (deps.telegramPolling() ? null : "the bot isn't polling right now")),
    ]);
    const memory = deps.memory();
    const view: StatusView = { checkedAt: new Date().toISOString(), network: deps.network, version: deps.version, restore: { relayer: memory.relayer, complete: memory.restored, at: memory.restoredAt }, checks };
    cache = { at: Date.now(), view };
    return view;
  };
}
