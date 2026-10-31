import { api } from "../api.ts";
import { addressEl, h, liveRegion, when } from "../dom.ts";
import type { PayeeDetail, Refusal } from "../types.ts";
import { openSheet } from "./sheets.ts";

function refusalLine(body: Record<string, unknown> | null, fallback: string): string {
  const refusal = body?.["refusal"] as Refusal | undefined;
  return refusal ? [refusal.message, refusal.nextAction].filter(Boolean).join(" ") : fallback;
}

export function requestChangeSheet(detail: PayeeDetail, onClosed: () => void): void {
  openSheet(`New address for ${detail.summary.name}`, (close, body) => {
    const address = h("input", { id: "new-address", required: true, class: "mono", autocomplete: "off", spellcheck: "false", placeholder: "0x…" });
    const status = liveRegion();
    const submit = h("button", { class: "btn primary", type: "submit" }, "Request the change");
    const form = h("form", {},
      h("p", {}, "Payments keep going to the verified address until the change is proven. The payee's current wallet signs it, or you confirm it yourself and a waiting period passes; either way the new wallet must sign too."),
      h("label", { for: "new-address" }, "New Sui address", address), status,
      h("div", { class: "actions" }, submit, h("button", { class: "btn", type: "button", onclick: close }, "Cancel")));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = "Checking the address and writing the request to Walrus Memory (about 20 seconds). Nothing is payable to it yet.";
      const result = await api<{ signUrl: string | null }>("POST", `/api/app/payees/${encodeURIComponent(detail.summary.id)}/changes`, { address: address.value.trim() });
      submit.disabled = false;
      if (!result.ok) return void (status.textContent = refusalLine(result.error.body, result.error.message));
      form.replaceChildren(h("p", { class: "money" }, "Requested. Nothing will be paid to the new address yet."), addressEl(address.value.trim(), detail.payTo ? { against: detail.payTo.address } : {}),
        h("p", {}, "Send this link to the payee:"), h("p", {}, h("span", { class: "addr" }, result.data.signUrl ?? "—")),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: () => void navigator.clipboard.writeText(result.data.signUrl ?? "") }, "Copy link"), h("button", { class: "btn", type: "button", onclick: close }, "Done")));
    });
    body.append(form);
  }, onClosed);
}

export function confirmChangeSheet(nonce: string, cooldownSeconds: number, onClosed: () => void): void {
  openSheet("Confirm the change yourself", (close, body) => {
    const code = h("input", { id: "confirm-code", required: true, class: "mono", autocomplete: "one-time-code", placeholder: "ABCDE-FGH23" });
    const status = liveRegion();
    const hours = cooldownSeconds / 3600;
    const form = h("form", {},
      h("p", {}, `Use this when the payee can't sign with their old wallet. After you confirm, the change waits ${hours >= 1 ? `${Math.round(hours)} hours` : `${Math.round(cooldownSeconds / 60)} minutes (demo value)`} before it can take effect, and the new wallet still has to sign.`),
      h("label", { for: "confirm-code" }, "A fresh code from the bot", h("span", { class: "hint" }, "Send /login to your Countersign bot. The code works once."), code), status,
      h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Confirm"), h("button", { class: "btn", type: "button", onclick: close }, "Cancel")));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await api<{ completion: { state: string; readyAt?: string | null } }>("POST", `/api/app/changes/${nonce}/confirm`, { code: code.value });
      if (!result.ok) return void (status.textContent = refusalLine(result.error.body, result.error.message));
      const readyAt = result.data.completion.readyAt;
      form.replaceChildren(h("p", { class: "money" }, "Confirmed. Nothing has changed yet."), h("p", {}, readyAt ? `The change can take effect after ${when(readyAt)}, once the new wallet has signed.` : "The change takes effect once the new wallet signs."),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: close }, "Done")));
    });
    body.append(form);
  }, onClosed);
}
