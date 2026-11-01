import { randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Countersign, type SuiAddress } from "@countersign/core";
import { SharedAttackList } from "@countersign/core/shared";
import { MemWalMemory } from "@countersign/adapters/memwal";
import { PaymentRunner } from "@countersign/adapters/payments";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { SharedRateGate, TATUM_FREE_TIER_INTERVAL_MS, TATUM_GRAPHQL_URL, TatumGraphql, TatumRoundTripChecker, TatumSignatureVerifier, USDC_COIN_TYPE, tatumGrpcClient, tatumPaymentChain, tatumRateGateName } from "@countersign/adapters/tatum";
import { loadConfig } from "./config.ts";
import { openStorage } from "./storage.ts";

export async function openDeployed() {
  const config = loadConfig(process.env);
  if (config.database.kind !== "postgres" || config.memoryBackend !== "walrus" || !config.publicUrl) throw new Error("This acts on the deployed agent: it needs DATABASE_URL, Walrus Memory and PUBLIC_BASE_URL. Nothing was changed.");
  const storage = await openStorage(config.database);
  const gate = new SharedRateGate(storage.rows, tatumRateGateName(config.network), TATUM_FREE_TIER_INTERVAL_MS);
  const grpc = tatumGrpcClient(config.network, config.tatumApiKey, gate);
  const graphql = new TatumGraphql(TATUM_GRAPHQL_URL[config.network], config.tatumApiKey, gate);
  const wallet = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(config.agentWalletKey).secretKey);
  const memory = new MemWalMemory(config.memwal);
  const signer = recordSignerFromSeed(config.recordSigningKey);
  const shared = new SharedAttackList({ memory, signer, now: () => new Date() });
  await shared.refresh();
  const clock = { now: () => new Date() };
  const engine = new Countersign({
    ownerId: config.ownerId, network: config.network, memory, shared, index: storage.index, payments: storage.ledger, clock,
    signer, signatures: new TatumSignatureVerifier(grpc),
    roundTrips: new TatumRoundTripChecker(graphql, wallet.toSuiAddress() as SuiAddress, USDC_COIN_TYPE[config.network]),
    nonces: { next: () => randomBytes(16).toString("hex") }, caps: config.caps, cooldownMs: config.cooldownMs,
  });
  const runner = new PaymentRunner({ ledger: storage.ledger, chain: tatumPaymentChain(grpc, wallet, config.network), clock });
  return { config, storage, engine, runner, publicUrl: config.publicUrl };
}
