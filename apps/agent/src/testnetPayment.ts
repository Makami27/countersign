import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { formatUsdc, parseSuiAddress, type SuiAddress } from "@countersign/core";
import { SqliteIndex, SqlitePaymentLedger } from "@countersign/adapters/sqlite";
import { PaymentRunner } from "@countersign/adapters/payments";
import { SqliteRateGate, TATUM_FREE_TIER_INTERVAL_MS, readAgentBalances, tatumGrpcClient, tatumPaymentChain, tatumRateGateName } from "@countersign/adapters/tatum";
import { usdcToBaseUnits } from "@countersign/adapters/gemini";

const MAX_TEST_PAYMENT_BASE_UNITS = 100_000n;

function fail(message: string): never {
  console.error(`${message} Nothing was sent.`);
  process.exit(2);
}

if (process.env["NETWORK"] !== "testnet") fail("This command only runs with NETWORK=testnet.");
const apiKey = process.env["TATUM_API_KEY"] ?? fail("TATUM_API_KEY is missing.");
const walletKey = process.env["AGENT_WALLET_PRIVATE_KEY"] ?? fail("AGENT_WALLET_PRIVATE_KEY is missing.");
const recipient = parseSuiAddress(process.argv[2] ?? "") ?? fail("Usage: testnetPayment.ts <recipient 0x…64 hex> <amount USDC, e.g. 0.01>.");
const amountText = process.argv[3] ?? fail("Give the amount in USDC, e.g. 0.01.");
const amountBaseUnits = BigInt(usdcToBaseUnits(amountText) ?? fail(`${amountText} is not a USDC amount.`));
if (amountBaseUnits > MAX_TEST_PAYMENT_BASE_UNITS) fail(`Test payments are capped at ${formatUsdc(MAX_TEST_PAYMENT_BASE_UNITS)} USDC.`);

const workDir = mkdtempSync(join(tmpdir(), "countersign-testnet-pay-"));
const gate = new SqliteRateGate(join(workDir, "gate.sqlite"), tatumRateGateName("testnet"), TATUM_FREE_TIER_INTERVAL_MS);
const client = tatumGrpcClient("testnet", apiKey, gate);
const signer = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(walletKey).secretKey);
const agentAddress = signer.toSuiAddress() as SuiAddress;
const ledger = new SqlitePaymentLedger(join(workDir, "ledger.sqlite"));
const clock = { now: () => new Date() };
const runner = new PaymentRunner({ ledger, chain: tatumPaymentChain(client, signer, "testnet"), clock });

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const paymentId = `pay_testnet_${randomBytes(6).toString("hex")}`;
const before = await readAgentBalances(client, "testnet", agentAddress);
await new SqliteIndex(join(workDir, "ledger.sqlite")).putPayeeVersion({
  type: "payee_version", payeeId: "testnet-check", name: "testnet check (scratch, not a real payee)", version: 1, address: recipient, status: "VERIFIED", supersedes: null,
  evidence: { kind: "payee_onboarding", ownerConfirmationId: "testnet-spike", nonce: paymentId, control: { kind: "signature", signature: "none: scratch database for this script only" }, verifications: [] },
  createdAt: clock.now().toISOString(),
});
const reservation = await ledger.reservePayment({ id: paymentId, payeeId: "testnet-check", payeeVersion: 1, payeeBlobId: null, address: recipient, amountBaseUnits, period: clock.now().toISOString().slice(0, 10), createdAt: clock.now().toISOString() }, MAX_TEST_PAYMENT_BASE_UNITS);
if (reservation !== "RESERVED") fail(`The test reservation was refused (${reservation}).`);
console.log(`Nothing has been sent yet. Sending ${formatUsdc(amountBaseUnits)} test USDC to ${recipient} on Sui testnet through Tatum…`);
const started = Date.now();
const final = await runner.send(paymentId);
const elapsedMs = Date.now() - started;
const after = await readAgentBalances(client, "testnet", agentAddress);
const bigints = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);
const evidence = { runId, network: "testnet", classification: "testnet check of the payment path, test USDC, paid by our own agent wallet to the owner's demo payee wallet", agentAddress, recipient, amountBaseUnits, payment: final, elapsedMs, balancesBefore: before, balancesAfter: after };
mkdirSync("evidence/live", { recursive: true });
const file = `evidence/live/testnet-payment-${runId}.json`;
writeFileSync(file, JSON.stringify(evidence, bigints, 2));
console.log(`${final.state}: ${final.detail ?? ""} Digest ${final.digest ?? "none"}. ${elapsedMs} ms. Evidence: ${file}`);
gate.close();
