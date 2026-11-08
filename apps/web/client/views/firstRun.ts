import { addressEl, h, networkWords, usdc } from "../dom.ts";
import { ownerWalletPanel } from "./ownerWallet.ts";
import type { Overview } from "../types.ts";
import { AGENT_WALLET_FULL, FAUCETS } from "../walletFacts.ts";

export function agentFacts(overview: Overview, options: { readonly walletShownAbove?: boolean } = {}): HTMLElement {
  const wallet = options.walletShownAbove !== true;
  const balances = overview.balances.status === "KNOWN"
    ? `${usdc(overview.balances.usdcBaseUnits)} and ${(Number(overview.balances.suiBaseUnits) / 1e9).toFixed(4)} SUI for fees`
    : `— (${overview.balances.detail})`;
  const memory = overview.memory.relayer.startsWith("sandbox")
    ? "Sandbox memory for local checks. Nothing is stored on Walrus Memory."
    : overview.memory.restored
    ? `Read completely from Walrus Memory (${overview.memory.relayer}). ${overview.memoryCounts ? `${overview.memoryCounts.realUseMemories} memories from real use.` : `Memory count — (${overview.memoryCountsWhy ?? "not available"}).`}`
    : "Not read completely. Payments are blocked until it is.";
  return h("dl", { class: "facts" },
    wallet ? h("div", {}, h("dt", {}, AGENT_WALLET_FULL), h("dd", {}, addressEl(overview.agentAddress))) : "",
    h("div", {}, h("dt", {}, "Network"), h("dd", {}, networkWords(overview.network))),
    wallet ? h("div", {}, h("dt", {}, "Balance"), h("dd", {}, balances)) : "",
    wallet && overview.network === "testnet" ? h("div", {}, h("dt", {}, "Fund it"), h("dd", {}, "Paste the agent wallet's address above into a faucet: ", h("a", { href: FAUCETS[0].href, target: "_blank", rel: "noreferrer" }, FAUCETS[0].label), " and ", h("a", { href: FAUCETS[1].href, target: "_blank", rel: "noreferrer" }, FAUCETS[1].label), ". Nothing is granted automatically.")) : "",
    h("div", {}, h("dt", {}, "Walrus Memory"), h("dd", {}, memory)),
    h("div", {}, h("dt", {}, "Caps"), h("dd", {}, `${usdc(overview.caps.perPaymentBaseUnits)} per payment, ${usdc(overview.caps.perDayBaseUnits)} per day (${usdc(overview.caps.usedTodayBaseUnits)} used today)`)));
}

export function firstRun(overview: Overview, onChanged: () => void): HTMLElement {
  if (overview.ownerWallet.known && !overview.ownerWallet.current) return h("div", {}, ownerWalletPanel(overview, onChanged), h("div", { class: "card" }, agentFacts(overview, { walletShownAbove: true })));
  return h("div", { class: "card" },
    h("h2", {}, "Your agent is ready"),
    h("p", {}, "Add your first payee. They get a link to prove the address is theirs, and only then can your agent wallet pay it."),
    agentFacts(overview, { walletShownAbove: true }));
}
