import { randomBytes } from "node:crypto";
import { Bot } from "grammy";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Countersign, type SuiAddress } from "@countersign/core";
import { SqliteIndex } from "@countersign/adapters/sqlite";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { SqliteRateGate, TATUM_FREE_TIER_INTERVAL_MS, TATUM_GRAPHQL_URL, TatumGraphql, TatumRoundTripChecker, TatumSignatureVerifier, USDC_COIN_TYPE, sendUsdc, tatumGrpcClient, tatumRateGateName } from "@countersign/adapters/tatum";
import { extractProposal } from "@countersign/adapters/gemini";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { loadConfig } from "./config.ts";
import { MODEL_UNREADABLE_REPLY, replyFor } from "./replies.ts";

const config = loadConfig(process.env);
const tatumGate = new SqliteRateGate(config.databasePath, tatumRateGateName(config.network), TATUM_FREE_TIER_INTERVAL_MS);
const grpc = tatumGrpcClient(config.network, config.tatumApiKey, tatumGate);
const graphql = new TatumGraphql(TATUM_GRAPHQL_URL[config.network], config.tatumApiKey, tatumGate);
const wallet = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(config.agentWalletKey).secretKey);
const agentAddress = wallet.toSuiAddress() as SuiAddress;

const engine = new Countersign({
  ownerId: config.ownerId,
  memory: new MemWalMemory(config.memwal),
  index: new SqliteIndex(config.databasePath),
  signer: recordSignerFromSeed(config.recordSigningKey),
  signatures: new TatumSignatureVerifier(grpc),
  roundTrips: new TatumRoundTripChecker(graphql, agentAddress, USDC_COIN_TYPE[config.network]),
  clock: { now: () => new Date() },
  nonces: { next: () => randomBytes(16).toString("hex") },
  caps: config.caps,
  cooldownMs: config.cooldownMs,
});

const restored = await engine.restore();
if (!restored.ok) throw new Error("Walrus Memory could not be read completely at startup. Nothing was started; no payment can be made.");

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
    const sent = await sendUsdc(grpc, wallet, config.network, outcome.address, outcome.amountBaseUnits);
    await ctx.reply(sent.state === "SENT" ? `Sent. Digest ${sent.digest}.` : sent.state === "FAILED" ? `Payment failed on chain. ${sent.detail}` : "Payment outcome UNKNOWN. It will not be resent; reconciling by digest.");
    return;
  }
  await ctx.reply(replyFor(outcome));
});

await bot.start();
