import { formatUsdc, usdcToBaseUnits } from "@countersign/core";
import { api } from "../api.ts";
import { withApprovals } from "../approvals.ts";
import { ownerWalletPanel } from "./ownerWallet.ts";
import { addressEl, h, liveRegion, usdc, when, listen } from "../dom.ts";
import type { ActivityItem, Overview } from "../types.ts";
import { agentFacts } from "./firstRun.ts";

const VERDICT_WORDS: Record<string, string> = {
  PAID: "Paid", PAYMENT_FAILED: "Not paid", REFUSED: "Refused", CHANGE_VERIFIED: "Address verified", CHANGE_REJECTED: "Change refused",
};

function moneySentence(item: ActivityItem): string {
  if (item.kind === "payment") return `Sending ${usdc(item.amountBaseUnits)}: ${item.state === "UNKNOWN" ? "outcome not known yet; it will not be sent again." : "in progress."}`;
  if (item.verdict === "PAID" && item.amountBaseUnits) return `Sent ${usdc(item.amountBaseUnits)}.`;
  if (item.verdict === "CHANGE_VERIFIED") return "Nothing was sent. The payee's address is now verified.";
  return item.verdict === "PAYMENT_FAILED" ? "No USDC moved." : "Nothing was sent and nothing was changed.";
}

export function activityPage(items: readonly ActivityItem[]): HTMLElement {
  const rows = items.map((item) => h("li", { class: item.kind === "receipt" && (item.verdict === "REFUSED" || item.verdict === "CHANGE_REJECTED") ? "refused-row" : "" },
    h("span", { class: "v" }, item.kind === "receipt" ? (VERDICT_WORDS[item.verdict] ?? item.verdict) : "Open"),
    h("span", { class: "what" }, h("span", {}, `${moneySentence(item)} ${item.payeeId ? `Payee ${item.payeeId}.` : ""}`),
      item.address ? addressEl(item.address, { short: true }) : null,
      h("span", { class: "meta" }, `${when(item.at)}${item.kind === "receipt" ? `, receipt ${item.receipt}${item.suiDigest ? `, transaction ${item.suiDigest}` : ""}, ${item.network}` : ""}`))));
  return h("section", { class: "narrow", "aria-labelledby": "activity-title" }, h("h1", { id: "activity-title" }, "Activity"),
    h("p", { class: "lede" }, "Every payment and every refusal, newest first. Each has a receipt signed by the agent and stored on Walrus Memory."),
    rows.length ? h("ol", { class: "rows" }, ...rows) : h("p", { class: "empty" }, "Nothing has happened yet. Payments and refusals will appear here."));
}

export function settingsPage(overview: Overview, onSaved: () => void): HTMLElement {
  const perPayment = h("input", { id: "cap-payment", inputmode: "decimal", value: formatUsdc(BigInt(overview.caps.perPaymentBaseUnits)) });
  const perDay = h("input", { id: "cap-day", inputmode: "decimal", value: formatUsdc(BigInt(overview.caps.perDayBaseUnits)) });
  const cooldown = h("input", { id: "cooldown", inputmode: "numeric", value: String(Number((overview.cooldownSeconds / 3600).toFixed(4))) });
  const status = liveRegion();
  const form = h("form", {}, h("label", { for: "cap-payment" }, "Per-payment cap (USDC)", perPayment), h("label", { for: "cap-day" }, "Daily cap (USDC)", perDay),
    h("label", { for: "cooldown" }, "Waiting period for changes you confirm yourself (hours)", h("span", { class: "hint" }, "Default 24. A shorter value is for demos and is shown as such."), cooldown), status,
    h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Save settings")));
  listen(form, "submit", async (event) => {
    event.preventDefault();
    const perPaymentBaseUnits = usdcToBaseUnits(perPayment.value.trim());
    const perDayBaseUnits = usdcToBaseUnits(perDay.value.trim());
    if (!perPaymentBaseUnits || !perDayBaseUnits) return void (status.textContent = "Give each cap in USDC, for example 25 or 0.50. Nothing was changed.");
    if (!/^\d+(\.\d+)?$/.test(cooldown.value.trim())) return void (status.textContent = "Give the waiting period in hours, for example 24. Nothing was changed.");
    const result = await withApprovals("PUT", "/api/app/settings", { perPaymentBaseUnits, perDayBaseUnits, cooldownSeconds: String(Math.round(Number(cooldown.value.trim()) * 3600)) }, overview.network, status);
    status.textContent = result.ok ? "Saved. The agent uses the new caps from the next payment." : result.error.message;
    if (result.ok) onSaved();
  }, status);
  const signOut = h("button", { class: "btn", type: "button" }, "Sign out");
  listen(signOut, "click", async () => {
    await api("DELETE", "/api/session");
    location.assign("/app/login");
  }, status);
  return h("section", { class: "narrow", "aria-labelledby": "settings-title" }, h("h1", { id: "settings-title" }, "Settings"), agentFacts(overview), ownerWalletPanel(overview, onSaved), form,
    overview.cooldownSeconds < 24 * 3600 ? h("p", { class: "netlabel" }, `Demo value: changes you confirm yourself wait ${Math.round(overview.cooldownSeconds / 60)} minutes, not 24 hours.`) : null,
    h("div", { class: "actions" }, signOut));
}

