import { formatUsdc, usdcToBaseUnits } from "@countersign/core";
import { withApprovals } from "../approvals.ts";
import { h, listen, liveRegion, usdc } from "../dom.ts";
import type { Overview } from "../types.ts";
import { ownerWalletPanel } from "./ownerWallet.ts";
import { factList, memoryFact, walletFacts } from "./firstRun.ts";
import { telegramPanel } from "./telegramPanel.ts";
import { discordPanel } from "./discordPanel.ts";
import { soundToggle } from "../moment.ts";
import { carryNotice, showCarried } from "../carriedNotice.ts";
import { signOutButton } from "../signOut.ts";
import { themeSwitch } from "../theme.ts";

function group(id: string, title: string, description: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return h("section", { class: "settings-group", "aria-labelledby": id }, h("h2", { id }, title), h("p", { class: "sub" }, description), ...children);
}

function asSubsection(panel: HTMLElement): HTMLElement {
  panel.querySelectorAll("h2").forEach((heading) => {
    const sub = h("h3", {}, ...heading.childNodes);
    for (const { name, value } of heading.attributes) sub.setAttribute(name, value);
    heading.replaceWith(sub);
  });
  return panel;
}

function limitsForm(overview: Overview, onSaved: () => void): HTMLElement {
  const perPayment = h("input", { id: "cap-payment", inputmode: "decimal", value: formatUsdc(BigInt(overview.caps.perPaymentBaseUnits)) });
  const perDay = h("input", { id: "cap-day", inputmode: "decimal", value: formatUsdc(BigInt(overview.caps.perDayBaseUnits)) });
  const cooldown = h("input", { id: "cooldown", inputmode: "numeric", value: String(Number((overview.cooldownSeconds / 3600).toFixed(4))) });
  const status = liveRegion();
  showCarried("settings", status);
  const form = h("form", {}, h("label", { for: "cap-payment" }, "Per-payment cap (USDC)", h("span", { class: "hint" }, "The agent refuses any single payment above this."), perPayment),
    h("label", { for: "cap-day" }, "Daily cap (USDC)", h("span", { class: "hint" }, `The most it can pay in total each day. ${usdc(overview.caps.usedTodayBaseUnits)} paid so far today.`), perDay),
    h("label", { for: "cooldown" }, "Waiting period (hours)", h("span", { class: "hint" }, "When a payee can't sign with their old wallet and you approve the new one yourself, payments to it wait this long. Default 24."), cooldown), status,
    h("p", { class: "hint" }, "Raising a limit asks your wallet to sign. Lowering it doesn't."),
    h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Save limits")));
  listen(form, "submit", async (event) => {
    event.preventDefault();
    const perPaymentBaseUnits = usdcToBaseUnits(perPayment.value.trim());
    const perDayBaseUnits = usdcToBaseUnits(perDay.value.trim());
    if (!perPaymentBaseUnits || !perDayBaseUnits) return void (status.textContent = "Give each cap in USDC, for example 25 or 0.50. Nothing was changed.");
    if (!/^\d+(\.\d+)?$/.test(cooldown.value.trim())) return void (status.textContent = "Give the waiting period in hours, for example 24. Nothing was changed.");
    const result = await withApprovals("PUT", "/api/app/settings", { perPaymentBaseUnits, perDayBaseUnits, cooldownSeconds: String(Math.round(Number(cooldown.value.trim()) * 3600)) }, overview.network, status);
    if (!result.ok) return void (status.textContent = result.error.message);
    carryNotice("settings", "Saved. New limits apply from the next payment.");
    onSaved();
  }, status);
  return form;
}

export function settingsPage(overview: Overview, onSaved: () => void): HTMLElement {
  const accountStatus = liveRegion();
  return h("section", { class: "narrow settings", "aria-labelledby": "settings-title" }, h("h1", { id: "settings-title" }, "Settings"),
    group("settings-wallets", "Wallets", "The agent wallet pays your bills, so fund that one. Your wallet approves changes and sends deposits. It never pays bills.",
      factList(...walletFacts(overview)), asSubsection(ownerWalletPanel(overview, onSaved))),
    group("settings-limits", "Limits", "What the agent may pay, and how long a change you approve yourself waits.",
      limitsForm(overview, onSaved),
      overview.cooldownSeconds < 24 * 3600 ? h("p", { class: "netlabel" }, `Demo value: changes you confirm yourself wait ${Math.round(overview.cooldownSeconds / 60)} minutes, not 24 hours.`) : null),
    group("settings-apps", "Connected apps", "Optional. Get notices and pay verified payees from a chat app.",
      asSubsection(telegramPanel()), asSubsection(discordPanel())),
    group("settings-preferences", "Preferences", "How the app behaves in this browser.",
      h("div", { class: "actions" }, soundToggle("btn"), themeSwitch())),
    group("settings-account", "Account", "Where your agent's records live, and signing out of this browser.",
      factList(memoryFact(overview)), accountStatus, h("div", { class: "actions" }, signOutButton(accountStatus))));
}
