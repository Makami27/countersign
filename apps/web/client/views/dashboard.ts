import { api } from "../api.ts";
import { addressEl, copyButton, h, listen, liveRegion } from "../dom.ts";
import type { Overview } from "../types.ts";
import { AGENT_WALLET, DEPOSIT_ACTION, FAUCETS } from "../walletFacts.ts";

const STEPS: readonly (readonly [keyof Overview["checklist"] | "signedIn", string])[] = [
  ["signedIn", "Sign in with your wallet"],
  ["funded", "Fund your agent wallet (it pays your bills)"],
  ["payeeAdded", "Add a payee (it can be your own second wallet)"],
  ["linkSigned", "Send the signing link; the payee's wallet signs it"],
  ["paid", "Pay the payee"],
  ["scamTried", "Paste a scam message below and watch it get refused"],
  ["telegram", "Connect Telegram (optional, in Settings)"],
];

const OPTIONAL: ReadonlySet<string> = new Set(["telegram"]);

export function checklistDone(overview: Overview): boolean {
  return STEPS.every(([key]) => key === "signedIn" || OPTIONAL.has(key) || overview.checklist[key]);
}

function fundingHelp(overview: Overview, onDeposit: () => void): HTMLElement {
  return h("div", { class: "step-more" },
    h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: onDeposit }, DEPOSIT_ACTION)),
    overview.network === "testnet" ? h("p", { class: "note" }, "Or use a faucet, and paste this address, the ", h("strong", {}, AGENT_WALLET), ", not your own: ") : null,
    overview.network === "testnet" ? addressEl(overview.agentAddress) : null,
    overview.network === "testnet" ? h("div", { class: "actions" }, copyButton(overview.agentAddress, "Copy this address")) : null,
    overview.network === "testnet" ? h("p", { class: "note" }, h("a", { href: FAUCETS[0].href, target: "_blank", rel: "noreferrer" }, FAUCETS[0].label), " and ", h("a", { href: FAUCETS[1].href, target: "_blank", rel: "noreferrer" }, FAUCETS[1].label), ".") : null);
}

export function checklistCard(overview: Overview, onDeposit: () => void): HTMLElement {
  const items = STEPS.map(([key, label]) => {
    const done = key === "signedIn" || overview.checklist[key];
    return h("li", { class: done ? "done" : "" }, h("span", { class: "n", "aria-hidden": "true" }, done ? "✓" : "·"), h("span", {}, label), h("span", { class: "when" }, done ? "Done" : "To do"), key === "funded" && !done ? fundingHelp(overview, onDeposit) : null);
  });
  const steps = h("ol", { class: "steps" }, ...items);
  if (checklistDone(overview)) return h("details", { class: "card checklist done" }, h("summary", {}, "Getting started: every step done"), steps);
  return h("section", { class: "card checklist", "aria-labelledby": "checklist-title" }, h("h2", { id: "checklist-title" }, "Getting started"), steps);
}

type PasteAnswer = {
  readonly says?: string;
  readonly signUrl?: string | null;
  readonly ask?: { readonly payeeId: string; readonly name: string; readonly question: string; readonly amounts: readonly string[] };
  readonly preview?: { readonly payeeId: string; readonly name: string; readonly amount: string };
  readonly refusal?: { readonly reason?: string; readonly message: string; readonly nextAction: string; readonly receipt: string };
};

export type PayFromMessage = (payeeId: string, amount: string | null) => void;

function refusalHeadline(reason: string | undefined): string {
  return `${reason === "LOOKALIKE_ADDRESS" ? "Look-alike refused." : "Refused."} Nothing was sent and nothing was changed.`;
}

function answerNodes(r: PasteAnswer, onPay: PayFromMessage): (HTMLElement | string)[] {
  if (r.refusal) return [h("p", { class: "money" }, refusalHeadline(r.refusal.reason)), h("p", {}, [r.refusal.message, r.refusal.nextAction].filter(Boolean).join(" ")), h("p", { class: "links" }, h("a", { href: `/r/${r.refusal.receipt}` }, `Receipt ${r.refusal.receipt}`))];
  const { ask, preview } = r;
  if (ask) return [h("p", { class: "money" }, ask.question), h("p", {}, r.says ?? ""), h("div", { class: "actions amounts" }, ...ask.amounts.map((amount) => h("button", { class: "btn", type: "button", onclick: () => onPay(ask.payeeId, amount) }, `${amount} USDC`)))];
  if (preview) return [h("p", {}, r.says ?? ""), h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: () => onPay(preview.payeeId, preview.amount) }, `Review paying ${preview.name}`))];
  return [h("p", {}, r.says ?? ""), r.signUrl ? h("p", { class: "note" }, `Signing link for the payee: ${r.signUrl}`) : ""];
}

export function pasteCard(onChanged: () => void, onPay: PayFromMessage): HTMLElement {
  const text = h("textarea", { id: "paste-text", rows: "4", maxlength: "4000", placeholder: "Paste the whole message, for example an email saying a payee changed wallets." });
  const status = liveRegion();
  const answer = h("div", {});
  const button = h("button", { class: "btn", type: "submit" }, "Check this message");
  const form = h("form", {}, h("label", { for: "paste-text" }, "Paste a message you received", h("span", { class: "hint" }, "It goes through the same checks as a message forwarded to the bot. Code checks addresses first; the model only reads free text."), text), status, answer, h("div", { class: "actions" }, button));
  listen(form, "submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    status.textContent = "Checking…";
    const result = await api<PasteAnswer>("POST", "/api/app/paste", { text: text.value });
    button.disabled = false;
    status.textContent = "";
    if (!result.ok) return void (status.textContent = result.error.message);
    const r = result.data;
    answer.replaceChildren(...answerNodes(r, onPay));
    if (r.refusal || r.signUrl) onChanged();
  }, status);
  return h("section", { class: "card", "aria-labelledby": "paste-title" }, h("h2", { id: "paste-title" }, "Check a message"), form);
}
