import type { Outcome, ReceiptRecord, SuiAddress } from "@countersign/core";
import type { PaymentQuestion } from "@countersign/web/paymentReading";
import { GOOGLE_WORDS } from "@countersign/web/walletFacts";
import { HTML_FORMAT, grouped } from "./chat/format.ts";
import { changeStartedText, confirmPaymentText, questionText, refusalText } from "./chat/text.ts";
import { TELEGRAM_WORDS } from "./commands.ts";

export { READING_REPLY, REFUSED_HEADLINE, seenWords } from "./chat/text.ts";

export const escapeHtml = HTML_FORMAT.escape;

export function groupedHtml(address: string, against?: string): string {
  return grouped(HTML_FORMAT, address, against);
}

export function confirmPaymentHtml(name: string, address: SuiAddress, amountBaseUnits: bigint, network: "mainnet" | "testnet"): string {
  return confirmPaymentText(HTML_FORMAT, name, address, amountBaseUnits, network);
}

export function refusalHtml(outcome: Extract<Outcome, { verdict: "REFUSED" }>, receipt: ReceiptRecord | null, verifiedAddress: SuiAddress | null, publicUrl: string | null): string {
  return refusalText(HTML_FORMAT, outcome, receipt, verifiedAddress, publicUrl);
}

export function questionHtml(question: PaymentQuestion, payeeNames: readonly string[], publicUrl: string | null): string {
  return questionText(HTML_FORMAT, question, payeeNames, publicUrl, TELEGRAM_WORDS.amountHint);
}

export function changeStartedHtml(outcome: Extract<Outcome, { verdict: "CHANGE_STARTED" }>, signUrl: string): string {
  return changeStartedText(HTML_FORMAT, outcome, signUrl);
}

export function signInLinkText(publicUrl: string | null): string {
  return `Sign in to your owner app: ${publicUrl ?? ""}/app/login\nContinue with Google. ${GOOGLE_WORDS}`;
}

export function unlinkedText(publicUrl: string | null): string {
  return `This chat isn't connected to a Countersign agent. Sign in at ${publicUrl ?? ""}/app and connect Telegram there. Nothing was stored.`;
}
