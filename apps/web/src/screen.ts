import { addressesIn, headOf, isLookalike, knownAttackFor, payeeIdFor, usdcToBaseUnits, type IndexStore, type Proposal } from "@countersign/core";
import type { Extraction } from "@countersign/adapters/model";
import { readPayment, type KnownPayee, type PaymentQuestion, type PaymentReading } from "./paymentReading.ts";

export type ChangeProposal = Extract<Proposal, { kind: "change_address" }>;
export type Reading =
  | { readonly status: "READ"; readonly by: "code" | "model"; readonly proposal: Proposal }
  | { readonly status: "QUESTION"; readonly question: PaymentQuestion; readonly payeeNames: readonly string[] }
  | Extract<Extraction, { status: "UNKNOWN" }>;

export async function screenAddresses(index: IndexStore, text: string): Promise<ChangeProposal | null> {
  const found = addressesIn(text);
  if (found.length === 0) return null;
  const heads = await Promise.all((await index.payeeIds()).map(async (payeeId) => ({ payeeId, head: headOf(await index.payeeVersions(payeeId)) })));
  for (const address of found) {
    const earlier = await knownAttackFor(index, address);
    if (earlier?.payeeId) return { kind: "change_address", payeeId: earlier.payeeId, newAddress: address, reasonQuote: address };
    const imitated = heads.find((h) => h.head.kind === "verified" && isLookalike(address, h.head.version.address));
    if (imitated) return { kind: "change_address", payeeId: imitated.payeeId, newAddress: address, reasonQuote: address };
  }
  return null;
}

const PAY_NAME_FIRST = /^\s*\/?(?:pay|send)\s+(?:the\s+)?(.+?)\s+(\d+(?:\.\d{1,6})?)\s*(?:usdc)?\s*[.!]?\s*$/i;
const PAY_AMOUNT_FIRST = /^\s*\/?(?:pay|send)\s+(\d+(?:\.\d{1,6})?)\s*(?:usdc)?\s+to\s+(?:the\s+)?(.+?)\s*[.!]?\s*$/i;

export function commandProposal(text: string, payeeIds: readonly string[]): Extract<Proposal, { kind: "pay" }> | null {
  if (addressesIn(text).length > 0) return null;
  const nameFirst = PAY_NAME_FIRST.exec(text);
  const amountFirst = nameFirst ? null : PAY_AMOUNT_FIRST.exec(text);
  const name = nameFirst?.[1] ?? amountFirst?.[2] ?? "";
  const amount = nameFirst?.[2] ?? amountFirst?.[1] ?? "";
  const payeeId = payeeIdFor(name);
  const amountBaseUnits = usdcToBaseUnits(amount);
  if (!payeeId || !payeeIds.includes(payeeId) || !amountBaseUnits) return null;
  return { kind: "pay", payeeId, amountBaseUnits, reasonQuote: text.trim() };
}

export async function knownPayees(index: IndexStore): Promise<readonly KnownPayee[]> {
  return Promise.all((await index.payeeIds()).map(async (id) => {
    const versions = await index.payeeVersions(id);
    const head = headOf(versions);
    const name = [...versions].sort((a, b) => b.version - a.version)[0]?.name ?? id;
    return { id, name, verified: head.kind === "verified" ? head.version.address : null };
  }));
}

function fromPayment(payment: PaymentReading, text: string, payees: readonly KnownPayee[]): Reading {
  const reasonQuote = text.trim();
  if (payment.kind === "pay") return { status: "READ", by: "code", proposal: { kind: "pay", payeeId: payment.payee.id, amountBaseUnits: payment.amountBaseUnits, reasonQuote } };
  if (payment.kind === "change") return { status: "READ", by: "code", proposal: { kind: "change_address", payeeId: payment.payee.id, newAddress: payment.address, reasonQuote } };
  return { status: "QUESTION", question: payment, payeeNames: payees.map((p) => p.name) };
}

function settledByCode(payment: PaymentReading | null, text: string): payment is PaymentReading {
  if (!payment || payment.kind === "no_payee") return false;
  return addressesIn(text).length > 0 || !/\d/.test(text);
}

export async function readMessage(index: IndexStore, extract: (text: string, payeeIds: readonly string[]) => Promise<Extraction>, text: string): Promise<Reading> {
  const screened = await screenAddresses(index, text);
  if (screened) return { status: "READ", by: "code", proposal: screened };
  const payeeIds = await index.payeeIds();
  const command = commandProposal(text, payeeIds);
  if (command) return { status: "READ", by: "code", proposal: command };
  const payees = await knownPayees(index);
  const payment = readPayment(text, payees);
  if (settledByCode(payment, text)) return fromPayment(payment, text, payees);
  const extraction = await extract(text, payeeIds);
  if (extraction.status !== "READ") return extraction;
  if (extraction.proposal.kind === "none" && payment) return fromPayment(payment, text, payees);
  return { status: "READ", by: "model", proposal: extraction.proposal };
}
