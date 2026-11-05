import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { InMemoryMemory, isRealUseNamespace, type SuiAddress } from "@countersign/core";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { PaymentRunner } from "@countersign/adapters/payments";
import { SharedRateGate, TATUM_FREE_TIER_INTERVAL_MS, TATUM_GRAPHQL_URL, TatumGraphql, TatumRoundTripChecker, TatumSignatureVerifier, USDC_COIN_TYPE, readAgentBalances, tatumGrpcClient, tatumPaymentChain, tatumRateGateName } from "@countersign/adapters/tatum";
import { extractProposal } from "@countersign/adapters/gemini";
import { extractWithGroq } from "@countersign/adapters/groq";
import { withFallback, type ModelReader } from "@countersign/adapters/model";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { startWebServer } from "@countersign/web/server";
import { OwnerAuth } from "@countersign/web/ownerAuth";
import { OwnerDirectory } from "@countersign/web/ownerDirectory";
import { TelegramLinks } from "@countersign/web/telegramLinks";
import { DEFAULT_HOURLY_LIMITS, QuotaMeter } from "@countersign/web/quota";
import { buildOwnerRuntime, type BuiltRuntime } from "@countersign/web/ownerRuntime";
import type { BalancesView, MemoryCounts } from "@countersign/web/ownerContext";
import { loadConfig } from "./config.ts";
import { startBot } from "./telegram.ts";
import { dropOwnerStorage, openOwnerStorage, openStorage, type Storage } from "./storage.ts";
import { statusProbe } from "./statusChecks.ts";
import { ModelStats } from "./modelStats.ts";
import { payeeSummary } from "@countersign/web/ownerViews";
import { scheduleList } from "@countersign/web/scheduleRoutes";
import { OwnerKeyStore } from "./ownerKeys.ts";

const TICK_EVERY_MS = 60_000;
const BALANCE_CACHE_MS = 30_000;
const COUNTS_CACHE_MS = 60_000;

const config = loadConfig(process.env);
const storage = await openStorage(config.database);
const gate = new SharedRateGate(storage.rows, tatumRateGateName(config.network), TATUM_FREE_TIER_INTERVAL_MS);
const grpc = tatumGrpcClient(config.network, config.tatumApiKey, gate);
const graphql = new TatumGraphql(TATUM_GRAPHQL_URL[config.network], config.tatumApiKey, gate);
const walrus = config.memoryBackend === "walrus" ? new MemWalMemory(config.memwal) : null;
const memory = walrus ?? new InMemoryMemory();
const relayerLabel = walrus ? walrus.environment : "sandbox (not Walrus Memory)";
const auth = await OwnerAuth.open(storage.rows, new URL(config.publicUrl ?? "http://localhost").host);
const verifier = new TatumSignatureVerifier(grpc);
const clock = { now: () => new Date() };
let bot: ReturnType<typeof startBot> | null = null;
const links = await TelegramLinks.open(storage.rows, { telegramUserId: config.telegram.ownerUserId, ownerId: config.ownerId });
let botUsername: string | null = null;

async function notifyAdmin(text: string): Promise<void> {
  await bot?.api.sendMessage(config.telegram.ownerUserId, text).catch((error: Error) => console.error(`Telegram notice not sent: ${error.message.slice(0, 120)}`));
}

function notifyFor(ownerId: string): (text: string) => Promise<void> {
  if (ownerId === config.ownerId) return notifyAdmin;
  return async (text) => {
    const chat = await links.chatOf(ownerId);
    if (chat !== null) await bot?.api.sendMessage(chat, text).catch((error: Error) => console.error(`Telegram notice not sent: ${error.message.slice(0, 120)}`));
  };
}

function telegramFor(ownerId: string) {
  return {
    link: async () => {
      if (!bot) return null;
      botUsername ??= (await bot.api.getMe().catch(() => null))?.username ?? null;
      if (!botUsername) return null;
      const issued = await links.issue(ownerId);
      return { url: `https://t.me/${botUsername}?start=${issued.token}`, expires: issued.expires };
    },
    linked: async () => (await links.chatOf(ownerId)) !== null,
  };
}

const balanceCache = new Map<string, { at: number; view: BalancesView }>();
function balancesFor(address: SuiAddress): () => Promise<BalancesView> {
  return async () => {
    const cached = balanceCache.get(address);
    if (cached && Date.now() - cached.at < BALANCE_CACHE_MS) return cached.view;
    const read = await readAgentBalances(grpc, config.network, address);
    const view: BalancesView = read.status === "KNOWN" ? { status: "KNOWN", suiBaseUnits: read.sui.totalBaseUnits, usdcBaseUnits: read.usdc.totalBaseUnits } : { status: "UNKNOWN", detail: read.detail };
    balanceCache.set(address, { at: Date.now(), view });
    return view;
  };
}

const countsCache = new Map<string, { at: number; view: NonNullable<MemoryCounts> }>();
function memoryCountsFor(ownerId: string): () => Promise<MemoryCounts> {
  return async () => {
    if (!walrus) return null;
    const cached = countsCache.get(ownerId);
    if (cached && Date.now() - cached.at < COUNTS_CACHE_MS) return cached.view;
    const counts = await walrus.namespaceCounts(`countersign:${ownerId}:`);
    if (!counts) return null;
    const real = counts.filter((c) => isRealUseNamespace(ownerId, c.name) && !c.name.endsWith(":keys"));
    const view = { realUseMemories: real.reduce((sum, c) => sum + c.count, 0), namespaces: real.length, byNamespace: real.map((c) => ({ suffix: c.name.slice(`countersign:${ownerId}:`.length), count: c.count })) };
    countsCache.set(ownerId, { at: Date.now(), view });
    return view;
  };
}

const modelStats = new ModelStats(config.groq ? "groq" : "gemini", config.groq ? "gemini" : null);
const gemini: ModelReader = (text, payeeIds) => extractProposal(config.gemini, text, payeeIds);
const groq = config.groq;
const reader: ModelReader = groq ? withFallback((text, payeeIds) => extractWithGroq(groq, text, payeeIds, (quota) => modelStats.quota(quota)), gemini) : gemini;
const trackedReader = modelStats.tracked(reader);

async function runtimeFor(ownerId: string, ownerStorage: Storage, walletKey: string, recordSeed: string): Promise<BuiltRuntime> {
  const wallet = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(walletKey).secretKey);
  const agentAddress = wallet.toSuiAddress() as SuiAddress;
  const built = await buildOwnerRuntime({
    ownerId, network: config.network, publicUrl: config.publicUrl, agentAddress, memory, relayerLabel, storage: ownerStorage,
    signer: recordSignerFromSeed(recordSeed), verifier,
    roundTrips: new TatumRoundTripChecker(graphql, agentAddress, USDC_COIN_TYPE[config.network]),
    runner: new PaymentRunner({ ledger: ownerStorage.ledger, chain: tatumPaymentChain(grpc, wallet, config.network), clock }),
    balances: balancesFor(agentAddress), memoryCounts: memoryCountsFor(ownerId), notify: notifyFor(ownerId), telegram: telegramFor(ownerId),
    reader: trackedReader, quota: new QuotaMeter(ownerId === config.ownerId ? null : DEFAULT_HOURLY_LIMITS), isAdmin: ownerId === config.ownerId,
    defaults: { perPaymentBaseUnits: config.caps.perPaymentBaseUnits, perDayBaseUnits: config.caps.perDayBaseUnits, cooldownSeconds: config.cooldownMs / 1000 },
    now: Date.now,
  });
  console.log(`Owner ${ownerId}: ${ownerStorage.label}; ${built.restored.ok ? `memory restored (${built.restored.payees} payee namespaces)` : "memory incomplete, payments blocked until it can be read"}.`);
  return built;
}

const admin = await runtimeFor(config.ownerId, storage, config.agentWalletKey, config.recordSigningKey);
const keyStore = config.masterKey ? await OwnerKeyStore.open(storage.rows, memory, config.masterKey) : null;
if (!keyStore) console.log("MASTER_KEY is not set: this agent serves only its admin owner.");

const ownerStorages = new Map<string, Storage>();
async function destroyOwner(ownerId: string): Promise<void> {
  await keyStore?.forget(ownerId);
  await links.forget(ownerId);
  await ownerStorages.get(ownerId)?.close();
  ownerStorages.delete(ownerId);
  await dropOwnerStorage(config.database, ownerId);
}

async function ownerRuntime(ownerId: string, create: boolean): Promise<BuiltRuntime> {
  if (!keyStore) throw new Error("MASTER_KEY is not set.");
  const keys = create ? await keyStore.create(ownerId) : await keyStore.load(ownerId);
  if (!keys) throw new Error(create ? "Walrus Memory didn't confirm the key backup." : "keys couldn't be read or opened with MASTER_KEY.");
  const ownerStorage = await openOwnerStorage(config.database, ownerId);
  ownerStorages.set(ownerId, ownerStorage);
  return runtimeFor(ownerId, ownerStorage, keys.agentWalletKey, keys.recordSeed);
}

const owners = await OwnerDirectory.open({
  rows: storage.rows, auth, adminOwnerId: config.ownerId, adminAddress: config.adminAddress, maxOwners: keyStore ? config.maxOwners : 1,
  create: (ownerId) => ownerRuntime(ownerId, true), notifyAdmin, now: Date.now, destroy: destroyOwner,
}, admin, (ownerId) => ownerRuntime(ownerId, false));
setInterval(() => void owners.tickAll(), TICK_EVERY_MS).unref();

const status = statusProbe({
  network: config.network, version: config.version, database: { label: storage.label, rows: storage.rows }, graphql,
  grpcBalance: () => readAgentBalances(grpc, config.network, admin.ctx.agentAddress), walrus, ownerPrefix: `countersign:${config.ownerId}:`,
  memory: () => admin.ctx.memory(), telegramPolling: () => bot?.isRunning() ?? false, model: () => modelStats.view(),
});
const server = startWebServer({ port: config.port, network: config.network, proof: storage.rows, version: config.version, owners, status });
bot = startBot({
  token: config.telegram.token, network: config.network, publicUrl: config.publicUrl,
  ownerFor: async (telegramUserId) => {
    const ownerId = await links.ownerOf(telegramUserId);
    const ctx = ownerId ? owners.get(ownerId) : null;
    return ctx ? {
      ownerId: ctx.ownerId, engine: ctx.engine, index: ctx.index, sendPayment: ctx.sendPayment, busy: () => ctx.quota.busy(), countModel: () => ctx.quota.record("model"),
      agentAddress: ctx.agentAddress, balances: ctx.balances, perPaymentCap: () => ctx.settings.values().perPaymentBaseUnits, schedules: () => scheduleList(ctx, Date.now()).schedules,
      payees: async () => Promise.all((await ctx.index.payeeIds()).map((id) => payeeSummary(ctx, id, Date.now()))),
    } : null;
  },
  redeemLink: async (token, telegramUserId) => {
    const linked = await links.redeem(token, telegramUserId);
    if (linked.ok) await notifyAdmin(`Owner ${linked.ownerId} connected a Telegram chat.`);
    return linked;
  },
  extract: trackedReader,
  answeredByCode: () => modelStats.answeredByCode(),
});
void owners.tickAll();

process.once("SIGTERM", () => {
  console.log("Stopping: Telegram polling ends first so a new instance can take over.");
  void (bot?.stop() ?? Promise.resolve()).finally(() => {
    server.close();
    void storage.close().finally(() => process.exit(0));
  });
});
