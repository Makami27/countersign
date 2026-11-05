import { addressEl, h, scrawlEl, statusPill, usdc, when } from "../dom.ts";
import type { Overview, PayeeSummary } from "../types.ts";
import { firstRun } from "./firstRun.ts";

function metaLine(payee: PayeeSummary): string {
  switch (payee.status) {
    case "attempt_refused": return `Still paying the verified address. ${payee.refusalsLastDay} refused attempt${payee.refusalsLastDay === 1 ? "" : "s"} in the last 24 hours.`;
    case "change_pending": return "A new address was requested. It is not payable yet.";
    case "waiting_wallet": return `Added ${when(payee.since)}. Not payable until the payee's wallet signs.`;
    case "not_payable": return "Not payable. The signing link expired; add the payee again.";
    case "conflict": return "Frozen: two verified records disagree. Nothing will be paid.";
    case "verified": return payee.lastPaid ? `Last paid ${usdc(payee.lastPaid.amountBaseUnits)} on ${when(payee.lastPaid.at)}` : "Verified. Not paid yet.";
  }
}

const PAYABLE: ReadonlySet<PayeeSummary["status"]> = new Set(["verified", "attempt_refused", "change_pending"]);

export function payeeList(payees: readonly PayeeSummary[], overview: Overview | null, selected: string | null, onAdd: () => void, onChanged: () => void, onPay: (payee: PayeeSummary) => void): HTMLElement {
  const section = h("section", { class: "list", "aria-labelledby": "payees-title" },
    h("h1", { id: "payees-title" }, "Payees"),
    h("p", { class: "sub" }, "Your agent can only pay addresses marked verified."));
  if (payees.length === 0 && overview) section.append(firstRun(overview, onChanged));
  for (const payee of payees) {
    section.append(h("article", { class: `sigcard cheque ${payee.status === "verified" ? "verified" : payee.status === "attempt_refused" || payee.status === "conflict" ? "refused" : "stated"}${payee.id === selected ? " current" : ""}` },
      h("a", { class: "cheque-link", href: `/app/payees/${encodeURIComponent(payee.id)}`, "data-link": true, "aria-current": payee.id === selected ? "page" : undefined },
        h("span", { class: "sigcard-head" }, h("span", { class: "sigcard-name" }, payee.name), statusPill(payee.status)),
        payee.address && payee.status !== "waiting_wallet" && payee.status !== "not_payable" ? h("span", { class: "sigcard-sig small" }, scrawlEl(payee.address)) : null,
        payee.address ? addressEl(payee.address, { short: true }) : null,
        h("span", { class: "meta" }, metaLine(payee))),
      PAYABLE.has(payee.status) ? h("button", { class: "btn primary cheque-pay", type: "button", onclick: () => onPay(payee) }, `Pay ${payee.name}`) : null));
  }
  section.append(h("div", { class: "actions" }, h("button", { class: payees.length === 0 ? "btn primary" : "btn", type: "button", onclick: onAdd }, "Add a payee")));
  return section;
}
