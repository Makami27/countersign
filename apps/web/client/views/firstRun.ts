import { addressEl, h, networkWords, usdc } from "../dom.ts";
import type { Overview } from "../types.ts";

export function agentFacts(overview: Overview): HTMLElement {
  const balances = overview.balances.status === "KNOWN"
    ? `${usdc(overview.balances.usdcBaseUnits)} and ${(Number(overview.balances.suiBaseUnits) / 1e9).toFixed(4)} SUI for fees`
    : "— (the balance couldn't be read just now)";
  const memory = overview.memory.relayer.startsWith("sandbox")
    ? "Sandbox memory for local checks. Nothing is stored on Walrus Memory."
    : overview.memory.restored
    ? `Read completely from Walrus Memory (${overview.memory.relayer}). ${overview.memoryCounts ? `${overview.memoryCounts.realUseMemories} memories from real use.` : "Memory count —."}`
    : "Not read completely. Payments are blocked until it is.";
  return h("dl", { class: "facts" },
    h("div", {}, h("dt", {}, "Agent wallet"), h("dd", {}, addressEl(overview.agentAddress))),
    h("div", {}, h("dt", {}, "Network"), h("dd", {}, networkWords(overview.network))),
    h("div", {}, h("dt", {}, "Balance"), h("dd", {}, balances)),
    h("div", {}, h("dt", {}, "Payee memory"), h("dd", {}, memory)),
    h("div", {}, h("dt", {}, "Caps"), h("dd", {}, `${usdc(overview.caps.perPaymentBaseUnits)} per payment, ${usdc(overview.caps.perDayBaseUnits)} per day (${usdc(overview.caps.usedTodayBaseUnits)} used today)`)));
}

export function firstRun(overview: Overview): HTMLElement {
  return h("div", { class: "card" },
    h("h2", {}, "Your agent is ready"),
    h("p", {}, "Add your first payee. They get a link to prove the address is theirs, and only then can the agent pay it."),
    agentFacts(overview));
}
