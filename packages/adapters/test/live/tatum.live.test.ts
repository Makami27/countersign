import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import type { SuiAddress } from "@countersign/core";
import { SqliteRateGate, TATUM_FREE_TIER_INTERVAL_MS, TATUM_GRAPHQL_URL, TatumGraphql, TatumSignatureVerifier, USDC_COIN_TYPE, tatumGrpcClient, tatumRateGateName } from "../../src/tatum/index.ts";
import { SUI_COIN_TYPE, readAgentBalances } from "../../src/tatum/balances.ts";

const TESTNET_CHAIN_IDENTIFIER = "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD";

const apiKey = process.env["TATUM_API_KEY"] ?? "";
const agentKey = process.env["AGENT_WALLET_PRIVATE_KEY"] ?? "";
const onTestnet = process.env["NETWORK"] === "testnet" && apiKey !== "" && agentKey !== "";
const skip = onTestnet ? false : "needs NETWORK=testnet, TATUM_API_KEY and AGENT_WALLET_PRIVATE_KEY in .env";

const gate = new SqliteRateGate(join(mkdtempSync(join(tmpdir(), "countersign-live-")), "gate.sqlite"), tatumRateGateName("testnet"), TATUM_FREE_TIER_INTERVAL_MS);
const grpc = tatumGrpcClient("testnet", apiKey, gate);

test("V19 Tatum GraphQL answers the Sui testnet chain identifier through the adapter (testnet)", { skip }, async () => {
  const result = await new TatumGraphql(TATUM_GRAPHQL_URL.testnet, apiKey, gate).query<{ chainIdentifier: string }>("{ chainIdentifier }");
  assert.deepEqual(result, { ok: true, data: { chainIdentifier: TESTNET_CHAIN_IDENTIFIER } });
});

test("V19 C07 Tatum gRPC verifies a fresh Ed25519 change signature through the adapter and rejects another address and an altered message (testnet)", { skip }, async () => {
  const payee = new Ed25519Keypair();
  const other = new Ed25519Keypair();
  const message = ["Countersign payee change v1", "payee:live-test", `from:${payee.toSuiAddress()}`, `to:${other.toSuiAddress()}`, `nonce:${Date.now()}`].join("\n");
  const { signature } = await payee.signPersonalMessage(new TextEncoder().encode(message));
  const verifier = new TatumSignatureVerifier(grpc);
  assert.equal(await verifier.verifyPersonalMessage(message, signature, payee.toSuiAddress() as SuiAddress), "VALID");
  assert.equal(await verifier.verifyPersonalMessage(message, signature, other.toSuiAddress() as SuiAddress), "INVALID");
  assert.equal(await verifier.verifyPersonalMessage(`${message}\naltered`, signature, payee.toSuiAddress() as SuiAddress), "INVALID");
});

test("V02 reads the agent wallet's SUI and USDC through Tatum gRPC, split into coin objects and address balance (testnet)", { skip }, async () => {
  const owner = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(agentKey).secretKey).toSuiAddress() as SuiAddress;
  const balances = await readAgentBalances(grpc, "testnet", owner);
  assert.equal(balances.status, "KNOWN");
  if (balances.status !== "KNOWN") return;
  assert.equal(balances.sui.coinType, SUI_COIN_TYPE);
  assert.equal(balances.usdc.coinType, USDC_COIN_TYPE.testnet);
  assert.equal(balances.sui.totalBaseUnits, balances.sui.inCoinObjectsBaseUnits + balances.sui.inAddressBalanceBaseUnits);
  assert.equal(balances.usdc.totalBaseUnits, balances.usdc.inCoinObjectsBaseUnits + balances.usdc.inAddressBalanceBaseUnits);
});
