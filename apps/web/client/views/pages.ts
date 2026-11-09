import { REASONS, formatUsdc, usdcToBaseUnits, type ReasonCode } from "@countersign/core";
import { api } from "../api.ts";
import { withApprovals } from "../approvals.ts";
import { ownerWalletPanel } from "./ownerWallet.ts";
import { addressEl, dayGroupsEl, h, liveRegion, usdc, listen } from "../dom.ts";
import { clockTime } from "../dayGroups.ts";
import type { ActivityItem, Overview } from "../types.ts";
import { agentFacts } from "./firstRun.ts";
import { telegramPanel } from "./telegramPanel.ts";
import { discordPanel } from "./discordPanel.ts";
import { soundToggle } from "../moment.ts";
import { carryNotice, showCarried } from "../carriedNotice.ts";

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

export function settingsPage(overview: Overview, onSaved: () => void): HTMLElement {
  const perPayment = h("input", { id: "cap-payment", inputmode: "decimal", value: formatUsdc(BigInt(overview.caps.perPaymentBaseUnits)) });
  const perDay = h("input", { id: "cap-day", inputmode: "decimal", value: formatUsdc(BigInt(overview.caps.perDayBaseUnits)) });
  const cooldown = h("input", { id: "cooldown", inputmode: "numeric", value: String(Number((overview.cooldownSeconds / 3600).toFixed(4))) });
  const status = liveRegion();
  showCarried("settings", status);
  const form = h("form", {}, h("label", { for: "cap-payment" }, "Per-payment cap (USDC)", h("span", { class: "hint" }, "The agent refuses any single payment above this."), perPayment),
    h("label", { for: "cap-day" }, "Daily cap (USDC)", h("span", { class: "hint" }, "The most it can pay in total each day."), perDay),
    h("label", { for: "cooldown" }, "Waiting period (hours)", h("span", { class: "hint" }, "When a payee can't sign with their old wallet and you approve the new one yourself, payments to it wait this long. Default 24."), cooldown), status,
    h("p", { class: "hint" }, "Raising a limit asks your wallet to sign. Lowering it doesn't."),
    h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Save settings")));
  listen(form, "submit", async (event) => {
    event.preventDefault();
    const perPaymentBaseUnits = usdcToBaseUnits(perPayment.value.trim());
    const perDayBaseUnits = usdcToBaseUnits(perDay.value.trim());
    if (!perPaymentBaseUnits || !perDayBaseUnits) return void (status.textContent = "Give each cap in USDC, for example 25 or 0.50. Nothing was changed.");
    if (!/^\d+(\.\d+)?$/.test(cooldown.value.trim())) return void (status.textContent = "Give the waiting period in hours, for example 24. Nothing was changed.");
    const result = await withApprovals("PUT", "/api/app/settings", { perPaymentBaseUnits, perDayBaseUnits, cooldownSeconds: String(Math.round(Number(cooldown.value.trim()) * 3600)) }, overview.network, status);
    if (!result.ok) return void (status.textContent = result.error.message);
    carryNotice("settings", "Saved. New limits apply from the next payment.");
    onSaved();
  }, status);
  const signOut = h("button", { class: "btn", type: "button" }, "Sign out");
  listen(signOut, "click", async () => {
    await api("DELETE", "/api/session");
    location.assign("/app/login");
  }, status);
  return h("section", { class: "narrow", "aria-labelledby": "settings-title" }, h("h1", { id: "settings-title" }, "Settings"), agentFacts(overview), ownerWalletPanel(overview, onSaved), telegramPanel(), discordPanel(), form,
    overview.cooldownSeconds < 24 * 3600 ? h("p", { class: "netlabel" }, `Demo value: changes you confirm yourself wait ${Math.round(overview.cooldownSeconds / 60)} minutes, not 24 hours.`) : null,
    h("div", { class: "actions" }, soundToggle("btn"), signOut));
}

