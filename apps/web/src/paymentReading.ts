import { addressesIn, usdcToBaseUnits, type SuiAddress } from "@countersign/core";

export type KnownPayee = { readonly id: string; readonly name: string; readonly verified: SuiAddress | null };

export type PaymentReading =
  | { readonly kind: "pay"; readonly payee: KnownPayee; readonly verified: SuiAddress; readonly amountBaseUnits: string }
  | { readonly kind: "ask_amount"; readonly payee: KnownPayee; readonly verified: SuiAddress }
  | { readonly kind: "change"; readonly payee: KnownPayee; readonly address: SuiAddress }
  | { readonly kind: "not_payable"; readonly payee: KnownPayee }
  | { readonly kind: "no_payee"; readonly address: SuiAddress | null };

export type PaymentQuestion = Extract<PaymentReading, { kind: "ask_amount" | "not_payable" | "no_payee" }>;

const PAYMENT_WORDS = /\b(?:pay|paying|send|sending|transfer|wire|remit|settle|payment)\b/i;
const NOT_A_REQUEST = /\b(?:don'?t|do not|never|stop|cancel|didn'?t)\b/i;
const ANY_ADDRESS = /0x[0-9a-f]{64}/gi;
const NUMBER = String.raw`(\d+(?:\.\d{1,6})?)`;
const WITH_CURRENCY = new RegExp(String.raw`\$\s*${NUMBER}(?![\d.])|(?<![\d.])${NUMBER}\s*(?:usdc|usd|dollars?)\b`, "gi");
const AFTER_VERB = new RegExp(String.raw`\b(?:pay|send|transfer|wire|remit)\s+${NUMBER}(?![\d.])`, "i");

export function looksLikePayment(text: string): boolean {
  return PAYMENT_WORDS.test(text) && !NOT_A_REQUEST.test(text);
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namePattern(word: string): string {
  return `(?<![a-z0-9])${escaped(word.toLowerCase()).replace(/[-\s]+/g, "[-\\s]+")}(?![a-z0-9])`;
}

function isNamed(text: string, payee: KnownPayee): boolean {
  return [payee.name, payee.id].some((word) => new RegExp(namePattern(word)).test(text));
}

export function amountIn(text: string, payee: KnownPayee | null): string | null {
  const plain = text.replace(ANY_ADDRESS, " ");
  const stated = new Set([...plain.matchAll(WITH_CURRENCY)].map((m) => m[1] ?? m[2] ?? ""));
  if (stated.size > 1) return null;
  const afterName = payee ? new RegExp(`${namePattern(payee.name)}\\s+${NUMBER}(?![\\d.])`).exec(plain.toLowerCase()) : null;
  const amount = [...stated][0] ?? AFTER_VERB.exec(plain)?.[1] ?? afterName?.[1];
  return amount ? usdcToBaseUnits(amount) : null;
}

export function readPayment(text: string, payees: readonly KnownPayee[], defaultPayeeId: string | null = null): PaymentReading | null {
  const found = addressesIn(text);
  const onFile = payees.filter((p) => p.verified !== null && found.includes(p.verified));
  if (!looksLikePayment(text) && onFile.length === 0) return null;
  const lowered = text.toLowerCase();
  const named = payees.filter((p) => isNamed(lowered, p));
  const payee = (named.length === 1 ? named[0] : undefined) ?? (onFile.length === 1 ? onFile[0] : undefined) ?? payees.find((p) => p.id === defaultPayeeId);
  if (!payee) return { kind: "no_payee", address: found[0] ?? null };
  if (!payee.verified) return { kind: "not_payable", payee };
  const other = found.find((address) => address !== payee.verified);
  if (other) return { kind: "change", payee, address: other };
  const amountBaseUnits = amountIn(text, payee);
  return amountBaseUnits ? { kind: "pay", payee, verified: payee.verified, amountBaseUnits } : { kind: "ask_amount", payee, verified: payee.verified };
}

export { quickAmounts } from "../client/walletFacts.ts";

export function amountQuestion(name: string): string {
  return `How much should I pay ${name}?`;
}

export function questionWords(question: PaymentQuestion, payeeNames: readonly string[]): string {
  if (question.kind === "ask_amount") return `This reads as a payment to ${question.payee.name}, with no amount. Nothing was sent. It would go to their verified address.`;
  if (question.kind === "not_payable") return `${question.payee.name} can't be paid yet: their address is waiting for the payee's wallet to sign. Nothing was sent. Send them the signing link from the owner app.`;
  const known = payeeNames.length > 0 ? ` Your payees: ${payeeNames.join(", ")}.` : " You have no payees yet.";
  return question.address
    ? `This reads as a payment to an address that isn't one of your payees. Nothing was sent and nothing was saved.${known} To pay someone new, add them as a payee; their wallet has to sign first.`
    : `This reads as a payment, but it doesn't name one of your payees. Nothing was sent.${known} Name the payee, or add them in the owner app.`;
}

export const SAID_NOT_PROVEN = "Saved as said, not proven";

export function saidNotProvenWords(name: string): string {
  return `${SAID_NOT_PROVEN}. Nothing was sent. Payments still go to ${name}'s verified address. The new address can't be paid until the payee's current wallet signs the change (or you confirm it and the waiting period ends) and the new wallet proves control.`;
}

export const NOTHING_ASKED = "No payment or address change in this message. Nothing was sent and nothing was changed.";
