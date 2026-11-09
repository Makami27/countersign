import { formatUsdc } from "@countersign/core";
import { addressEl, copyButton, h, usdc } from "../dom.ts";
import type { Overview } from "../types.ts";
import { AGENT_WALLET_HEADING, AGENT_WALLET_LINE, DEPOSIT_SHORT, formatSui, lowBalances } from "../walletFacts.ts";

function usdcFigure(overview: Overview): HTMLElement {
  const balances = overview.balances;
  const test = overview.network === "testnet" ? "test " : "";
  const amount = balances.status === "KNOWN" ? formatUsdc(BigInt(balances.usdcBaseUnits)) : "—";
  return h("p", { class: "wallet-figure" }, h("span", { class: "amount" }, amount), h("span", { class: "unit" }, `${test}USDC`));
}

function suiFigure(overview: Overview): HTMLElement | null {
  const balances = overview.balances;
  if (balances.status !== "KNOWN") return h("p", { class: "money wallet-unknown" }, `Balance not known right now: ${balances.detail}. Nothing is paid while the chain doesn't answer.`);
  const test = overview.network === "testnet" ? "test " : "";
  return h("p", { class: "wallet-figure small wallet-extra" }, h("span", { class: "amount" }, formatSui(balances.suiBaseUnits)), h("span", { class: "unit" }, `${test}SUI for network fees`));
}

function warnings(overview: Overview): HTMLElement | null {
  const balances = overview.balances;
  if (balances.status !== "KNOWN") return null;
  const low = lowBalances(balances.usdcBaseUnits, balances.suiBaseUnits, overview.nextScheduled);
  if (low.length === 0) return null;
  return h("div", { class: "outcome stated warning wallet-low", role: "note" }, ...low.map((item) => h("p", {}, item.coin === "USDC"
    ? `Low on USDC: the next scheduled payment to ${item.payeeId ?? "a payee"} needs ${usdc(item.neededBaseUnits)}. It won't be sent until the agent wallet holds that much.`
    : `Low on SUI: below ${formatSui(item.neededBaseUnits)} SUI the agent wallet may not be able to pay network fees.`)));
}

export function agentWalletBlock(overview: Overview, onDeposit: () => void): HTMLElement {
  const copy = copyButton(overview.agentAddress, "Copy address");
  copy.classList.add("wallet-extra");
  return h("section", { class: "wallet-block", "aria-labelledby": "wallet-title" },
    h("h2", { id: "wallet-title" }, AGENT_WALLET_HEADING),
    usdcFigure(overview),
    h("p", { class: "note wallet-extra wallet-line" }, AGENT_WALLET_LINE),
    suiFigure(overview),
    h("p", { class: "wallet-extra wallet-address" }, h("span", { class: "label" }, "Its address "), addressEl(overview.agentAddress, { short: true })),
    h("div", { class: "actions wallet-actions" },
      h("button", { class: "btn primary", type: "button", "data-key": "deposit", onclick: onDeposit }, DEPOSIT_SHORT),
      copy),
    warnings(overview));
}
