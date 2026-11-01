import { api } from "./api.ts";
import { addressEl, h, liveRegion, networkWords, when } from "./dom.ts";
import { walletStep, type WalletRole } from "./walletSteps.ts";

type Step = { readonly signedAt: string } | null;
type Base = { readonly network: "mainnet" | "testnet"; readonly memory: string; readonly payeeName: string; readonly message: string; readonly expires: string; readonly expired: boolean };
type OnboardingView = Base & { readonly kind: "onboarding"; readonly address: string };
type ChangeView = Base & { readonly kind: "change"; readonly fromAddress: string; readonly toAddress: string; readonly steps: { readonly current: Step; readonly next: Step }; readonly owner: { readonly confirmedAt: string; readonly readyAt: string } | null };
type CompletedView = { readonly kind: "completed"; readonly network: "mainnet" | "testnet"; readonly memory: string; readonly payeeName: string; readonly address: string; readonly verifiedNumber: number; readonly stillCurrent: boolean; readonly how: string; readonly at: string; readonly receipt: string | null };
type SignView = OnboardingView | ChangeView | CompletedView;
type Named = { readonly unknown?: boolean; readonly refusal?: { readonly message: string; readonly nextAction: string } };

const root = document.querySelector<HTMLElement>("#sign");
const banner = document.querySelector<HTMLElement>("#banner");
const nonce = location.pathname.split("/")[2] ?? "";

const CONFIRMED_BY: Record<string, string> = {
  continuity_signature: "confirmed by both wallets",
  owner_confirmed_change: "confirmed by the owner wallet and the new wallet",
  payee_onboarding: "confirmed by the payee's wallet",
};

function namedText(body: Record<string, unknown> | null, fallback: string): string {
  const refusal = (body as Named | null)?.refusal;
  return refusal ? [refusal.message, refusal.nextAction].filter(Boolean).join(" ") : fallback;
}

function stepRow(n: number, label: string, done: Step | "owner", note: string): HTMLElement {
  const finished = done !== null;
  return h("li", { class: finished ? "done" : "" }, h("span", { class: "n", "aria-hidden": "true" }, String(n)), h("span", {}, label), h("span", { class: "when" }, done === "owner" ? note : finished ? `Signed ${when(done.signedAt)}` : "Waiting"));
}

function nextRole(view: ChangeView): "current" | "new" | null {
  if (!view.steps.current && !view.owner) return "current";
  return view.steps.next ? null : "new";
}

function signStep(view: OnboardingView | ChangeView, role: "current" | "new" | "onboarding", expected: string, status: HTMLElement): HTMLElement {
  const walletRole: WalletRole = role === "current" ? "current wallet" : role === "new" ? "new wallet" : "wallet";
  return walletStep({ role: walletRole, expected, message: view.message, network: view.network, status, onSigned: async (signature) => {
    status.textContent = "Signed. Checking the signature through Tatum and writing the record to Walrus Memory (about 20 seconds)…";
    const result = await api("POST", `/api/sign/${nonce}`, { signature, role });
    if (!result.ok) return void (status.textContent = namedText(result.error.body, result.error.message));
    await render();
  } });
}

function completed(view: CompletedView): HTMLElement[] {
  const parts: (HTMLElement | null)[] = [
    h("h1", { tabindex: "-1" }, "Done"),
    h("p", { class: "money" }, "Nothing was sent."),
    h("p", { class: "note" }, networkWords(view.network)),
    h("p", {}, `${view.payeeName} now pays `, addressEl(view.address), ` (v${view.verifiedNumber}), ${CONFIRMED_BY[view.how] ?? "verified"}, ${when(view.at)}.`),
    view.stillCurrent ? null : h("p", { class: "note" }, "A later change has replaced this address since."),
    view.receipt ? h("p", { class: "links" }, h("a", { href: `/r/${view.receipt}` }, `Receipt ${view.receipt}`)) : null,
    h("p", { class: "note" }, "This link is used up. Nothing more needs signing."),
  ];
  return parts.filter((el): el is HTMLElement => el !== null);
}

function body(view: OnboardingView | ChangeView): HTMLElement[] {
  const status = liveRegion();
  const message = h("details", {}, h("summary", {}, "Exactly what you're signing"), h("pre", { class: "message" }, view.message), h("p", { class: "note" }, "This message approves this one request only, until it expires."));
  if (view.kind === "onboarding") {
    return [
      h("h1", { tabindex: "-1" }, `Confirm your wallet for ${view.payeeName}`),
      h("p", { class: "lede" }, "You were added as a payee of an agent that only pays wallets their owners have proven. Connect this wallet, then sign once. Signing costs nothing and moves no money."),
      h("dl", { class: "facts" }, h("div", {}, h("dt", {}, "Payee"), h("dd", {}, view.payeeName)), h("div", {}, h("dt", {}, "Your wallet"), h("dd", {}, addressEl(view.address))), h("div", {}, h("dt", {}, "Network"), h("dd", {}, networkWords(view.network))), h("div", {}, h("dt", {}, "Request expires"), h("dd", {}, when(view.expires)))),
      message, status, signStep(view, "onboarding", view.address, status),
      h("p", { class: "note" }, "Didn't expect this? Don't sign. Nothing is paid to this wallet unless it signs."),
    ];
  }
  const role = nextRole(view);
  return [
    h("h1", { tabindex: "-1" }, `Confirm your new wallet for ${view.payeeName}'s payments`),
    h("p", { class: "lede" }, view.owner ? "The owner confirmed this change. Connect the new wallet and sign once to prove it is yours. Signing costs nothing and moves no money." : "To move your payments, connect and sign with your current wallet, then connect and sign with the new one. Signing costs nothing and moves no money."),
    h("dl", { class: "facts" }, h("div", {}, h("dt", {}, "Payee"), h("dd", {}, view.payeeName)), h("div", {}, h("dt", {}, "Current wallet"), h("dd", {}, addressEl(view.fromAddress))), h("div", {}, h("dt", {}, "New wallet"), h("dd", {}, addressEl(view.toAddress))), h("div", {}, h("dt", {}, "Request expires"), h("dd", {}, when(view.expires)))),
    h("section", { "aria-labelledby": "steps-title" }, h("h2", { id: "steps-title", class: "note" }, "Two signatures"), h("ol", { class: "steps" },
      stepRow(1, view.owner ? "Confirmed by the owner" : "Connect and sign with your current wallet", view.owner ? "owner" : view.steps.current, view.owner ? `Waiting period ends ${when(view.owner.readyAt)}` : ""),
      stepRow(2, "Connect and sign with your new wallet", view.steps.next, ""))),
    message, status,
    role ? signStep(view, role, role === "current" ? view.fromAddress : view.toAddress, status) : h("p", { class: "money" }, view.owner && Date.parse(view.owner.readyAt) > Date.now() ? `Both steps are done. The change takes effect when the owner's waiting period ends, ${when(view.owner.readyAt)}.` : "Both steps are done. The change is being recorded."),
    h("p", { class: "note" }, "Didn't ask for this? Don't sign. Your payments keep going to your current wallet."),
  ];
}

async function render(): Promise<void> {
  const result = await api<SignView>("GET", `/api/sign/${nonce}`);
  if (!result.ok) {
    const unknown = (result.error.body as Named | null)?.unknown === true;
    root?.replaceChildren(h("h1", { tabindex: "-1" }, unknown ? "This link doesn't match any request" : "This link can't be used"), h("p", { class: "money" }, "Nothing was changed."),
      h("p", {}, unknown ? "Check that you opened the whole link, or ask the person who sent it for a new one." : namedText(result.error.body, result.error.message)));
    return;
  }
  const view = result.data;
  if (banner) {
    banner.hidden = !view.memory.startsWith("sandbox");
    banner.textContent = banner.hidden ? "" : "Sandbox memory: nothing here is stored on Walrus Memory. For local screen checks only.";
  }
  if (view.kind === "completed") root?.replaceChildren(...completed(view));
  else if (view.expired) root?.replaceChildren(h("h1", { tabindex: "-1" }, "This request expired"), h("p", { class: "money" }, "Nothing was changed."), h("p", {}, "Ask the person who sent the link to start a new request."));
  else root?.replaceChildren(...body(view));
  root?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
}

void render();
