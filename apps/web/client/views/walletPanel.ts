import { formatUsdc } from "@countersign/core";
import { addressEl, copyButton, h, networkWords, usdc } from "../dom.ts";
import type { Overview } from "../types.ts";
import { AGENT_WALLET_HEADING, AGENT_WALLET_LINE, DEPOSIT_SHORT, formatSui, lowBalances } from "../walletFacts.ts";

export type WalletActions = {
  readonly onDeposit: () => void;
  readonly onPay: () => void;
  readonly onSchedule: () => void;
};

function figure(overview: Overview): HTMLElement {
  const balances = overview.balances;
  const test = overview.network === "testnet" ? "test " : "";
  const amount = balances.status === "KNOWN" ? formatUsdc(BigInt(balances.usdcBaseUnits)) : "—";
  return h("p", { class: "band-figure" }, h("span", { class: "amount" }, amount), h("span", { class: "unit" }, `${test}USDC`));
}

function smallLine(overview: Overview): HTMLElement {
  const balances = overview.balances;
  if (balances.status !== "KNOWN") return h("p", { class: "money band-unknown" }, `Balance not known right now: ${balances.detail}. Nothing is paid while the chain doesn't answer.`);
  const test = overview.network === "testnet" ? "test " : "";
  return h("p", { class: "band-line" }, `${formatSui(balances.suiBaseUnits)} ${test}SUI for network fees · ${AGENT_WALLET_LINE}`);
}

function warnings(overview: Overview): HTMLElement | null {
  const balances = overview.balances;
  if (balances.status !== "KNOWN") return null;
  const low = lowBalances(balances.usdcBaseUnits, balances.suiBaseUnits, overview.nextScheduled);
  if (low.length === 0) return null;
  return h("div", { class: "outcome stated warning band-warning", role: "note" }, ...low.map((item) => h("p", {}, item.coin === "USDC"
    ? `Low on USDC: the next scheduled payment to ${item.payeeId ?? "a payee"} needs ${usdc(item.neededBaseUnits)}. It won't be sent until the agent wallet holds that much.`
    : `Low on SUI: below ${formatSui(item.neededBaseUnits)} SUI the agent wallet may not be able to pay network fees.`)));
}

export function balanceBand(overview: Overview, actions: WalletActions, place: "main" | "phone"): HTMLElement {
  const titleId = `wallet-title-${place}`;
  return h("section", { class: `balance-band ${place}`, "aria-labelledby": titleId },
    h("div", { class: "band-head" }, h("h2", { id: titleId }, AGENT_WALLET_HEADING), addressEl(overview.agentAddress, { short: true }), place === "main" ? h("span", { class: "band-net" }, networkWords(overview.network)) : null),
    figure(overview),
    smallLine(overview),
    h("div", { class: "band-actions" },
      h("button", { class: "btn primary", type: "button", "data-key": `deposit-${place}`, onclick: actions.onDeposit }, DEPOSIT_SHORT),
      copyButton(overview.agentAddress, "Copy address"),
      h("button", { class: "btn", type: "button", "data-key": `pay-${place}`, onclick: actions.onPay }, "Pay"),
      h("button", { class: "btn", type: "button", "data-key": `schedule-${place}`, onclick: actions.onSchedule }, "Schedule")),
    warnings(overview));
}
