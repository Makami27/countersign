import { addressEl, h, networkWords, usdc } from "../dom.ts";
import { ownerWalletPanel } from "./ownerWallet.ts";
import type { Overview } from "../types.ts";
import { AGENT_WALLET_FULL, FAUCETS } from "../walletFacts.ts";

type Fact = HTMLElement | "";

function fact(term: string, ...detail: (HTMLElement | string)[]): HTMLElement {
  return h("div", {}, h("dt", {}, term), h("dd", {}, ...detail));
}

export function walletFacts(overview: Overview): Fact[] {
  const balances = overview.balances.status === "KNOWN"
    ? `${usdc(overview.balances.usdcBaseUnits)} and ${(Number(overview.balances.suiBaseUnits) / 1e9).toFixed(4)} SUI for fees`
    : `— (${overview.balances.detail})`;
  return [
    fact(AGENT_WALLET_FULL, addressEl(overview.agentAddress)),
    fact("Network", networkWords(overview.network)),
    fact("Balance", balances),
    overview.network === "testnet" ? fact("Fund it", "Paste the agent wallet's address above into a faucet: ", h("a", { href: FAUCETS[0].href, target: "_blank", rel: "noreferrer" }, FAUCETS[0].label), " and ", h("a", { href: FAUCETS[1].href, target: "_blank", rel: "noreferrer" }, FAUCETS[1].label), ". Nothing is granted automatically.") : "",
  ];
}

export function memoryFact(overview: Overview): HTMLElement {
  const memory = overview.memory.relayer.startsWith("sandbox")
    ? "Sandbox memory for local checks. Nothing is stored on Walrus Memory."
    : overview.memory.restored
    ? `Read completely from Walrus Memory (${overview.memory.relayer}). ${overview.memoryCounts ? `${overview.memoryCounts.realUseMemories} memories from real use.` : `Memory count — (${overview.memoryCountsWhy ?? "not available"}).`}`
    : "Not read completely. Payments are blocked until it is.";
  return fact("Walrus Memory", memory);
}

export function capsFact(overview: Overview): HTMLElement {
  return fact("Caps", `${usdc(overview.caps.perPaymentBaseUnits)} per payment, ${usdc(overview.caps.perDayBaseUnits)} per day (${usdc(overview.caps.usedTodayBaseUnits)} used today)`);
}

export function factList(...facts: Fact[]): HTMLElement {
  return h("dl", { class: "facts" }, ...facts);
}

export function firstRun(overview: Overview, onChanged: () => void, onAdd: () => void): HTMLElement {
  const facts = factList(fact("Network", networkWords(overview.network)), memoryFact(overview), capsFact(overview));
  if (overview.ownerWallet.known && !overview.ownerWallet.current) return h("section", { class: "narrow", "aria-labelledby": "first-title" }, h("h1", { id: "first-title" }, "Your agent is ready"), ownerWalletPanel(overview, onChanged), h("div", { class: "card" }, facts));
  return h("section", { class: "narrow", "aria-labelledby": "first-title" },
    h("h1", { id: "first-title" }, "Your agent is ready"),
    h("p", {}, "Add your first payee. They get a link to prove the address is theirs, and only then can your agent wallet pay it."),
    h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: onAdd }, "Add a payee")),
    facts);
}
