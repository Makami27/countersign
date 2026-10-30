import { randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Countersign, isRealUseNamespace, type EngineDeps, type PaymentIntent, type SuiAddress } from "@countersign/core";
import { SqliteIndex, SqlitePaymentLedger } from "@countersign/adapters/sqlite";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { PaymentRunner } from "@countersign/adapters/payments";
import { SqliteRateGate, TATUM_FREE_TIER_INTERVAL_MS, TATUM_GRAPHQL_URL, TatumGraphql, TatumRoundTripChecker, TatumSignatureVerifier, USDC_COIN_TYPE, readAgentBalances, tatumGrpcClient, tatumPaymentChain, tatumRateGateName } from "@countersign/adapters/tatum";
import { extractProposal } from "@countersign/adapters/gemini";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { startWebServer } from "@countersign/web/server";
import { OwnerAuth } from "@countersign/web/ownerAuth";
import { OwnerSettings } from "@countersign/web/ownerSettings";
import type { BalancesView, MemoryView, OwnerContext } from "@countersign/web/ownerContext";
import { loadConfig } from "./config.ts";
import { startBot } from "./telegram.ts";

const RECONCILE_EVERY_MS = 60_000;
const BALANCE_CACHE_MS = 30_000;

const config = loadConfig(process.env);
const gate = new SqliteRateGate(config.databasePath, tatumRateGateName(config.network), TATUM_FREE_TIER_INTERVAL_MS);
const grpc = tatumGrpcClient(config.network, config.tatumApiKey, gate);
const graphql = new TatumGraphql(TATUM_GRAPHQL_URL[config.network], config.tatumApiKey, gate);
const wallet = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(config.agentWalletKey).secretKey);
const agentAddress = wallet.toSuiAddress() as SuiAddress;
const memory = new MemWalMemory(config.memwal);
const index = new SqliteIndex(config.databasePath);
const ledger = new SqlitePaymentLedger(config.databasePath);
const settings = new OwnerSettings(config.databasePath, { perPaymentBaseUnits: config.caps.perPaymentBaseUnits, perDayBaseUnits: config.caps.perDayBaseUnits, cooldownSeconds: config.cooldownMs / 1000 });
const auth = new OwnerAuth(config.databasePath);
const clock = { now: () => new Date() };

const deps: EngineDeps = {
  ownerId: config.ownerId, network: config.network, memory, index, payments: ledger, clock,
  signer: recordSignerFromSeed(config.recordSigningKey),
  signatures: new TatumSignatureVerifier(grpc),
  roundTrips: new TatumRoundTripChecker(graphql, agentAddress, USDC_COIN_TYPE[config.network]),
  nonces: { next: () => randomBytes(16).toString("hex") },
  caps: settings.caps(),
  get cooldownMs() {
    return settings.values().cooldownSeconds * 1000;
  },
};
const engine = new Countersign(deps);
const runner = new PaymentRunner({ ledger, chain: tatumPaymentChain(grpc, wallet, config.network), clock });

const restored = await engine.restore();
const memoryView: MemoryView = { relayer: memory.environment, restored: restored.ok, restoredAt: restored.ok ? clock.now().toISOString() : null, legacyRecords: restored.ok ? restored.legacy : 0, ignoredRecords: restored.ok ? restored.ignored : 0 };
console.log(restored.ok ? `Walrus Memory (${memory.environment}) restored: ${restored.payees} payee namespaces, ${restored.legacy} legacy and ${restored.ignored} ignored records.` : "Walrus Memory could not be read completely. Payments stay blocked until it can.");

async function recordFinished(payments: readonly PaymentIntent[]): Promise<void> {
  for (const payment of payments) await engine.recordPaymentOutcome(payment);
}

await recordFinished(await runner.recoverInterrupted());
setInterval(() => void runner.reconcileOpen().then(recordFinished), RECONCILE_EVERY_MS).unref();

let balanceCache: { at: number; view: BalancesView } | null = null;
async function balances(): Promise<BalancesView> {
  if (balanceCache && Date.now() - balanceCache.at < BALANCE_CACHE_MS) return balanceCache.view;
  const read = await readAgentBalances(grpc, config.network, agentAddress);
  const view: BalancesView = read.status === "KNOWN" ? { status: "KNOWN", suiBaseUnits: read.sui.totalBaseUnits, usdcBaseUnits: read.usdc.totalBaseUnits } : { status: "UNKNOWN", detail: read.detail };
  balanceCache = { at: Date.now(), view };
  return view;
}

const owner: OwnerContext = {
  ownerId: config.ownerId, network: config.network, agentAddress, publicUrl: config.publicUrl, engine, index, ledger, auth, settings, balances,
  memory: () => memoryView,
  memoryCounts: async () => {
    const counts = await memory.namespaceCounts(`countersign:${config.ownerId}:`);
    if (!counts) return null;
    const real = counts.filter((c) => isRealUseNamespace(config.ownerId, c.name));
    return { realUseMemories: real.reduce((sum, c) => sum + c.count, 0), namespaces: real.length };
  },
  sendPayment: async (paymentId) => {
    const payment = await runner.send(paymentId);
    await recordFinished([payment].filter((p) => p.state === "SETTLED" || p.state === "FAILED"));
    return payment;
  },
};

startWebServer({ port: config.port, network: config.network, proofDatabasePath: config.databasePath, version: process.env["GIT_SHA"] ?? null, owner });
startBot({
  token: config.telegram.token, ownerUserId: config.telegram.ownerUserId, network: config.network, publicUrl: config.publicUrl, engine, index, auth,
  extract: (text, payeeIds) => extractProposal(config.gemini, text, payeeIds),
  sendPayment: (paymentId) => runner.send(paymentId),
});
