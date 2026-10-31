import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Countersign, REASONS, parseSuiAddress, type SuiAddress } from "@countersign/core";
import { SqliteIndex, SqlitePaymentLedger } from "@countersign/adapters/sqlite";
import { MAINNET_RELAYER_URL, MemWalMemory } from "@countersign/adapters/memwal";
import { PaymentRunner } from "@countersign/adapters/payments";
import { SqliteRateGate, TATUM_FREE_TIER_INTERVAL_MS, TATUM_GRAPHQL_URL, TatumGraphql, TatumRoundTripChecker, TatumSignatureVerifier, USDC_COIN_TYPE, tatumGrpcClient, tatumPaymentChain, tatumRateGateName } from "@countersign/adapters/tatum";
import { extractProposal } from "@countersign/adapters/gemini";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { loadConfig } from "./config.ts";
import { RECEIPT_PENDING_REPLY, paymentPendingReply, paymentReply, receiptReply, replyFor } from "./replies.ts";

const PAYEE_ID = "rent";
const config = loadConfig(process.env);
if (config.network !== "testnet") throw new Error("Act 1 runs on Sui testnet only. Nothing was sent.");
const payeeAddress = parseSuiAddress(process.argv[2] ?? "");
if (!payeeAddress) throw new Error("Usage: act1.ts <payee address> [message]. Nothing was sent.");
const text = process.argv[3] ?? "pay rent 0.01";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("evidence/acts", { recursive: true });
const transcript = `evidence/acts/act1-${runId}.txt`;
const say = (line: string) => {
  const stamped = `${new Date().toISOString()}  ${line}`;
  console.log(stamped);
  appendFileSync(transcript, `${stamped}\n`);
};

const ownerId = `${config.ownerId}-testnet`;
const workDir = mkdtempSync(join(tmpdir(), "countersign-act1-"));
const gate = new SqliteRateGate(join(workDir, "act1.sqlite"), tatumRateGateName("testnet"), TATUM_FREE_TIER_INTERVAL_MS);
const grpc = tatumGrpcClient("testnet", config.tatumApiKey, gate);
const wallet = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(config.agentWalletKey).secretKey);
const memory = new MemWalMemory({ key: config.memwal.key, accountId: config.memwal.accountId, serverUrl: MAINNET_RELAYER_URL });
const payments = new SqlitePaymentLedger(join(workDir, "act1.sqlite"));
const clock = { now: () => new Date() };
const runner = new PaymentRunner({ ledger: payments, chain: tatumPaymentChain(grpc, wallet, "testnet"), clock });
const engine = new Countersign({
  ownerId, network: "testnet", memory, index: new SqliteIndex(join(workDir, "act1.sqlite")), payments,
  signer: recordSignerFromSeed(config.recordSigningKey), signatures: new TatumSignatureVerifier(grpc),
  roundTrips: new TatumRoundTripChecker(new TatumGraphql(TATUM_GRAPHQL_URL.testnet, config.tatumApiKey, gate), wallet.toSuiAddress() as SuiAddress, USDC_COIN_TYPE.testnet),
  clock, nonces: { next: () => randomBytes(16).toString("hex") }, caps: config.caps, cooldownMs: config.cooldownMs,
});

say(`Act 1 (testnet demo). Money: Sui testnet, test USDC. Memory: Walrus Memory ${memory.environment}, demo owner "${ownerId}" (not counted as real use).`);
say("Rebuilding the payee book from Walrus Memory…");
const restored = await engine.restore();
if (!restored.ok) throw new Error("Walrus Memory could not be read completely. Nothing was sent.");
say(`Restored ${restored.payees} payee namespace(s); ${restored.ignored} record(s) ignored.`);

const head = await engine.payeeHead(PAYEE_ID);
if (head.kind !== "verified" || head.version.address !== payeeAddress) {
  say(`Payee "${PAYEE_ID}" is not verified at ${payeeAddress}. Nothing was sent. Add the payee in the owner app and have the payee sign on the signing page first.`);
  process.exit(1);
} else say(`Payee "${PAYEE_ID}" is already verified at ${payeeAddress} (version ${head.version.version}).`);

say(`Owner: "${text}"`);
const extraction = await extractProposal(config.gemini, text, await engine.payeeIds());
if (extraction.status === "UNKNOWN") throw new Error(`The language model did not answer (${extraction.problem}). Nothing was sent.`);
say(`Model (${extraction.modelVersion ?? "version not reported"}) answered ${extraction.modelText}; after code checks: ${JSON.stringify(extraction.proposal)}.`);
const outcome = await engine.handle({ id: `cli:${runId}`, channel: "cli", from: "owner", text, receivedAt: new Date().toISOString() }, extraction.proposal);
if (outcome.verdict !== "PAY_RESERVED") {
  say(replyFor(outcome));
  process.exit(outcome.verdict === "REFUSED" ? 0 : 1);
}
say(paymentPendingReply(outcome.amountBaseUnits, outcome.address, "testnet"));
const payment = await runner.send(outcome.paymentId);
say(paymentReply(payment, "testnet"));
let receipt = null;
if (payment.state === "SETTLED" || payment.state === "FAILED") {
  say(RECEIPT_PENDING_REPLY);
  receipt = await engine.recordPaymentOutcome(payment);
  say(receiptReply(receipt, null));
}
const bigints = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);
const evidence = {
  runId, act: 1, classification: "testnet demo: test USDC from our own agent wallet to the owner's demo wallet; memory on the Walrus Memory mainnet relayer under a demo owner excluded from real-use counts",
  network: "testnet", relayer: memory.environment, ownerId, text, modelVersion: extraction.modelVersion, modelText: extraction.modelText, proposal: extraction.proposal, payment, receipt,
  receiptRecord: receipt ? (await engine.receiptRecord(receipt.receipt)) : null, reasons: payment.reason ? REASONS[payment.reason] : null, transcript,
};
writeFileSync(`evidence/acts/act1-${runId}.json`, JSON.stringify(evidence, bigints, 2));
say(`Evidence: evidence/acts/act1-${runId}.json`);
gate.close();
