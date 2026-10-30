import { writeFileSync, mkdirSync } from "node:fs";
import { ChannelCredentials } from "@grpc/grpc-js";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

const GRAPHQL_URL = "https://sui-testnet.gateway.tatum.io/graphql";
const GRPC_HOST = "sui-testnet-grpc.gateway.tatum.io:443";
const TESTNET_USDC = "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

const REQUIRED = ["TATUM_API_KEY", "AGENT_WALLET_PRIVATE_KEY"];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing in the root .env: ${missing.join(", ")}. Nothing was run.`);
  process.exit(2);
}
const apiKey = process.env.TATUM_API_KEY;
const walletKey = process.env.AGENT_WALLET_PRIVATE_KEY;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const results = [];

function redact(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
  return [apiKey, walletKey].reduce((t, secret) => t.split(secret).join("[redacted]"), text);
}

async function spike(id, claim, fn) {
  const started = Date.now();
  try {
    const observed = await fn();
    results.push({ id, claim, outcome: observed.outcome, observed: JSON.parse(redact(observed)), ms: Date.now() - started });
  } catch (error) {
    results.push({ id, claim, outcome: "ERROR", error: redact(String(error?.stack ?? error)), ms: Date.now() - started });
  }
  console.log(`${id} ${results.at(-1).outcome} (${results.at(-1).ms} ms)`);
}

async function graphql(query, variables = {}) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ query, variables }),
  });
  return { status: response.status, body: await response.json().catch(async () => ({ nonJson: (await response.text()).slice(0, 500) })) };
}

const agentAddress = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(walletKey).secretKey).toSuiAddress();
const grpc = new SuiGrpcClient({
  network: "testnet",
  transport: new GrpcTransport({ host: GRPC_HOST, channelCredentials: ChannelCredentials.createSsl(), meta: { "x-api-key": apiKey }, timeout: 20_000 }),
});

await spike("T1", "Tatum serves Sui testnet GraphQL at sui-testnet.gateway.tatum.io/graphql with the testnet key", async () => {
  const gql = await graphql("{ chainIdentifier }");
  return { outcome: gql.body?.data?.chainIdentifier ? "CONFIRMED" : "WRONG", graphql: gql };
});

await spike("T2", "Tatum serves Sui testnet native gRPC with the testnet key", async () => {
  const { response } = await grpc.ledgerService.getServiceInfo({});
  return { outcome: response?.chainId || response?.chain ? "CONFIRMED" : "AMBIGUOUS", response };
});

await spike("T3", "Agent wallet testnet holdings: SUI and USDC as address balance vs coin objects", async () => {
  const balances = await graphql(`query ($a: SuiAddress!) { address(address: $a) {
    balances { nodes { coinType { repr } totalBalance } }
    objects(filter: { type: "0x2::coin::Coin" }) { nodes { address contents { type { repr } json } } }
  } }`, { a: agentAddress });
  const grpcSui = await grpc.getBalance({ owner: agentAddress }).catch((error) => ({ error: String(error) }));
  const grpcUsdc = await grpc.getBalance({ owner: agentAddress, coinType: TESTNET_USDC }).catch((error) => ({ error: String(error) }));
  const ok = !balances.body?.errors && balances.status === 200;
  return { outcome: ok ? "CONFIRMED" : "WRONG", agentAddress, graphql: balances, grpcSui, grpcUsdc };
});

mkdirSync("evidence", { recursive: true });
const file = `evidence/testnet-${runId}.json`;
writeFileSync(file, JSON.stringify({ runId, network: "testnet", sdk: "@mysten/sui 2.37.0", results }, null, 2));
console.log(`\nWrote ${file}. It contains no keys.`);
