import { addressEl, countersignMark, h, statusPill, usdc, when } from "../dom.ts";
import type { PayeeDetail } from "../types.ts";

const REFUSAL_FRESH_MS = 7 * 24 * 3600 * 1000;

function copyButton(text: string, label: string): HTMLButtonElement {
  const button = h("button", { class: "btn", type: "button" }, label);
  button.addEventListener("click", () => {
    void navigator.clipboard.writeText(text).then(() => { button.textContent = "Copied"; }, () => { button.textContent = "Select and copy the link above"; });
  });
  return button;
}

function verifiedLine(detail: PayeeDetail): HTMLElement | null {
  if (!detail.payTo) return null;
  const signed = detail.payTo.verifications.map((v) => `${v.role === "control" ? "payee's wallet" : "previous wallet"} (${v.scheme === "ZKLOGIN" ? "zkLogin" : "Ed25519"}, checked at epoch ${v.checkedAtEpoch}${v.maxEpoch ? `; zkLogin signatures stop verifying after epoch ${v.maxEpoch}` : ""})`);
  return h("div", { class: "countersig" }, countersignMark(), h("span", {}, `${detail.payTo.why} Since ${when(detail.payTo.since)}.${signed.length ? ` Signed by: ${signed.join("; ")}.` : ""}`), statusPill("verified"));
}

function refusalCard(detail: PayeeDetail, now: number): HTMLElement | null {
  const refusal = detail.latestRefusal;
  if (!refusal || now - Date.parse(refusal.at) > REFUSAL_FRESH_MS) return null;
  return h("article", { class: "attempt", "aria-labelledby": "attempt-title" },
    h("div", { class: "attempt-head" }, h("h3", { id: "attempt-title" }, `Attempt refused, ${when(refusal.at)}`), h("div", { class: "stamp", "aria-hidden": "true" }, "VOID")),
    h("p", { class: "money" }, "Nothing was sent and nothing was changed."),
    h("p", {}, refusal.message),
    refusal.address && refusal.against ? h("div", { class: "compare" },
      h("div", { class: "row" }, h("span", { class: "label" }, "Address in the message"), addressEl(refusal.address, { against: refusal.against })),
      h("div", { class: "row" }, h("span", { class: "label" }, "Verified address"), addressEl(refusal.against))) : null,
    h("p", { class: "links" }, `Receipt ${refusal.receipt}`));
}

function waitingCard(detail: PayeeDetail): HTMLElement | null {
  const waiting = detail.waiting;
  if (!waiting) return null;
  return h("section", { class: "card stated", "aria-labelledby": "waiting-title" },
    h("h3", { id: "waiting-title" }, waiting.expired ? "The signing link expired" : "Waiting for the payee's wallet"),
    h("p", { class: "money" }, "Nothing can be paid to this address yet."),
    h("span", { class: "label" }, "Address you entered"), addressEl(waiting.address),
    waiting.expired ? h("p", {}, "Add the payee again to get a new link.") : h("p", {}, `Send this link to the payee. Their wallet signs once to prove the address is theirs. It expires ${when(waiting.expires)}.`),
    waiting.expired ? null : h("p", { class: "note", style: undefined }, h("span", { class: "addr" }, waiting.signUrl)),
    waiting.expired ? null : h("div", { class: "actions" }, copyButton(waiting.signUrl, "Copy signing link")));
}

function historyList(detail: PayeeDetail): HTMLElement {
  return h("section", { "aria-labelledby": "history-title" }, h("h3", { id: "history-title" }, "Address history"),
    h("ol", { class: "rows" }, ...detail.history.map((row) => h("li", { class: row.kind === "refusal" ? "refused-row" : "" },
      h("span", { class: "v" }, row.label),
      h("span", { class: "what" }, row.address ? addressEl(row.address, { short: true }) : null, h("span", { class: "meta" }, `${row.why} ${when(row.at)}.`))))));
}

function paymentsList(detail: PayeeDetail): HTMLElement {
  const items = detail.payments.map((p) => h("li", {}, h("span", { class: "v" }, p.state === "SETTLED" ? "Paid" : p.state === "FAILED" ? "Not paid" : "Open"),
    h("span", { class: "what" }, h("span", {}, usdc(p.amountBaseUnits)), h("span", { class: "meta" }, `${when(p.at)}${p.digest ? `, transaction ${p.digest}` : ""}${p.state === "UNKNOWN" ? ". Outcome not known yet; it will not be sent again." : ""}`))));
  return h("section", { "aria-labelledby": "payments-title" }, h("h3", { id: "payments-title" }, "Payments"),
    items.length ? h("ol", { class: "rows" }, ...items) : h("p", { class: "empty" }, "No payments yet."));
}

export type DetailActions = { readonly onPay: () => void; readonly onRequestChange: () => void; readonly onConfirm: (nonce: string) => void };

function pendingChangeCard(c: PayeeDetail["pendingChanges"][number], current: string | null, onConfirm: (nonce: string) => void): HTMLElement {
  const first = c.ownerConfirmedAt ? `Confirmed by you ${when(c.ownerConfirmedAt)}; waiting period ends ${when(c.readyAt ?? c.ownerConfirmedAt)}` : c.currentSignedAt ? `Signed ${when(c.currentSignedAt)}` : "Waiting";
  return h("section", { class: "card stated", "aria-labelledby": `change-${c.nonce}` },
    h("h3", { id: `change-${c.nonce}` }, "Change waiting for proof"),
    h("p", { class: "money" }, "Nothing will be paid to the new address yet. Payments still go to the verified address."),
    h("span", { class: "label" }, "Requested address"), addressEl(c.toAddress),
    h("ol", { class: "steps" },
      h("li", { class: c.currentSignedAt || c.ownerConfirmedAt ? "done" : "" }, h("span", { class: "n", "aria-hidden": "true" }, "1"), h("span", {}, "Current wallet signs, or you confirm"), h("span", { class: "when" }, first)),
      h("li", { class: c.newSignedAt ? "done" : "" }, h("span", { class: "n", "aria-hidden": "true" }, "2"), h("span", {}, "New wallet proves control"), h("span", { class: "when" }, c.newSignedAt ? `Signed ${when(c.newSignedAt)}` : "Waiting"))),
    h("p", { class: "note" }, `Signing link for the payee (expires ${when(c.expires)}): ${c.signUrl}`),
    h("div", { class: "actions" }, copyButton(c.signUrl, "Copy signing link"), c.ownerConfirmedAt || c.currentSignedAt ? null : h("button", { class: "btn", type: "button", onclick: () => onConfirm(c.nonce) }, "I confirm this change myself")));
}

export function payeeDetailView(detail: PayeeDetail, actions: DetailActions): HTMLElement {
  const now = Date.now();
  const verified = detail.payTo !== null && detail.summary.status !== "conflict";
  return h("section", { class: "detail", "aria-labelledby": "payee-title" },
    h("a", { class: "back", href: "/app", "data-link": true }, "All payees"),
    h("header", {}, h("h2", { id: "payee-title" }, detail.summary.name),
      h("p", { class: "lede" }, verified ? "Payments go to the address below. Nothing anyone sends the agent can change that without proof." : "This payee can't be paid yet.")),
    detail.payTo ? h("div", { class: "payto" }, h("span", { class: "label" }, "Pays to"), addressEl(detail.payTo.address), verifiedLine(detail)) : null,
    waitingCard(detail),
    ...detail.pendingChanges.map((c) => pendingChangeCard(c, detail.payTo?.address ?? null, actions.onConfirm)),
    refusalCard(detail, now),
    detail.latestRefusal ? null : h("p", { class: "empty" }, "Nothing refused for this payee."),
    historyList(detail),
    paymentsList(detail),
    verified ? h("div", { class: "actions sticky" }, h("button", { class: "btn primary", type: "button", onclick: actions.onPay }, `Pay ${detail.summary.name}`), detail.pendingChanges.length === 0 ? h("button", { class: "btn", type: "button", onclick: actions.onRequestChange }, "Request an address change") : null) : null);
}
