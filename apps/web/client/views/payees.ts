import { addressEl, h, scrawlEl, statusPill, usdc, when } from "../dom.ts";
import type { PayeeSummary } from "../types.ts";

function metaLine(payee: PayeeSummary): string {
  switch (payee.status) {
    case "attempt_refused": return `Still paying the verified address. ${payee.refusalsLastDay} refused attempt${payee.refusalsLastDay === 1 ? "" : "s"} in the last 24 hours.`;
    case "change_pending": return "A new address was requested and can't be paid yet. Payments still go to the verified one.";
    case "waiting_wallet": return `Added ${when(payee.since)}. Not payable until the payee's wallet signs.`;
    case "not_payable": return "Not payable. The signing link expired; add the payee again.";
    case "conflict": return FROZEN_WORDS;
    case "verified": return payee.lastPaid ? `Last paid ${usdc(payee.lastPaid.amountBaseUnits)} on ${when(payee.lastPaid.at)}` : "Verified. Not paid yet.";
  }
}

export const FROZEN_WORDS = "Frozen: two verified records disagree, so nothing will be paid. Check this payee's address history, then ask the payee to sign again.";

export const PAYABLE: ReadonlySet<PayeeSummary["status"]> = new Set(["verified", "attempt_refused", "change_pending"]);

function tone(status: PayeeSummary["status"]): string {
  if (status === "verified") return "verified";
  return status === "attempt_refused" || status === "conflict" ? "refused" : "stated";
}

function payeeCard(payee: PayeeSummary, selected: string | null, onPay: (payee: PayeeSummary) => void): HTMLElement {
  const signed = payee.address && payee.status !== "waiting_wallet" && payee.status !== "not_payable";
  return h("article", { class: `sigcard cheque compact ${tone(payee.status)}${payee.id === selected ? " current" : ""}` },
    h("a", { class: "cheque-link", href: `/app/payees/${encodeURIComponent(payee.id)}`, "data-link": true, "data-key": `payee-${payee.id}`, "aria-current": payee.id === selected ? "page" : undefined },
      h("span", { class: "sigcard-head" }, h("span", { class: "sigcard-name" }, payee.name), statusPill(payee.status)),
      signed && payee.address ? h("span", { class: "sigcard-sig small" }, scrawlEl(payee.address)) : null,
      payee.address ? addressEl(payee.address, { short: true }) : null,
      h("span", { class: "meta" }, metaLine(payee))),
    PAYABLE.has(payee.status) ? h("button", { class: "btn primary cheque-pay", type: "button", onclick: () => onPay(payee) }, `Pay ${payee.name}`) : null);
}

export function payeeList(payees: readonly PayeeSummary[], selected: string | null, onAdd: () => void, onPay: (payee: PayeeSummary) => void): HTMLElement {
  return h("section", { class: "side-payees", "aria-labelledby": "payees-title" },
    h("div", { class: "side-head" },
      h("h2", { id: "payees-title" }, "Payees"),
      h("button", { class: payees.length === 0 ? "btn primary small-btn" : "btn small-btn", type: "button", "aria-label": "Add a payee", "data-key": "add-payee", onclick: onAdd }, "+ Add")),
    h("p", { class: "note" }, payees.length === 0 ? "No payees yet. Your agent can only pay addresses marked verified." : "Your agent can only pay addresses marked verified."),
    ...payees.map((payee) => payeeCard(payee, selected, onPay)));
}
