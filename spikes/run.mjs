import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { ChannelCredentials } from "@grpc/grpc-js";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { fromBase64 } from "@mysten/sui/utils";
import { MemWal } from "@mysten-incubation/memwal";

const GRAPHQL_URL = "https://sui-mainnet.gateway.tatum.io/graphql";
const JSONRPC_URL = "https://sui-mainnet.gateway.tatum.io/";
const GRPC_HOST = "sui-mainnet-grpc.gateway.tatum.io:443";
const RELAYER_URL = "https://relayer.memory.walrus.xyz";
const PAY_AMOUNT_MIST = 1000n;

const REQUIRED = ["TATUM_API_KEY", "MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID", "WALLET_A_PRIVATE_KEY", "WALLET_B_ADDRESS"];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing in .env: ${missing.join(", ")}. Nothing was run.`);
  process.exit(2);
}
const env = Object.fromEntries(REQUIRED.map((name) => [name, process.env[name]]));
const runPayment = process.argv.includes("--pay");
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const onlyIds = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : null;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const FREE_TIER_SPACING_MS = 1_000;

mkdirSync("evidence", { recursive: true });
const results = [];

function redact(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
  for (const secret of [env.TATUM_API_KEY, env.MEMWAL_PRIVATE_KEY, env.WALLET_A_PRIVATE_KEY]) {
    text = text.split(secret).join("[redacted]");
  }
  return text;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, FREE_TIER_SPACING_MS));

async function spike(id, claim, fn) {
  if (onlyIds && !onlyIds.has(id)) return;
  await pause();
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
  await pause();
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.TATUM_API_KEY },
    body: JSON.stringify({ query, variables }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const walletA = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(env.WALLET_A_PRIVATE_KEY).secretKey);
const addressA = walletA.toSuiAddress();
const grpc = new SuiGrpcClient({
  network: "mainnet",
  transport: new GrpcTransport({ host: GRPC_HOST, channelCredentials: ChannelCredentials.createSsl(), meta: { "x-api-key": env.TATUM_API_KEY }, timeout: 20_000 }),
});

await spike("S1", "Tatum Sui mainnet GraphQL answers with x-api-key; JSON-RPC on / may 404", async () => {
  const gql = await graphql("{ chainIdentifier }");
  const methods = await fetch(`${JSONRPC_URL}_methods`, { headers: { "x-api-key": env.TATUM_API_KEY } });
  const rpc = await fetch(JSONRPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.TATUM_API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sui_getChainIdentifier", params: [] }),
  });
  return {
    outcome: gql.body?.data?.chainIdentifier ? "CONFIRMED" : "WRONG",
    graphql: gql,
    methodsStatus: methods.status,
    methodsBody: (await methods.text()).slice(0, 2000),
    jsonRpcStatus: rpc.status,
    jsonRpcBody: (await rpc.text()).slice(0, 500),
  };
});

await spike("S5", "Tatum gRPC (native, not grpc-web) answers LedgerService.GetServiceInfo with x-api-key metadata", async () => {
  const { response } = await grpc.ledgerService.getServiceInfo({});
  return { outcome: response?.chainId || response?.chain ? "CONFIRMED" : "AMBIGUOUS", response };
});

await spike("S6", "Tatum GraphQL serves transactions(filter:{affectedAddress}) with balanceChanges; report retention window", async () => {
  const config = await graphql(`{ serviceConfig {
    maxPageSize(type: "Query", field: "transactions")
    availableRange(type: "Query", field: "transactions", filters: ["affectedAddress"]) { first { sequenceNumber } last { sequenceNumber } }
  } }`);
  const history = await graphql(`query ($a: SuiAddress!) { transactions(last: 5, filter: { affectedAddress: $a }) {
    nodes { digest effects { status timestamp checkpoint { sequenceNumber } balanceChanges { nodes { owner { address } amount coinType { repr } } } } }
  } }`, { a: addressA });
  const range = config.body?.data?.serviceConfig?.availableRange;
  const timestampOf = async (sequenceNumber) => (await graphql(`query ($n: UInt53!) { checkpoint(sequenceNumber: $n) { timestamp } }`, { n: sequenceNumber })).body?.data?.checkpoint?.timestamp ?? null;
  const firstAt = range ? await timestampOf(range.first.sequenceNumber) : null;
  const lastAt = range ? await timestampOf(range.last.sequenceNumber) : null;
  const retentionDays = firstAt && lastAt ? (Date.parse(lastAt) - Date.parse(firstAt)) / 86_400_000 : null;
  const latestWithBalanceChanges = await graphql(`{ transactions(last: 1) { nodes { digest effects { status balanceChanges { nodes { owner { address } amount coinType { repr } } } } } } }`);
  const answered = (call) => call.status === 200 && !call.body?.errors && call.body?.data;
  const ok = [config, history, latestWithBalanceChanges].every(answered) && retentionDays !== null;
  return { outcome: ok ? "CONFIRMED" : "WRONG", config, firstAt, lastAt, retentionDays, history, latestWithBalanceChanges };
});

await spike("S10", "Tatum gRPC SignatureVerificationService verifies a Sui PersonalMessage and enforces the address", async () => {
  const text = `Countersign spike ${runId}\npayee:spike\nfrom:${addressA}\nto:${env.WALLET_B_ADDRESS}\nnonce:${createHash("sha256").update(runId).digest("hex").slice(0, 32)}`;
  const message = new TextEncoder().encode(text);
  const { signature } = await walletA.signPersonalMessage(message);
  const tampered = new TextEncoder().encode(text.replace("payee:spike", "payee:other"));
  const request = (address, bytes = message) => ({
    message: { name: "PersonalMessage", value: bcs.byteVector().serialize(bytes).toBytes() },
    signature: { bcs: { value: fromBase64(signature) }, signature: { oneofKind: undefined } },
    address,
    jwks: [],
  });
  const good = (await grpc.signatureVerificationService.verifySignature(request(addressA))).response;
  await pause();
  const wrong = (await grpc.signatureVerificationService.verifySignature(request(env.WALLET_B_ADDRESS))).response;
  await pause();
  const altered = (await grpc.signatureVerificationService.verifySignature(request(addressA, tampered))).response;
  const local = await verifyPersonalMessageSignature(message, signature, { address: addressA }).then(() => true, () => false);
  const outcome = good?.isValid === true && wrong?.isValid === false && altered?.isValid === false && local ? "CONFIRMED" : "WRONG";
  return { outcome, good, wrong, tamperedMessage: altered, localSdkAgrees: local };
});

const namespace = `countersign-spike-${runId}`;
const memwal = MemWal.create({ key: env.MEMWAL_PRIVATE_KEY, accountId: env.MEMWAL_ACCOUNT_ID, serverUrl: RELAYER_URL, namespace });

await spike("S2", "rememberAndWait returns a blob id on mainnet; record write latency (labelled spike data, separate namespace)", async () => {
  const timings = [];
  for (let i = 1; i <= 3; i++) {
    const text = JSON.stringify({ record: { type: "spike", runId, i, note: "Countersign feasibility spike, not product data" }, sig: "spike" });
    const t0 = Date.now();
    const written = await memwal.rememberAndWait(text, { idempotencyKey: createHash("sha256").update(text).digest("hex"), timeoutMs: 90_000 });
    timings.push({ i, ms: Date.now() - t0, written });
  }
  return { outcome: timings.every((t) => t.written?.blob_id || t.written?.blobId) ? "CONFIRMED" : "AMBIGUOUS", namespace, timings };
});

await spike("S12", "recall(topK 100, no maxDistance) returns every record in a small namespace; count matches listMemories", async () => {
  const recalled = await memwal.recall({ query: "Countersign feasibility spike record", topK: 100, namespace });
  const listed = await memwal.listMemories({ namespace });
  const listedCount = listed.memories.filter((m) => m.namespace_id === namespace).length;
  const outcome = recalled.results.length === listedCount && listedCount === 3 && !recalled.dropped_count ? "CONFIRMED" : "WRONG";
  return { outcome, recalledCount: recalled.results.length, listedCount, droppedCount: recalled.dropped_count ?? 0, sampleEndEpoch: listed.memories[0]?.end_epoch ?? null };
});

if (runPayment) {
  await spike("S13", "A SUI transfer signed locally executes through Tatum gRPC; S11: time until it is visible via Tatum GraphQL for the recipient", async () => {
    const tx = new Transaction();
    tx.setSender(addressA);
    const [coin] = tx.splitCoins(tx.gas, [PAY_AMOUNT_MIST]);
    tx.transferObjects([coin], env.WALLET_B_ADDRESS);
    const t0 = Date.now();
    const executed = await grpc.signAndExecuteTransaction({ transaction: tx, signer: walletA, include: { effects: true } });
    const executedMs = Date.now() - t0;
    const digest = executed?.Transaction?.digest ?? executed?.digest ?? executed?.transaction?.digest;
    let seenMs = null;
    for (let attempt = 0; attempt < 30 && seenMs === null; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const seen = await graphql(`query ($d: String!) { transaction(digest: $d) { effects { status checkpoint { sequenceNumber } } } }`, { d: digest });
      if (seen.body?.data?.transaction?.effects?.checkpoint) seenMs = Date.now() - t0;
    }
    return { outcome: digest && seenMs !== null ? "CONFIRMED" : "AMBIGUOUS", digest, executedMs, visibleInGraphqlMs: seenMs, amountMist: String(PAY_AMOUNT_MIST) };
  });
}

const file = `evidence/spikes-${runId}.json`;
writeFileSync(file, JSON.stringify({ runId, network: "mainnet", sdk: "@mysten/sui 2.37.0, memwal 0.1.12", results }, null, 2));
console.log(`\nWrote ${file}. Send this file back; it contains no keys.`);
