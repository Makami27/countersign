import { REASONS, type ReasonCode } from "@countersign/core";
import { addressEl, dayGroupsEl, h, usdc } from "../dom.ts";
import { clockTime } from "../dayGroups.ts";
import type { ActivityItem } from "../types.ts";

const VERDICT_WORDS: Record<string, string> = {
  PAID: "Paid", PAYMENT_FAILED: "Not paid", REFUSED: "Refused", CHANGE_VERIFIED: "Address verified", CHANGE_REJECTED: "Change refused",
};

function reasonWords(reason: string | null): string {
  return reason && reason in REASONS ? ` ${REASONS[reason as ReasonCode].message}` : "";
}

function suiscan(network: string, digest: string): string {
  return `https://suiscan.xyz/${encodeURIComponent(network)}/tx/${encodeURIComponent(digest)}`;
}

export const MISSED_NOTICE = "Discord couldn't deliver this notice by DM:";

function moneySentence(item: ActivityItem): string {
  if (item.kind === "notice") return `${MISSED_NOTICE} ${item.text}`;
  if (item.kind === "payment") return `Sending ${usdc(item.amountBaseUnits)}. Not confirmed yet. It won't be sent twice.`;
  if (item.verdict === "PAID" && item.amountBaseUnits) return `Sent ${usdc(item.amountBaseUnits)}.`;
  if (item.verdict === "CHANGE_VERIFIED") return "Nothing was sent. The payee's address is now verified.";
  return item.verdict === "PAYMENT_FAILED" ? "No USDC moved." : `Nothing was sent and nothing was changed.${reasonWords(item.reason)}`;
}

export function activityPage(items: readonly ActivityItem[], names: ReadonlyMap<string, string>, network: string): HTMLElement {
  const payee = (id: string | null) => (id && names.has(id) ? ` Payee: ${names.get(id) ?? ""}.` : "");
  const transaction = (net: string, digest: string | null) => (digest ? [", ", h("a", { href: suiscan(net, digest), target: "_blank", rel: "noopener" }, "Transaction")] : []);
  const rowOf = (item: ActivityItem) => h("li", { class: item.kind === "receipt" && (item.verdict === "REFUSED" || item.verdict === "CHANGE_REJECTED") ? "refused-row" : "" },
    h("span", { class: "v" }, item.kind === "receipt" ? (VERDICT_WORDS[item.verdict] ?? "Recorded") : item.kind === "notice" ? "Notice" : "In progress"),
    h("span", { class: "what" }, h("span", {}, `${moneySentence(item)}${item.kind === "notice" ? "" : payee(item.payeeId)}`),
      item.kind !== "notice" && item.address ? addressEl(item.address, { short: true }) : null,
      item.kind === "receipt"
        ? h("span", { class: "meta" }, `${clockTime(item.at)}, `, h("a", { href: `/r/${encodeURIComponent(item.receipt)}` }, "Receipt"), ...transaction(item.network, item.suiDigest), `, ${item.network}`)
        : item.kind === "notice" ? h("span", { class: "meta" }, clockTime(item.at))
        : h("span", { class: "meta" }, clockTime(item.at), ...transaction(network, item.digest), `, ${network}`)));
  return h("section", { class: "narrow", "aria-labelledby": "activity-title" }, h("h1", { id: "activity-title" }, "Activity"),
    h("p", { class: "lede" }, "Every payment and every refusal, newest first. Each has a receipt signed by the agent and stored on Walrus Memory."),
    items.length ? dayGroupsEl(items, (item) => item.at, "h2", rowOf) : h("p", { class: "empty" }, "Nothing yet. Pay a payee or paste a message, and it shows here."));
}
