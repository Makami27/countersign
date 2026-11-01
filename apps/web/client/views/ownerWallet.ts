import { EXTENSION_TIP, connectWallet, signingWallets } from "../signFlow.ts";
import { withApprovals } from "../approvals.ts";
import { addressEl, h, listen, liveRegion, when } from "../dom.ts";
import type { Overview } from "../types.ts";

export function ownerWalletPanel(overview: Overview, onChanged: () => void): HTMLElement {
  const state = overview.ownerWallet;
  const status = liveRegion();
  if (!state.known) return h("section", { class: "card stated" }, h("h2", {}, "Owner wallet"), h("p", {}, `— (${state.why}) Sensitive changes are blocked until it can be read.`));
  if (!state.current) {
    const buttons = signingWallets().map((wallet) => {
      const connect = h("button", { class: "btn primary", type: "button" }, `Connect your owner wallet (${wallet.name})`);
      listen(connect, "click", async () => {
        const connecting = connectWallet(wallet, null, "owner wallet");
        connect.disabled = true;
        const address = await connecting;
        connect.disabled = false;
        if (!address.ok) return void (status.textContent = address.message);
        const result = await withApprovals("POST", "/api/app/owner/wallet", { address: address.value.account.address }, overview.network, status);
        status.textContent = result.ok ? "Registered. Adding payees, confirming changes yourself and loosening limits now need this wallet." : result.error.message;
        if (result.ok) onChanged();
      }, status);
      return connect;
    });
    return h("section", { class: "card stated" }, h("h2", {}, "Register your owner wallet"),
      h("p", {}, "Sign once with your own Sui wallet. After that, someone who gets into your Telegram can only pay payees that are already verified, within your caps."), status, h("div", { class: "actions" }, ...(buttons.length ? buttons : [h("p", { class: "note" }, "No Sui wallet found. Install or unlock Slush, then reload this page.")])), h("p", { class: "note" }, EXTENSION_TIP));
  }
  const waiting = state.waiting;
  const next = h("input", { id: "next-owner", class: "mono", autocomplete: "off", spellcheck: "false", placeholder: "0x…" });
  const noOld = h("input", { id: "no-old", type: "checkbox" });
  const form = h("form", {}, h("label", { for: "next-owner" }, "Replace with this wallet", next),
    h("label", { for: "no-old", class: "check" }, noOld, " I can't sign with the current owner wallet: wait 72 hours instead (you get Telegram notices)"), status,
    h("div", { class: "actions" }, h("button", { class: "btn", type: "submit" }, "Replace owner wallet")));
  listen(form, "submit", async (event) => {
    event.preventDefault();
    const result = await withApprovals("POST", "/api/app/owner/wallet", { address: next.value.trim(), waitInstead: noOld.checked }, overview.network, status);
    status.textContent = result.ok ? "Done." : result.error.message;
    if (result.ok) onChanged();
  }, status);
  const cancel = h("button", { class: "btn", type: "button" }, "Cancel this change");
  listen(cancel, "click", async () => {
    const result = await withApprovals("POST", "/api/app/owner/wallet/cancel", {}, overview.network, status);
    status.textContent = result.ok ? "Cancelled." : result.error.message;
    if (result.ok) onChanged();
  }, status);
  return h("section", { class: "card" }, h("h2", {}, "Owner wallet"), addressEl(state.current.address), h("p", { class: "note" }, `Registered ${when(state.current.since)}.`),
    waiting ? h("div", { class: "card stated" }, h("p", {}, `A change to this wallet is waiting until ${when(waiting.readyAt)}:`), addressEl(waiting.address), h("div", { class: "actions" }, cancel)) : "",
    form);
}
