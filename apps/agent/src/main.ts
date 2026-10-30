import { randomBytes } from "node:crypto";
import { Bot } from "grammy";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Countersign, type SuiAddress } from "@countersign/core";
import { SqliteIndex, SqlitePaymentLedger } from "@countersign/adapters/sqlite";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { SqliteRateGate, TATUM_FREE_TIER_INTERVAL_MS, TATUM_GRAPHQL_URL, TatumGraphql, TatumRoundTripChecker, TatumSignatureVerifier, USDC_COIN_TYPE, tatumGrpcClient, tatumPaymentChain, tatumRateGateName } from "@countersign/adapters/tatum";
import { extractProposal } from "@countersign/adapters/gemini";
import { PaymentRunner } from "@countersign/adapters/payments";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { loadConfig } from "./config.ts";
import { MODEL_UNREADABLE_REPLY, paymentPendingReply, paymentReply, replyFor } from "./replies.ts";

const config = loadConfig(process.env);
const tatumGate = new SqliteRateGate(config.databasePath, tatumRateGateName(config.network), TATUM_FREE_TIER_INTERVAL_MS);
const grpc = tatumGrpcClient(config.network, config.tatumApiKey, tatumGate);
const graphql = new TatumGraphql(TATUM_GRAPHQL_URL[config.network], config.tatumApiKey, tatumGate);
const wallet = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(config.agentWalletKey).secretKey);
const agentAddress = wallet.toSuiAddress() as SuiAddress;

const clock = { now: () => new Date() };
const payments = new SqlitePaymentLedger(config.databasePath);
const runner = new PaymentRunner({ ledger: payments, chain: tatumPaymentChain(grpc, wallet, config.network), clock });

const engine = new Countersign({
  ownerId: config.ownerId,
  memory: new MemWalMemory(config.memwal),
  index: new SqliteIndex(config.databasePath),
  payments,
  signer: recordSignerFromSeed(config.recordSigningKey),
  signatures: new TatumSignatureVerifier(grpc),
  roundTrips: new TatumRoundTripChecker(graphql, agentAddress, USDC_COIN_TYPE[config.network]),
  clock,
  nonces: { next: () => randomBytes(16).toString("hex") },
  caps: config.caps,
  cooldownMs: config.cooldownMs,
});

const restored = await engine.restore();
if (!restored.ok) throw new Error("Walrus Memory could not be read completely at startup. Nothing was started; no payment can be made.");
await runner.recoverInterrupted();

const bot = new Bot(config.telegram.token);

bot.on("message:text", async (ctx) => {
  if (ctx.from.id !== config.telegram.ownerUserId) return;
  const inbound = { id: `tg:${ctx.message.message_id}`, channel: "telegram" as const, from: String(ctx.from.id), text: ctx.message.text, receivedAt: new Date(ctx.message.date * 1000).toISOString() };
  const extraction = await extractProposal(config.gemini, inbound.text, engine.payeeIds());
  if (extraction.status === "UNKNOWN") {
    await ctx.reply(MODEL_UNREADABLE_REPLY);
    return;
  }
  const outcome = await engine.handle(inbound, extraction.proposal);
  if (outcome.verdict === "PAY_RESERVED") {
    await ctx.reply(paymentPendingReply(outcome.amountBaseUnits, outcome.address, config.network));
    await ctx.reply(paymentReply(await runner.send(outcome.paymentId), config.network));
    return;
  }
  await ctx.reply(replyFor(outcome));
});

await bot.start();
