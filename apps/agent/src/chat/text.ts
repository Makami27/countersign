import { REASONS, formatUsdc, type Outcome, type ReceiptRecord, type SeenElsewhere, type SuiAddress } from "@countersign/core";
import { amountQuestion, questionWords, type PaymentQuestion } from "@countersign/web/paymentReading";
import { grouped, type Format } from "./format.ts";

export const READING_REPLY = "Reading this. Nothing has been sent or changed yet.";
export const REFUSED_HEADLINE = "Refused. Nothing was sent and nothing was changed.";
const ALREADY_SAID = /^(Nothing was (sent|changed|added|decided)( and nothing was changed)?\.\s*)+/;

export function confirmPaymentText(f: Format, name: string, address: SuiAddress, amountBaseUnits: bigint, network: "mainnet" | "testnet"): string {
  const where = network === "mainnet" ? "Sui mainnet" : "Sui testnet (test USDC, no real money)";
  return [`Pay ${f.bold(`${formatUsdc(amountBaseUnits)} USDC`)} to ${f.bold(f.escape(name))} on ${f.escape(where)}?`, "", "It will go to this verified address, and nowhere else:", grouped(f, address), "", "Nothing has been sent yet."].join("\n");
}

function receiptLink(f: Format, id: string, publicUrl: string | null): string {
  return publicUrl ? f.link(`${publicUrl}/r/${id}`) : f.escape(id);
}

export function seenWords(seen: SeenElsewhere): string {
  return `Refused by ${seen.agents} other Countersign agent${seen.agents === 1 ? "" : "s"}; the first was their receipt ${seen.firstReceipt}.`;
}

export function refusalText(f: Format, outcome: Extract<Outcome, { verdict: "REFUSED" }>, receipt: ReceiptRecord | null, verifiedAddress: SuiAddress | null, publicUrl: string | null): string {
  const info = REASONS[outcome.reason];
  const lines = [f.bold(f.escape(REFUSED_HEADLINE)), ...[info.message, info.nextAction].map((text) => text.replace(ALREADY_SAID, "")).filter(Boolean).map(f.escape)];
  if (receipt?.address && verifiedAddress && receipt.address !== verifiedAddress && (outcome.reason === "LOOKALIKE_ADDRESS" || outcome.reason === "KNOWN_ATTACK_PATTERN")) {
    lines.push("", "Address in the message (differing groups underlined):", grouped(f, receipt.address, verifiedAddress), "", "Verified address:", grouped(f, verifiedAddress));
  }
  if (outcome.cites) lines.push("", `First refused here: ${receiptLink(f, outcome.cites, publicUrl)}`);
  if (outcome.seenElsewhere) lines.push("", f.escape(seenWords(outcome.seenElsewhere)));
  lines.push("", `Receipt: ${receiptLink(f, outcome.receipt, publicUrl)}`);
  return lines.join("\n");
}

export function questionText(f: Format, question: PaymentQuestion, payeeNames: readonly string[], publicUrl: string | null, amountHint: string): string {
  if (question.kind !== "ask_amount") return f.escape(questionWords(question, payeeNames).replace("the owner app", publicUrl ? `the owner app (${publicUrl}/app)` : "the owner app"));
  return [f.bold(f.escape(amountQuestion(question.payee.name))), f.escape(`Nothing was sent. ${amountHint} It goes to this verified address, and nowhere else:`), grouped(f, question.verified)].join("\n");
}

export function changeStartedText(f: Format, outcome: Extract<Outcome, { verdict: "CHANGE_STARTED" }>, signUrl: string): string {
  return [
    `${f.bold("Saved as said, not proven.")} Nothing was sent, and payments still go to the verified address.`,
    f.escape("The new address can't be paid until the payee's current wallet signs the change (or you confirm it in the owner app and the waiting period ends), and the new wallet proves control."),
    "",
    "Requested address:",
    grouped(f, outcome.toAddress, outcome.fromAddress),
    "",
    `Signing link for the payee: ${f.url(signUrl)}`,
    `It expires ${f.escape(outcome.expires)}.`,
  ].join("\n");
}
