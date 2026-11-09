import { addressEl, h, liveRegion } from "../dom.ts";
import type { Overview, PayeeSummary } from "../types.ts";
import { agentWalletBlock } from "./walletPanel.ts";
import { payeeList } from "./payees.ts";
import { startCard } from "./dashboard.ts";
import { openSheet } from "./sheets.ts";
import { signOutButton } from "../signOut.ts";
import { YOUR_WALLET_SHORT } from "../walletFacts.ts";

export type SideActions = {
  readonly onDeposit: () => void;
  readonly onAdd: () => void;
  readonly onPay: (payee: PayeeSummary) => void;
  readonly onCheck: () => void;
};

export type SidePayees = { readonly ok: true; readonly payees: readonly PayeeSummary[] } | { readonly ok: false; readonly problem: string };

function yourWallet(overview: Overview): HTMLElement {
  const state = overview.ownerWallet;
  const address = state.known && state.current ? addressEl(state.current.address, { short: true }) : h("span", { class: "note" }, state.known ? "Not registered yet" : "Not known right now");
  return h("p", { class: "side-you" }, h("span", { class: "label" }, YOUR_WALLET_SHORT), address);
}

function footer(overview: Overview): HTMLElement {
  const status = liveRegion();
  return h("div", { class: "side-foot" }, yourWallet(overview), status, h("div", { class: "actions" }, signOutButton(status)));
}

export function sidebarParts(overview: Overview, payees: SidePayees, selected: string | null, actions: SideActions): HTMLElement[] {
  return [
    agentWalletBlock(overview, actions.onDeposit),
    payees.ok ? payeeList(payees.payees, selected, actions.onAdd, actions.onPay) : h("p", { class: "note" }, `Payees couldn't be loaded: ${payees.problem}`),
    startCard(overview, actions.onDeposit),
    h("div", { class: "side-check" }, h("button", { class: "btn", type: "button", "data-key": "check", onclick: actions.onCheck }, "Check a message")),
    footer(overview),
  ];
}

const MENU_LINKS: readonly (readonly [string, string])[] = [["/app", "Payees"], ["/app/activity", "Activity"], ["/app/settings", "Settings"]];

export function menuSheet(overview: Overview): void {
  openSheet("Menu", (close, body) => {
    const status = liveRegion();
    const links = [...MENU_LINKS, ...(overview.isAdmin ? [["/app/admin", "Admin"] as const] : [])];
    body.append(
      h("nav", { class: "menu-links", "aria-label": "All sections" }, ...links.map(([href, label]) => h("a", { href, "data-link": true, onclick: close }, label))),
      yourWallet(overview), status,
      h("div", { class: "actions" }, signOutButton(status), h("button", { class: "btn", type: "button", onclick: close }, "Close")));
  }, () => undefined);
}
