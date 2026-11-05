import { withApprovals } from "../approvals.ts";
import { h, liveRegion, listen } from "../dom.ts";
import { ADDRESS_PROBLEM, attachAddressCleaning, cleanAddress, isSuiAddress } from "../addressInput.ts";
import type { Refusal } from "../types.ts";

export function openSheet(title: string, build: (close: () => void, body: HTMLElement) => void, onClosed: () => void): void {
  const body = h("div", { class: "narrow", style: undefined });
  const dialog = h("dialog", { "aria-labelledby": "sheet-title" }, h("h2", { id: "sheet-title" }, title), body);
  const close = () => dialog.close();
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClosed();
  });
  document.querySelector(".app")?.append(dialog);
  build(close, body);
  dialog.showModal();
}

export function addPayeeSheet(network: "mainnet" | "testnet", onClosed: () => void): void {
  openSheet("Add a payee", (close, body) => {
    const name = h("input", { id: "payee-name", name: "name", required: true, maxlength: "60", autocomplete: "off", placeholder: "Flat 4B rent" });
    const address = h("input", { id: "payee-address", name: "address", required: true, class: "mono", autocomplete: "off", spellcheck: "false", placeholder: "0x…" });
    attachAddressCleaning(address);
    const status = liveRegion();
    const submit = h("button", { class: "btn primary", type: "submit" }, "Add and get a signing link");
    const form = h("form", {}, h("label", { for: "payee-name" }, "Name", name), h("label", { for: "payee-address" }, "Their Sui address", h("span", { class: "hint" }, "Copy it from the payee. It can't be paid until their wallet signs."), address), status,
      h("div", { class: "actions" }, submit, h("button", { class: "btn", type: "button", onclick: close }, "Cancel")));
    listen(form, "submit", async (event) => {
      event.preventDefault();
      if (!name.value.trim()) return void (status.textContent = "Give the payee a name, for example Flat 4B rent. Nothing was added.");
      if (!isSuiAddress(address.value)) return void (status.textContent = ADDRESS_PROBLEM);
      submit.disabled = true;
      status.textContent = "Asking your wallet to approve this payee…";
      const result = await withApprovals<{ signUrl: string | null }>("POST", "/api/app/payees", { name: name.value.trim(), address: cleanAddress(address.value) }, network, status);
      submit.disabled = false;
      if (!result.ok) {
        const refusal = result.error.body?.["refusal"] as Refusal | undefined;
        return void (status.textContent = refusal ? [refusal.message, refusal.nextAction].filter(Boolean).join(" ") : result.error.message);
      }
      form.replaceChildren(h("p", { class: "money" }, "Added. Nothing can be paid to it yet."), h("p", {}, "Send this link to the payee. Their wallet signs once to prove the address is theirs; then it becomes payable."), h("p", {}, h("span", { class: "addr" }, result.data.signUrl ?? "—")),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: () => void navigator.clipboard.writeText(result.data.signUrl ?? "") }, "Copy link"), h("button", { class: "btn", type: "button", onclick: close }, "Done")));
    }, status);
    body.append(form);
  }, onClosed);
}
