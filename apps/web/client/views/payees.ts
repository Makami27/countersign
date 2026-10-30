import { addressEl, h, statusPill, usdc, when } from "../dom.ts";
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

export function payeeList(payees: readonly PayeeSummary[], overview: Overview | null, selected: string | null, onAdd: () => void): HTMLElement {
  const section = h("section", { class: "list", "aria-labelledby": "payees-title" },
    h("h1", { id: "payees-title" }, "Payees"),
    h("p", { class: "sub" }, "Your agent can only pay addresses marked verified."));
  if (payees.length === 0 && overview) section.append(firstRun(overview));
  for (const payee of payees) {
    section.append(h("a", { class: "cheque", href: `/app/payees/${encodeURIComponent(payee.id)}`, "data-link": true, "aria-current": payee.id === selected ? "page" : undefined },
      h("span", { class: "name" }, payee.name, statusPill(payee.status)),
      payee.address ? addressEl(payee.address, { short: true }) : null,
      h("span", { class: "meta" }, metaLine(payee))));
  }
  section.append(h("div", { class: "actions" }, h("button", { class: payees.length === 0 ? "btn primary" : "btn", type: "button", onclick: onAdd }, "Add a payee")));
  return section;
}
