import { randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Countersign, InMemoryMemory, isRealUseNamespace, type EngineDeps, type PaymentIntent, type SuiAddress } from "@countersign/core";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { PaymentRunner } from "@countersign/adapters/payments";
import { SharedRateGate, TATUM_FREE_TIER_INTERVAL_MS, TATUM_GRAPHQL_URL, TatumGraphql, TatumRoundTripChecker, TatumSignatureVerifier, USDC_COIN_TYPE, readAgentBalances, tatumGrpcClient, tatumPaymentChain, tatumRateGateName } from "@countersign/adapters/tatum";
import { extractProposal } from "@countersign/adapters/gemini";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { startWebServer } from "@countersign/web/server";
import { OwnerAuth } from "@countersign/web/ownerAuth";
import { OwnerSettings } from "@countersign/web/ownerSettings";
import { ChangeSteps } from "@countersign/web/changeSteps";
import { completeReadyChanges } from "@countersign/web/changeCompletion";
import type { BalancesView, MemoryView, OwnerContext } from "@countersign/web/ownerContext";
import { loadConfig } from "./config.ts";
import { startBot } from "./telegram.ts";
import { openStorage } from "./storage.ts";
import { statusProbe } from "./statusChecks.ts";
import { ModelStats } from "./modelStats.ts";

const RECONCILE_EVERY_MS = 60_000;
const BALANCE_CACHE_MS = 30_000;
const COUNTS_CACHE_MS = 60_000;

const config = loadConfig(process.env);
const storage = await openStorage(config.database);
const gate = new SharedRateGate(storage.rows, tatumRateGateName(config.network), TATUM_FREE_TIER_INTERVAL_MS);
const grpc = tatumGrpcClient(config.network, config.tatumApiKey, gate);
const graphql = new TatumGraphql(TATUM_GRAPHQL_URL[config.network], config.tatumApiKey, gate);
const wallet = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(config.agentWalletKey).secretKey);
const agentAddress = wallet.toSuiAddress() as SuiAddress;
const walrus = config.memoryBackend === "walrus" ? new MemWalMemory(config.memwal) : null;
const memory = walrus ?? new InMemoryMemory();
const relayerLabel = walrus ? walrus.environment : "sandbox (not Walrus Memory)";
const { index, ledger } = storage;
const settings = await OwnerSettings.open(storage.rows, { perPaymentBaseUnits: config.caps.perPaymentBaseUnits, perDayBaseUnits: config.caps.perDayBaseUnits, cooldownSeconds: config.cooldownMs / 1000 });
const auth = await OwnerAuth.open(storage.rows);
const clock = { now: () => new Date() };
const verifier = new TatumSignatureVerifier(grpc);
const steps = await ChangeSteps.open(storage.rows);

const deps: EngineDeps = {
  ownerId: config.ownerId, network: config.network, memory, index, payments: ledger, clock,
  signer: recordSignerFromSeed(config.recordSigningKey),
  signatures: verifier,
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
const memoryView: MemoryView = { relayer: relayerLabel, restored: restored.ok, restoredAt: restored.ok ? clock.now().toISOString() : null, legacyRecords: restored.ok ? restored.legacy : 0, ignoredRecords: restored.ok ? restored.ignored : 0 };
console.log(`Index and payment ledger: ${storage.label}.`);
console.log(restored.ok ? `Memory (${relayerLabel}) restored: ${restored.payees} payee namespaces, ${restored.legacy} legacy and ${restored.ignored} ignored records.` : "Walrus Memory could not be read completely. Payments stay blocked until it can.");

async function recordFinished(payments: readonly PaymentIntent[]): Promise<void> {
  for (const payment of payments) await engine.recordPaymentOutcome(payment);
}

await recordFinished(await runner.recoverInterrupted());
let paymentsOpen = true;
async function reconcileIfOpen(): Promise<void> {
  if (!paymentsOpen) return;
  await recordFinished(await runner.reconcileOpen());
  paymentsOpen = (await ledger.unresolvedPayments()).length > 0;
}
async function send(paymentId: string): Promise<PaymentIntent> {
  paymentsOpen = true;
  return runner.send(paymentId);
}
await reconcileIfOpen();
console.log(paymentsOpen ? "Boot reconciliation: some payments are still open; they are checked every minute." : "Boot reconciliation: no open payments.");
setInterval(() => void reconcileIfOpen().catch((error: Error) => console.error(`Reconciliation skipped: ${error.message.slice(0, 200)}`)), RECONCILE_EVERY_MS).unref();

let balanceCache: { at: number; view: BalancesView } | null = null;
let countsCache: { at: number; view: { realUseMemories: number; namespaces: number } } | null = null;
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
  steps,
  cooldownMs: () => settings.values().cooldownSeconds * 1000,
  verifySignature: (message, signature, address) => verifier.verifyPersonalMessage(message, signature, address),
  memoryCounts: async () => {
    if (!walrus) return null;
    if (countsCache && Date.now() - countsCache.at < COUNTS_CACHE_MS) return countsCache.view;
    const counts = await walrus.namespaceCounts(`countersign:${config.ownerId}:`);
    if (!counts) return null;
    const real = counts.filter((c) => isRealUseNamespace(config.ownerId, c.name));
    const view = { realUseMemories: real.reduce((sum, c) => sum + c.count, 0), namespaces: real.length };
    countsCache = { at: Date.now(), view };
    return view;
  },
  sendPayment: async (paymentId) => {
    const payment = await send(paymentId);
    await recordFinished([payment].filter((p) => p.state === "SETTLED" || p.state === "FAILED"));
    return payment;
  },
};

await completeReadyChanges(owner, Date.now());
setInterval(() => void completeReadyChanges(owner, Date.now()).catch((error: Error) => console.error(`Change completion skipped: ${error.message.slice(0, 200)}`)), RECONCILE_EVERY_MS).unref();

let bot: ReturnType<typeof startBot> | null = null;
const modelStats = new ModelStats();
const status = statusProbe({
  network: config.network, version: process.env["GIT_SHA"] ?? null, database: { label: storage.label, rows: storage.rows }, graphql,
  grpcBalance: () => readAgentBalances(grpc, config.network, agentAddress), walrus, ownerPrefix: `countersign:${config.ownerId}:`,
  memory: () => memoryView, telegramPolling: () => bot?.isRunning() ?? false, model: () => modelStats.view(),
});
const server = startWebServer({ port: config.port, network: config.network, proof: storage.rows, version: process.env["GIT_SHA"] ?? null, owner, status });
bot = startBot({
  token: config.telegram.token, ownerUserId: config.telegram.ownerUserId, network: config.network, publicUrl: config.publicUrl, engine, index, auth,
  extract: modelStats.tracked((text, payeeIds) => extractProposal(config.gemini, text, payeeIds)),
  answeredByCode: () => modelStats.answeredByCode(),
  sendPayment: send,
});

process.once("SIGTERM", () => {
  console.log("Stopping: Telegram polling ends first so a new instance can take over.");
  void (bot?.stop() ?? Promise.resolve()).finally(() => {
    server.close();
    void storage.close().finally(() => process.exit(0));
  });
});
