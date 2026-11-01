import { randomBytes } from "node:crypto";
import { formatUsdc, usdcToBaseUnits } from "@countersign/core";
import { openDeployed } from "./deployed.ts";

const MAX_TEST_PAYMENT_BASE_UNITS = 100_000n;
const [payeeId = "", amountText = ""] = process.argv.slice(2);
const amountBaseUnits = usdcToBaseUnits(amountText);
if (!payeeId || !amountBaseUnits) throw new Error("Usage: payPayee.ts <payee id> <amount USDC, e.g. 0.01>. Nothing was sent.");
if (BigInt(amountBaseUnits) > MAX_TEST_PAYMENT_BASE_UNITS) throw new Error(`Payments from this command are capped at ${formatUsdc(MAX_TEST_PAYMENT_BASE_UNITS)} USDC. Nothing was sent.`);
const { config, engine, runner, storage, publicUrl } = await openDeployed();
if (config.network !== "testnet") throw new Error("This command only pays on testnet. Nothing was sent.");
const text = `Pay ${payeeId} ${amountText} USDC (operator command, testnet)`;
const outcome = await engine.handle({ id: `cli:${randomBytes(8).toString("hex")}`, channel: "cli", from: "owner", text, receivedAt: new Date().toISOString() }, { kind: "pay", payeeId, amountBaseUnits, reasonQuote: text });
if (outcome.verdict !== "PAY_RESERVED") {
  console.log(JSON.stringify({ outcome }, null, 2));
  await storage.close();
  process.exit(2);
}
const payment = await runner.send(outcome.paymentId);
const receipt = await engine.recordPaymentOutcome(payment);
console.log(JSON.stringify({ payment: { ...payment, amountBaseUnits: payment.amountBaseUnits.toString() }, receipt, receiptUrl: receipt ? `${publicUrl}/r/${receipt.receipt}` : null }, null, 2));
await storage.close();
