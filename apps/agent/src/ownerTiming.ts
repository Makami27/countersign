import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import type { SuiAddress } from "@countersign/core";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { SqliteRows } from "@countersign/adapters/sqlite";
import { SharedRateGate, TATUM_FREE_TIER_INTERVAL_MS, readAgentBalances, tatumGrpcClient, tatumRateGateName } from "@countersign/adapters/tatum";
import { PostgresIndex, PostgresRows, openPostgres } from "@countersign/adapters/postgres";

const env = process.env;
const network = env["NETWORK"] === "mainnet" ? "mainnet" : "testnet";
async function timed(label: string, work: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  const outcome = await Promise.race([work().then((v) => `ok ${String(JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x))).slice(0, 90)}`, (e: Error) => `error ${e.message.slice(0, 90)}`), new Promise<string>((r) => setTimeout(() => r("still waiting after 40 s"), 40_000))]);
  console.log(`${label}: ${Date.now() - started} ms, ${outcome}`);
}
const pool = openPostgres({ url: env["DATABASE_URL"] ?? "" });
const pgGate = new SharedRateGate(new PostgresRows(pool), tatumRateGateName(network), TATUM_FREE_TIER_INTERVAL_MS);
const localGate = new SharedRateGate(new SqliteRows(":memory:"), "local", TATUM_FREE_TIER_INTERVAL_MS);
const agent = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(env["AGENT_WALLET_PRIVATE_KEY"] ?? "").secretKey).toSuiAddress() as SuiAddress;
await timed("postgres index payeeIds", async () => (await PostgresIndex.open(pool)).payeeIds());
await timed("postgres rate gate acquire", () => pgGate.acquire());
await timed("tatum balances (local gate)", () => readAgentBalances(tatumGrpcClient(network, env["TATUM_API_KEY"] ?? "", localGate), network, agent));
await timed("tatum balances (postgres gate)", () => readAgentBalances(tatumGrpcClient(network, env["TATUM_API_KEY"] ?? "", pgGate), network, agent));
await timed("walrus namespace counts", () => new MemWalMemory({ key: env["MEMWAL_PRIVATE_KEY"] ?? "", accountId: env["MEMWAL_ACCOUNT_ID"] ?? "", serverUrl: env["MEMWAL_RELAYER_URL"] ?? "" }).namespaceCounts(`countersign:${env["OWNER_ID"] ?? ""}:`).then((c) => c?.length ?? null));
await pool.end();
process.exit(0);
