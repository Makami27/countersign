import { formatUsdc } from "@countersign/core";
import { addressEl, copyButton, h, usdc } from "../dom.ts";
import type { Overview } from "../types.ts";
import { AGENT_WALLET, DEPOSIT_ACTION, YOUR_WALLET, formatSui, lowBalances } from "../walletFacts.ts";

function figures(overview: Overview): HTMLElement {
  const balances = overview.balances;
  if (balances.status !== "KNOWN") return h("div", { class: "wallet-figures" }, h("p", { class: "wallet-figure" }, h("span", { class: "amount" }, "—"), h("span", { class: "unit" }, "USDC")), h("p", { class: "money" }, `Balance not known right now: ${balances.detail}. Nothing is paid while the chain doesn't answer.`));
  const test = overview.network === "testnet" ? "test " : "";
  return h("div", { class: "wallet-figures" },
    h("p", { class: "wallet-figure" }, h("span", { class: "amount" }, formatUsdc(BigInt(balances.usdcBaseUnits))), h("span", { class: "unit" }, `${test}USDC`)),
    h("p", { class: "wallet-figure small" }, h("span", { class: "amount" }, formatSui(balances.suiBaseUnits)), h("span", { class: "unit" }, `${test}SUI for network fees`)));
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

function yourWallet(overview: Overview): HTMLElement {
  const state = overview.ownerWallet;
  return h("p", { class: "wallet-yours note" }, YOUR_WALLET, state.known && state.current ? " " : "", state.known && state.current ? addressEl(state.current.address, { short: true }) : "");
}

export function agentWalletPanel(overview: Overview, onDeposit: () => void): HTMLElement {
  return h("section", { class: "wallet-panel", "aria-labelledby": "wallet-title" },
    h("div", { class: "wallet-main" },
      h("h2", { id: "wallet-title" }, AGENT_WALLET, h("span", { class: "fund" }, " (fund this one)")),
      figures(overview)),
    h("div", { class: "wallet-side" },
      h("div", { class: "wallet-address" }, h("span", { class: "label" }, "Its address on Sui"), addressEl(overview.agentAddress)),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", type: "button", onclick: onDeposit }, DEPOSIT_ACTION),
        copyButton(overview.agentAddress, "Copy address"))),
    warnings(overview),
    yourWallet(overview));
}
