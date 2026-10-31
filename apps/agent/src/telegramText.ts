import { REASONS, formatUsdc, type Outcome, type ReceiptRecord, type SeenElsewhere, type SuiAddress } from "@countersign/core";
import { groupAddress } from "@countersign/web/addressGroups";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

export function groupedHtml(address: string, against?: string): string {
  const grouped = groupAddress(address, against ? { against } : {});
  return grouped.groups.map((g) => (g.mark === "diff" ? `<b><u>${escapeHtml(g.text)}</u></b>` : escapeHtml(g.text))).join(" ");
}

export const READING_REPLY = "Reading this. Nothing has been sent or changed yet.";

export function confirmPaymentHtml(name: string, address: SuiAddress, amountBaseUnits: bigint, network: "mainnet" | "testnet"): string {
  const where = network === "mainnet" ? "Sui mainnet" : "Sui testnet (test USDC, no real money)";
  return [`Pay <b>${formatUsdc(amountBaseUnits)} USDC</b> to <b>${escapeHtml(name)}</b> on ${where}?`, "", "It will go to this verified address, and nowhere else:", groupedHtml(address), "", "Nothing has been sent yet."].join("\n");
}

export const REFUSED_HEADLINE = "Refused. Nothing was sent and nothing was changed.";
const ALREADY_SAID = /^(Nothing was (sent|changed|added|decided)( and nothing was changed)?\.\s*)+/;

function receiptLink(id: string, publicUrl: string | null): string {
  if (!publicUrl) return escapeHtml(id);
  const url = escapeHtml(`${publicUrl}/r/${id}`);
  return `<a href="${url}">${url}</a>`;
}

export function seenWords(seen: SeenElsewhere): string {
  return `Refused by ${seen.agents} other Countersign agent${seen.agents === 1 ? "" : "s"}; the first was their receipt ${seen.firstReceipt}.`;
}

export function refusalHtml(outcome: Extract<Outcome, { verdict: "REFUSED" }>, receipt: ReceiptRecord | null, verifiedAddress: SuiAddress | null, publicUrl: string | null): string {
  const info = REASONS[outcome.reason];
  const lines = [`<b>${REFUSED_HEADLINE}</b>`, ...[info.message, info.nextAction].map((text) => text.replace(ALREADY_SAID, "")).filter(Boolean).map(escapeHtml)];
  if (receipt?.address && verifiedAddress && receipt.address !== verifiedAddress && (outcome.reason === "LOOKALIKE_ADDRESS" || outcome.reason === "KNOWN_ATTACK_PATTERN")) {
    lines.push("", "Address in the message (differing groups underlined):", groupedHtml(receipt.address, verifiedAddress), "", "Verified address:", groupedHtml(verifiedAddress));
  }
  if (outcome.cites) lines.push("", `First refused here: ${receiptLink(outcome.cites, publicUrl)}`);
  if (outcome.seenElsewhere) lines.push("", escapeHtml(seenWords(outcome.seenElsewhere)));
  lines.push("", `Receipt: ${receiptLink(outcome.receipt, publicUrl)}`);
  return lines.join("\n");
}

export function changeStartedHtml(outcome: Extract<Outcome, { verdict: "CHANGE_STARTED" }>, signUrl: string): string {
  return [
    "Nothing was sent and nothing was changed yet.",
    "The new address is kept as <b>stated</b>: it can't be paid until the payee's current wallet signs the change (or you confirm it in the owner app and the waiting period ends), and the new wallet proves control.",
    "",
    "Requested address:",
    groupedHtml(outcome.toAddress, outcome.fromAddress),
    "",
    `Signing link for the payee: ${escapeHtml(signUrl)}`,
    `It expires ${escapeHtml(outcome.expires)}.`,
  ].join("\n");
}

export function loginCodeText(code: string): string {
  return `Your owner app code: ${code}\nIt works once, for 10 minutes. Nothing else changes.`;
}
