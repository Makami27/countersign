import { test } from "node:test";
import assert from "node:assert/strict";
import type { Extraction } from "@countersign/adapters/model";
import type { SuiAddress } from "@countersign/core";
import { lookalikeOf, message, wallet, world } from "../../../packages/core/test/fixtures.ts";
import { amountIn, looksLikePayment, quickAmounts, readPayment, type KnownPayee } from "../src/paymentReading.ts";
import { readMessage } from "../src/screen.ts";
import { LabSessions } from "../src/lab.ts";

const REAL = `0x${"c2".repeat(32)}` as SuiAddress;
const OTHER = `0x${"d4".repeat(32)}` as SuiAddress;
const LANDLORD: KnownPayee = { id: "landlord", name: "Landlord", verified: REAL };
const STUDIO: KnownPayee = { id: "flat-4b-rent", name: "Flat 4B rent", verified: null };

function modelSays(proposal: { kind: "none" }): (text: string) => Promise<Extraction> {
  return async () => ({ provider: "groq", status: "READ", proposal, modelVersion: null, modelText: "" });
}

const modelMustNotRun = async (): Promise<Extraction> => assert.fail("the model should not be asked");

test("U01 a payment request with no amount asks how much, naming the payee", () => {
  const reading = readPayment("pay rent to landlord", [LANDLORD]);
  assert.equal(reading?.kind, "ask_amount");
});

test("U01 a payment request with an amount reads as a payment of exactly that amount", () => {
  for (const [text, base] of [["pay 5 usdc to landlord", "5000000"], ["send landlord $2.50", "2500000"], ["please pay landlord 0.10", "100000"]] as const) {
    const reading = readPayment(text, [LANDLORD]);
    assert.deepEqual(reading?.kind === "pay" ? reading.amountBaseUnits : reading, base, text);
  }
});

test("U01 the address on file makes it a payment to that payee, even when no name is given", () => {
  assert.equal(readPayment(`pay rent to landlord at ${REAL}`, [LANDLORD])?.kind, "ask_amount");
  const named = readPayment(`pay 3 usdc to ${REAL}`, [LANDLORD]);
  assert.ok(named?.kind === "pay" && named.payee.id === "landlord" && named.amountBaseUnits === "3000000");
  assert.equal(readPayment(`Landlord's wallet is ${REAL}`, [LANDLORD])?.kind, "ask_amount");
});

test("U01 a different address is sent to the change checks, never paid", () => {
  const reading = readPayment(`pay landlord 5 usdc at ${OTHER}`, [LANDLORD]);
  assert.ok(reading?.kind === "change" && reading.address === OTHER);
});

test("U01 digits inside an address or an invoice number are never taken as an amount", () => {
  assert.equal(amountIn(`pay landlord at ${REAL}`, LANDLORD), null);
  assert.equal(amountIn("pay landlord invoice 44", LANDLORD), null);
  assert.equal(amountIn("pay landlord 5 usdc or 10 usdc", LANDLORD), null);
});

test("U01 a payee waiting for their wallet is said to be waiting, and unknown payees are named as unknown", () => {
  assert.equal(readPayment("pay flat 4b rent", [STUDIO])?.kind, "not_payable");
  assert.deepEqual(readPayment("pay the plumber", [LANDLORD]), { kind: "no_payee", address: null });
  assert.deepEqual(readPayment(`send funds to ${OTHER}`, [LANDLORD]), { kind: "no_payee", address: OTHER });
});

test("U01 a refusal to pay, or a message with no payment in it, is not read as a request", () => {
  assert.equal(looksLikePayment("don't pay the landlord"), false);
  assert.equal(readPayment("thanks for lunch", [LANDLORD]), null);
});

test("U01 quick amounts never go above the per-payment cap", () => {
  assert.deepEqual(quickAmounts(5_000_000n), ["0.10", "1", "5"]);
  assert.deepEqual(quickAmounts(50_000n), ["0.05"]);
});

test("U02 in the real app and Telegram the verified address with no amount asks how much, without the model", async () => {
  const { index, landlord } = await world();
  const reading = await readMessage(index, modelMustNotRun, `pay rent to landlord at ${landlord.address}`);
  assert.ok(reading.status === "QUESTION" && reading.question.kind === "ask_amount" && reading.question.payee.id === "landlord");
});

test("U02 the verified address with an amount becomes a normal pay proposal, without the model", async () => {
  const { index, landlord } = await world();
  const reading = await readMessage(index, modelMustNotRun, `pay 2 usdc to landlord at ${landlord.address}`);
  assert.ok(reading.status === "READ" && reading.by === "code" && reading.proposal.kind === "pay" && reading.proposal.amountBaseUnits === "2000000");
});

test("U02 a look-alike in a payment request is refused and nothing is paid", async () => {
  const { agent, index, landlord } = await world();
  const fake = lookalikeOf(landlord.address);
  const text = `pay landlord 5 usdc at ${fake}`;
  const reading = await readMessage(index, modelMustNotRun, text);
  if (reading.status !== "READ") return assert.fail("expected a proposal");
  const outcome = await agent.handle(message(text), reading.proposal);
  assert.equal(outcome.verdict === "REFUSED" && outcome.reason, "LOOKALIKE_ADDRESS");
});

test("U02 a new address in a payment request is saved as said, not proven; the verified address stays", async () => {
  const { agent, index, landlord } = await world();
  const next = wallet().address;
  const text = `pay landlord 5 usdc at ${next}`;
  const reading = await readMessage(index, modelMustNotRun, text);
  if (reading.status !== "READ") return assert.fail("expected a proposal");
  const outcome = await agent.handle(message(text), reading.proposal);
  assert.equal(outcome.verdict, "CHANGE_STARTED");
  const head = await agent.payeeHead("landlord");
  assert.equal(head.kind === "verified" && head.version.address, landlord.address);
});

test("U02 when the model finds nothing in a message that looks like a payment, the reply says what was understood", async () => {
  const { index } = await world();
  const reading = await readMessage(index, modelSays({ kind: "none" }), "pay plumber 5");
  assert.ok(reading.status === "QUESTION" && reading.question.kind === "no_payee");
  assert.deepEqual(reading.status === "QUESTION" && [...reading.payeeNames].sort(), ["Designer", "Landlord"]);
  const zero = await readMessage(index, modelSays({ kind: "none" }), "pay landlord 0");
  assert.ok(zero.status === "QUESTION" && zero.question.kind === "ask_amount");
});

test("U02 a model outage stays UNKNOWN even for a message that looks like a payment", async () => {
  const { index } = await world();
  const reading = await readMessage(index, async () => ({ provider: "groq", status: "UNKNOWN", problem: "UNAVAILABLE", httpStatus: 503, attempts: 1 }), "pay landlord 5 tomorrow");
  assert.equal(reading.status, "UNKNOWN");
});

async function lab() {
  const { session } = await new LabSessions().open(null);
  const real = session.view().payees.find((p) => p.id === "landlord")?.payableAddress ?? "";
  return { session, real };
}

test("U03 the demo answers the reported message with how much, not with nothing to do", async () => {
  const { session, real } = await lab();
  const reply = await session.scam("landlord", `pay rent to landlord at ${real}`);
  assert.ok(reply.answer?.kind === "ask_amount");
  assert.equal(reply.answer.question, "How much should I pay Landlord?");
  assert.equal(reply.answer.address, real);
  assert.ok(reply.answer.amounts.length > 0);
  assert.equal(reply.view.activity[0]?.verdict, "ASK_AMOUNT");
});

test("U03 the demo previews a stated amount and sends nothing until asked", async () => {
  const { session, real } = await lab();
  const reply = await session.scam("landlord", `pay 2 usdc to landlord at ${real}`);
  assert.ok(reply.answer?.kind === "preview" && reply.answer.amount === "2.00" && reply.answer.address === real);
  assert.equal(reply.outcome.verdict, "NONE");
  const paid = await session.pay("landlord", "2000000");
  assert.ok(paid.outcome.verdict === "PAY_RESERVED" && paid.outcome.address === real && paid.outcome.amountBaseUnits === 2_000_000n);
});

test("U03 the demo refuses a look-alike and saves a new address as said, not proven", async () => {
  const { session, real } = await lab();
  const fake = `0x${real.slice(2, 6)}${"cd".repeat(28)}${real.slice(-4)}`;
  const refused = await session.scam("landlord", `pay landlord 5 usdc at ${fake}`);
  assert.equal(refused.outcome.verdict === "REFUSED" && refused.outcome.reason, "LOOKALIKE_ADDRESS");
  const said = await session.scam("landlord", `pay landlord 5 usdc at ${OTHER}`);
  assert.equal(said.outcome.verdict, "CHANGE_STARTED");
  assert.match(said.note ?? "", /Saved as said, not proven/);
  assert.equal(said.view.payees.find((p) => p.id === "landlord")?.payableAddress, real);
});

test("U03 a demo message with no payment in it invents no amount and says what happened", async () => {
  const { session } = await lab();
  const reply = await session.scam("landlord", "thanks for lunch");
  assert.equal(reply.outcome.verdict, "NONE");
  assert.match(reply.note ?? "", /No payment or address change/);
  assert.equal(reply.view.activity[0]?.verdict, "NONE");
});
