import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { build } from "esbuild";
import { ChannelCredentials } from "@grpc/grpc-js";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { isValidPersonalMessageSignature } from "@mysten/sui/verify";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import { bcs } from "@mysten/sui/bcs";
import { fromBase64, toBase64 } from "@mysten/sui/utils";

const PORT = 8790;
const SPACING_MS = 1_000;
const UNRELATED_ADDRESS = `0x${"1".repeat(64)}`;
const NETWORKS = {
  mainnet: { grpcHost: "sui-mainnet-grpc.gateway.tatum.io:443", graphqlUrl: "https://sui-mainnet.gateway.tatum.io/graphql", envFile: ".env" },
  testnet: { grpcHost: "sui-testnet-grpc.gateway.tatum.io:443", graphqlUrl: "https://sui-testnet.gateway.tatum.io/graphql", envFile: "../.env" },
};

const keys = Object.fromEntries(Object.entries(NETWORKS).map(([network, { envFile }]) => [network, parseEnv(readFileSync(envFile, "utf8")).TATUM_API_KEY]));
const walletB = parseEnv(readFileSync(".env", "utf8")).WALLET_B_ADDRESS ?? null;
for (const [network, key] of Object.entries(keys)) {
  if (!key) {
    console.error(`No TATUM_API_KEY for ${network}. Nothing was run.`);
    process.exit(2);
  }
}

const clients = Object.fromEntries(Object.entries(NETWORKS).map(([network, n]) => [network, {
  grpc: new SuiGrpcClient({ network, transport: new GrpcTransport({ host: n.grpcHost, channelCredentials: ChannelCredentials.createSsl(), meta: { "x-api-key": keys[network] }, timeout: 20_000 }) }),
  graphql: new SuiGraphQLClient({ network, url: n.graphqlUrl, headers: { "x-api-key": keys[network] } }),
}]));

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const page = (await build({ entryPoints: ["zklogin/page.mjs"], bundle: true, format: "esm", platform: "browser", minify: true, write: false })).outputFiles[0].text;
const html = readFileSync("zklogin/index.html", "utf8");
let challenge = null;

const pause = () => new Promise((resolve) => setTimeout(resolve, SPACING_MS));

function redact(text) {
  return Object.values(keys).reduce((t, key) => t.split(key).join("[redacted]"), text);
}

async function viaGateway(network, messageBytes, signature, address) {
  await pause();
  try {
    const { response } = await clients[network].grpc.signatureVerificationService.verifySignature({
      message: { name: "PersonalMessage", value: bcs.byteVector().serialize(messageBytes).toBytes() },
      signature: { bcs: { value: fromBase64(signature) }, signature: { oneofKind: undefined } },
      address,
      jwks: [],
    });
    return { result: response.isValid === true ? "VALID" : "INVALID", reason: response.reason ?? null };
  } catch (error) {
    return { result: "ERROR", reason: redact(String(error?.message ?? error)).slice(0, 300) };
  }
}

async function viaSdk(network, transport, messageBytes, signature, address) {
  await pause();
  try {
    const valid = await isValidPersonalMessageSignature(messageBytes, signature, { address, client: clients[network][transport] });
    return { result: valid ? "VALID" : "INVALID" };
  } catch (error) {
    return { result: "ERROR", reason: redact(String(error?.message ?? error)).slice(0, 300) };
  }
}

function describe(signature) {
  const parsed = parseSerializedSignature(signature);
  if (parsed.signatureScheme !== "ZkLogin") return { scheme: parsed.signatureScheme };
  return { scheme: "ZkLogin", iss: parsed.zkLogin.iss, maxEpoch: String(parsed.zkLogin.maxEpoch) };
}

async function verifyAll(body) {
  const messageBytes = fromBase64(body.bytes);
  const altered = new TextEncoder().encode(`${challenge}\naltered`);
  const checks = {
    mainnetGateway: await viaGateway("mainnet", messageBytes, body.signature, body.address),
    mainnetGatewayUnrelatedAddress: await viaGateway("mainnet", messageBytes, body.signature, UNRELATED_ADDRESS),
    mainnetGatewayAlteredMessage: await viaGateway("mainnet", altered, body.signature, body.address),
    mainnetSdkViaGrpc: await viaSdk("mainnet", "grpc", messageBytes, body.signature, body.address),
    mainnetSdkViaGraphql: await viaSdk("mainnet", "graphql", messageBytes, body.signature, body.address),
    testnetGateway: await viaGateway("testnet", messageBytes, body.signature, body.address),
    testnetSdkViaGraphql: await viaSdk("testnet", "graphql", messageBytes, body.signature, body.address),
  };
  const currentEpochs = {};
  for (const network of Object.keys(NETWORKS)) {
    await pause();
    currentEpochs[network] = await clients[network].grpc.ledgerService.getServiceInfo({}).then(({ response }) => String(response.epoch), (error) => `ERROR ${redact(String(error?.message ?? error)).slice(0, 120)}`);
  }
  const mainnetOk = checks.mainnetGateway.result === "VALID" && checks.mainnetGatewayUnrelatedAddress.result === "INVALID" && checks.mainnetGatewayAlteredMessage.result === "INVALID";
  return { checks, currentEpochs, outcome: mainnetOk ? "CONFIRMED" : "WRONG" };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method === "GET" && path === "/") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  if (req.method === "GET" && path === "/page.js") return res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(page);
  if (req.method === "GET" && path === "/challenge") {
    challenge = ["Countersign S10z spike", `run:${runId}`, `nonce:${randomBytes(16).toString("hex")}`, `issued:${new Date().toISOString()}`, "This signature moves no money."].join("\n");
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ message: challenge }));
  }
  if (req.method === "POST" && path === "/signature") {
    const body = await readJson(req);
    if (!challenge || new TextDecoder().decode(fromBase64(body.bytes)) !== challenge) {
      return res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ headline: "The signed text is not the challenge this server issued. Nothing was recorded." }));
    }
    const signature = describe(body.signature);
    const verified = await verifyAll(body);
    const record = { runId, network: "mainnet and testnet via Tatum", sdk: "@mysten/sui 2.37.0", wallet: body.wallet, address: body.address, isWalletB: walletB ? body.address === walletB : null, signature, message: challenge, signatureBase64: body.signature, ...verified };
    mkdirSync("evidence", { recursive: true });
    const file = `evidence/s10z-${runId}.json`;
    writeFileSync(file, JSON.stringify(record, null, 2));
    const headline = `S10z ${verified.outcome}: ${signature.scheme} signature, mainnet gateway ${verified.checks.mainnetGateway.result}, testnet gateway ${verified.checks.testnetGateway.result}. Evidence: spikes/${file}`;
    console.log(headline);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ headline, ...record, signatureBase64: toBase64(fromBase64(body.signature)).slice(0, 24) + "…" }));
    setTimeout(() => process.exit(0), 500);
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, "127.0.0.1", () => console.log(`S10z page ready at http://localhost:${PORT} (run ${runId})`));
