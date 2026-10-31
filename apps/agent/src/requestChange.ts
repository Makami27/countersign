import { randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Countersign, parseSuiAddress, type SuiAddress } from "@countersign/core";
import { SharedAttackList } from "@countersign/core/shared";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { SharedRateGate, TATUM_FREE_TIER_INTERVAL_MS, TATUM_GRAPHQL_URL, TatumGraphql, TatumRoundTripChecker, TatumSignatureVerifier, USDC_COIN_TYPE, tatumGrpcClient, tatumRateGateName } from "@countersign/adapters/tatum";
import { loadConfig } from "./config.ts";
import { openStorage } from "./storage.ts";

const [payeeId = "", addressText = ""] = process.argv.slice(2);
const address = parseSuiAddress(addressText);
if (!payeeId || !address) throw new Error("Usage: requestChange.ts <payee id> <new address>. Nothing was changed.");
const config = loadConfig(process.env);
if (config.database.kind !== "postgres" || config.memoryBackend !== "walrus" || !config.publicUrl) throw new Error("This starts a change on the deployed agent: it needs DATABASE_URL, Walrus Memory and PUBLIC_BASE_URL. Nothing was changed.");
const storage = await openStorage(config.database);
const gate = new SharedRateGate(storage.rows, tatumRateGateName(config.network), TATUM_FREE_TIER_INTERVAL_MS);
const grpc = tatumGrpcClient(config.network, config.tatumApiKey, gate);
const graphql = new TatumGraphql(TATUM_GRAPHQL_URL[config.network], config.tatumApiKey, gate);
const agentAddress = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(config.agentWalletKey).secretKey).toSuiAddress() as SuiAddress;
const memory = new MemWalMemory(config.memwal);
const signer = recordSignerFromSeed(config.recordSigningKey);
const engine = new Countersign({
  ownerId: config.ownerId, network: config.network, memory, shared: new SharedAttackList({ memory, signer, now: () => new Date() }), index: storage.index, payments: storage.ledger, clock: { now: () => new Date() },
  signer, signatures: new TatumSignatureVerifier(grpc),
  roundTrips: new TatumRoundTripChecker(graphql, agentAddress, USDC_COIN_TYPE[config.network]),
  nonces: { next: () => randomBytes(16).toString("hex") }, caps: config.caps, cooldownMs: config.cooldownMs,
});
const text = `Owner requested a new address for ${payeeId}: ${address}`;
const outcome = await engine.handle({ id: `web:${randomBytes(8).toString("hex")}`, channel: "web", from: "owner", text, receivedAt: new Date().toISOString() }, { kind: "change_address", payeeId, newAddress: address, reasonQuote: text });
console.log(JSON.stringify({ outcome, signUrl: outcome.verdict === "CHANGE_STARTED" ? `${config.publicUrl}/sign/${outcome.nonce}` : null }, null, 2));
await storage.close();
