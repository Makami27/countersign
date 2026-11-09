import { addressEl, h } from "../dom.ts";
import type { PayeeSummary } from "../types.ts";
import { PAYABLE } from "./payees.ts";
import { openSheet } from "./sheets.ts";

export function pickPayeeSheet(title: string, verb: string, payees: readonly PayeeSummary[], onPick: (payee: PayeeSummary) => void, onAdd: () => void): void {
  const payable = payees.filter((p) => PAYABLE.has(p.status) && p.address);
  openSheet(title, (close, body) => {
    if (payable.length === 0) {
      body.append(h("p", {}, "No verified payees yet. Add a payee; once their own wallet signs, you can pay them from here."),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: () => (close(), onAdd()) }, "Add a payee"), h("button", { class: "btn", type: "button", onclick: close }, "Close")));
      return;
    }
    body.append(h("ul", { class: "pick-list", "aria-label": "Verified payees" }, ...payable.map((payee) => h("li", {},
      h("button", { class: "pick", type: "button", onclick: () => (close(), onPick(payee)) },
        h("span", { class: "pick-name" }, `${verb} ${payee.name}`),
        payee.address ? addressEl(payee.address, { short: true }) : null)))),
      h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: close }, "Close")));
  }, () => undefined);
}
