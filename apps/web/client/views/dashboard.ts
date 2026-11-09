import { api } from "../api.ts";
import { addressEl, copyButton, h, listen, liveRegion } from "../dom.ts";
import type { Overview } from "../types.ts";
import { AGENT_WALLET, DEPOSIT_ACTION, FAUCETS } from "../walletFacts.ts";
import { START_STEPS } from "../startSteps.ts";
import { openSheet } from "./sheets.ts";

const STEPS: readonly (readonly [keyof Overview["checklist"] | "signedIn", string])[] = [
  ...START_STEPS.map((step) => [step.key, step.label] as const),
  ["telegram", "Connect Telegram or Discord (optional, in Settings)"],
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

let startFolded: boolean | null = null;

export function startCard(overview: Overview, onDeposit: () => void): HTMLElement {
  const isDone = (key: (typeof STEPS)[number][0]) => key === "signedIn" || overview.checklist[key];
  const items = STEPS.map(([key, label]) => {
    const done = isDone(key);
    return h("li", { class: done ? "done" : "" }, h("span", { class: "n", "aria-hidden": "true" }, done ? "✓" : "·"), h("span", {}, label), h("span", { class: "when" }, done ? "Done" : OPTIONAL.has(key) ? "Optional" : "To do"), key === "funded" && !done ? fundingHelp(overview, onDeposit) : null);
  });
  const required = STEPS.filter(([key]) => !OPTIONAL.has(key));
  const count = `${required.filter(([key]) => isDone(key)).length} of ${required.length}`;
  const summary = h("summary", {}, h("h2", {}, "How to start"), h("span", { class: "count" }, h("span", { class: "visually-hidden" }, "Steps done: "), count));
  const details = h("details", { class: "start", open: startFolded === null ? !checklistDone(overview) : !startFolded }, summary, h("ol", { class: "steps" }, ...items));
  summary.addEventListener("click", () => {
    startFolded = details.open;
  });
  return details;
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
  return [h("p", {}, r.says ?? ""), r.signUrl ? h("p", { class: "note" }, "Signing link for the payee:") : "", r.signUrl ? h("p", { class: "link-text" }, r.signUrl) : "", r.signUrl ? h("div", { class: "actions" }, copyButton(r.signUrl, "Copy link")) : ""];
}

export function checkMessageSheet(onChanged: () => void, onPay: PayFromMessage): void {
  openSheet("Check a message", (close, body) => {
    const text = h("textarea", { id: "paste-text", rows: "5", maxlength: "4000", placeholder: "Paste the whole message, for example an email saying a payee changed wallets." });
    const status = liveRegion();
    const answer = h("div", { class: "outcome-slot" });
    const button = h("button", { class: "btn primary", type: "submit" }, "Check this message");
    const form = h("form", {}, h("label", { for: "paste-text" }, "Paste a message you received", h("span", { class: "hint" }, "It goes through the same checks as a message forwarded to the bot. Code checks every address. The AI only reads the wording."), text), status, answer,
      h("div", { class: "actions" }, button, h("button", { class: "btn", type: "button", onclick: close }, "Close")));
    const payThenClose: PayFromMessage = (payeeId, amount) => {
      close();
      onPay(payeeId, amount);
    };
    listen(form, "submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      status.textContent = "Checking…";
      const result = await api<PasteAnswer>("POST", "/api/app/paste", { text: text.value });
      button.disabled = false;
      status.textContent = "";
      if (!result.ok) return void (status.textContent = result.error.message);
      answer.replaceChildren(...answerNodes(result.data, payThenClose));
      if (result.data.refusal || result.data.signUrl) onChanged();
    }, status);
    body.append(form);
  }, onChanged);
}
