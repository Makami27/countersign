import { api } from "../api.ts";
import { h, listen, liveRegion } from "../dom.ts";
import type { Overview } from "../types.ts";

const STEPS: readonly (readonly [keyof Overview["checklist"] | "signedIn", string])[] = [
  ["signedIn", "Sign in with your wallet"],
  ["funded", "Fund your agent with test SUI and test USDC (faucet links under Settings)"],
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

export function checklistCard(overview: Overview): HTMLElement {
  const items = STEPS.map(([key, label]) => {
    const done = key === "signedIn" || overview.checklist[key];
    return h("li", { class: done ? "done" : "" }, h("span", { class: "n", "aria-hidden": "true" }, done ? "✓" : "·"), h("span", {}, label), h("span", { class: "when" }, done ? "Done" : "To do"));
  });
  const steps = h("ol", { class: "steps" }, ...items);
  if (checklistDone(overview)) return h("details", { class: "card checklist done" }, h("summary", {}, "Getting started: every step done"), steps);
  return h("section", { class: "card checklist", "aria-labelledby": "checklist-title" }, h("h2", { id: "checklist-title" }, "Getting started"), steps);
}

type PasteAnswer = { readonly says?: string; readonly signUrl?: string | null; readonly refusal?: { readonly message: string; readonly nextAction: string; readonly receipt: string } };

export function pasteCard(onChanged: () => void): HTMLElement {
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
    answer.replaceChildren(...(r.refusal
      ? [h("p", { class: "money" }, "Refused. Nothing was sent and nothing was changed."), h("p", {}, [r.refusal.message, r.refusal.nextAction].filter(Boolean).join(" ")), h("p", { class: "links" }, h("a", { href: `/r/${r.refusal.receipt}` }, `Receipt ${r.refusal.receipt}`))]
      : [h("p", {}, r.says ?? ""), r.signUrl ? h("p", { class: "note" }, `Signing link for the payee: ${r.signUrl}`) : ""]));
    onChanged();
  }, status);
  return h("section", { class: "card", "aria-labelledby": "paste-title" }, h("h2", { id: "paste-title" }, "Check a message"), form);
}
