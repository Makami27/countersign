import type { SqlRows } from "@countersign/adapters/sql";
import type { MemWalMemory } from "@countersign/adapters/memwal";
import type { TatumGraphql } from "@countersign/adapters/tatum";
import type { MemoryView } from "@countersign/web/ownerContext";
import type { ModelStatus, StatusCheck, StatusView } from "@countersign/web/status";

const CHECK_DEADLINE_MS = 8_000;
export const STATUS_CACHE_MS = 5 * 60_000;
export const DATABASE_CHECK_CACHE_MS = 15 * 60_000;

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
  readonly model: () => ModelStatus | null;
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
  let database: { at: number; check: StatusCheck } | null = null;
  const databaseCheck = async (): Promise<StatusCheck> => {
    if (database && Date.now() - database.at < DATABASE_CHECK_CACHE_MS) return database.check;
    const fresh = await check(`Database (${deps.database.label})`, async () => ((await deps.database.rows.get("SELECT 1 AS ok")) ? null : "no row returned"));
    database = { at: Date.now(), check: fresh };
    return fresh;
  };
  return async () => {
    if (cache && Date.now() - cache.at < STATUS_CACHE_MS) return { ...cache.view, model: deps.model() };
    const checks = await Promise.all([
      databaseCheck(),
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
    const view: StatusView = { checkedAt: new Date().toISOString(), network: deps.network, version: deps.version, restore: { relayer: memory.relayer, complete: memory.restored, at: memory.restoredAt }, checks, model: deps.model() };
    cache = { at: Date.now(), view };
    return view;
  };
}
