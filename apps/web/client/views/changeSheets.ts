import { api } from "../api.ts";
import { withApprovals } from "../approvals.ts";
import { addressEl, h, liveRegion, when, listen } from "../dom.ts";
import { ADDRESS_PROBLEM, attachAddressCleaning, cleanAddress, isSuiAddress } from "../addressInput.ts";
import type { PayeeDetail, Refusal } from "../types.ts";
import { openSheet } from "./sheets.ts";

function refusalLine(body: Record<string, unknown> | null, fallback: string): string {
  const refusal = body?.["refusal"] as Refusal | undefined;
  return refusal ? [refusal.message, refusal.nextAction].filter(Boolean).join(" ") : fallback;
}

export function requestChangeSheet(detail: PayeeDetail, onClosed: () => void): void {
  openSheet(`New address for ${detail.summary.name}`, (close, body) => {
    const address = h("input", { id: "new-address", required: true, class: "mono", autocomplete: "off", spellcheck: "false", placeholder: "0x…" });
    attachAddressCleaning(address);
    const status = liveRegion();
    const submit = h("button", { class: "btn primary", type: "submit" }, "Request the change");
    const form = h("form", {},
      h("p", {}, "Payments keep going to the verified address until the change is proven. The payee's current wallet signs it, or you confirm it yourself and a waiting period passes; either way the new wallet must sign too."),
      h("label", { for: "new-address" }, "New Sui address", address), status,
      h("div", { class: "actions" }, submit, h("button", { class: "btn", type: "button", onclick: close }, "Cancel")));
    listen(form, "submit", async (event) => {
      event.preventDefault();
      if (!isSuiAddress(address.value)) return void (status.textContent = ADDRESS_PROBLEM);
      submit.disabled = true;
      status.textContent = "Checking the address and writing the request to Walrus Memory (about 20 seconds). Nothing is payable to it yet.";
      const result = await api<{ signUrl: string | null }>("POST", `/api/app/payees/${encodeURIComponent(detail.summary.id)}/changes`, { address: cleanAddress(address.value) });
      submit.disabled = false;
      if (!result.ok) return void (status.textContent = refusalLine(result.error.body, result.error.message));
      form.replaceChildren(h("p", { class: "money" }, "Requested. Nothing will be paid to the new address yet."), addressEl(cleanAddress(address.value), detail.payTo ? { against: detail.payTo.address } : {}),
        h("p", {}, "Send this link to the payee:"), h("p", {}, h("span", { class: "addr" }, result.data.signUrl ?? "—")),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: () => void navigator.clipboard.writeText(result.data.signUrl ?? "") }, "Copy link"), h("button", { class: "btn", type: "button", onclick: close }, "Done")));
    }, status);
    body.append(form);
  }, onClosed);
}

export function confirmChangeSheet(nonce: string, cooldownSeconds: number, network: "mainnet" | "testnet", onClosed: () => void): void {
  openSheet("Confirm the change yourself", (close, body) => {
    const status = liveRegion();
    const hours = cooldownSeconds / 3600;
    const form = h("form", {},
      h("p", {}, `Use this when the payee can't sign with their old wallet. After you confirm, the change waits ${hours >= 1 ? `${Math.round(hours)} hours` : `${Math.round(cooldownSeconds / 60)} minutes (demo value)`} before it can take effect, and the new wallet still has to sign.`),
      h("div", { class: "outcome stated warning", role: "note" }, h("p", { class: "money" }, "Only continue if you confirmed this with the payee another way, for example a phone number you already had. Never use contact details from the message asking for the change.")),
      h("p", { class: "note" }, "Your wallet signs this confirmation. A Telegram code alone is not enough. The address is checked again against known attacks, look-alikes and addresses other agents refused, now and when the waiting period ends."), status,
      h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Confirm"), h("button", { class: "btn", type: "button", onclick: close }, "Cancel")));
    listen(form, "submit", async (event) => {
      event.preventDefault();
      const result = await withApprovals<{ completion: { state: string; readyAt?: string | null } }>("POST", `/api/app/changes/${nonce}/confirm`, {}, network, status);
      if (!result.ok) return void (status.textContent = refusalLine(result.error.body, result.error.message));
      const readyAt = result.data.completion.readyAt;
      form.replaceChildren(h("p", { class: "money" }, "Confirmed. Nothing has changed yet."), h("p", {}, readyAt ? `The change can take effect after ${when(readyAt)}, once the new wallet has signed.` : "The change takes effect once the new wallet signs."),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: close }, "Done")));
    }, status);
    body.append(form);
  }, onClosed);
}

export async function cancelChange(nonce: string, network: "mainnet" | "testnet", status: HTMLElement, onDone: () => void): Promise<void> {
  status.textContent = "Your wallet signs the cancellation. Nothing has changed yet.";
  const result = await withApprovals<{ refusal?: Refusal }>("POST", `/api/app/changes/${nonce}/cancel`, {}, network, status);
  if (!result.ok) return void (status.textContent = refusalLine(result.error.body, result.error.message));
  status.textContent = "Cancelled. Nothing was changed; payments keep going to the verified address.";
  onDone();
}
