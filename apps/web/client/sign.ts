import { api } from "./api.ts";
import { addressEl, h, liveRegion, networkWords, when, listen } from "./dom.ts";
import { onWalletsChanged, signWith, signingWallets } from "./signFlow.ts";

type Step = { readonly signedAt: string } | null;
type Base = { readonly network: "mainnet" | "testnet"; readonly memory: string; readonly payeeName: string; readonly message: string; readonly expires: string; readonly expired: boolean };
type OnboardingView = Base & { readonly kind: "onboarding"; readonly address: string };
type ChangeView = Base & { readonly kind: "change"; readonly fromAddress: string; readonly toAddress: string; readonly steps: { readonly current: Step; readonly next: Step }; readonly owner: { readonly confirmedAt: string; readonly readyAt: string } | null };
type SignView = OnboardingView | ChangeView;
type Named = { readonly refusal?: { readonly message: string; readonly nextAction: string } };

const root = document.querySelector<HTMLElement>("#sign");
const banner = document.querySelector<HTMLElement>("#banner");
const nonce = location.pathname.split("/")[2] ?? "";

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

function walletButtons(expected: string, view: SignView, role: "current" | "new" | "onboarding", status: HTMLElement): HTMLElement {
  const box = h("div", { class: "actions" });
  const draw = () => {
    const wallets = signingWallets();
    box.replaceChildren(...(wallets.length ? wallets.map((wallet) => {
      const button = h("button", { class: "btn primary", type: "button" }, `Sign with ${wallet.name}`);
      listen(button, "click", async () => {
        button.disabled = true;
        status.textContent = `Waiting for ${wallet.name}. Signing moves no money.`;
        const step = await signWith(wallet, expected, view.message, view.network);
        if (!step.ok) {
          button.disabled = false;
          return void (status.textContent = step.message);
        }
        status.textContent = "Signed. Checking the signature through Tatum and writing the record to Walrus Memory (about 20 seconds)…";
        const result = await api<{ completion?: { state: string; waitingFor?: string; readyAt?: string | null } }>("POST", `/api/sign/${nonce}`, { signature: step.signed.signature, role });
        if (!result.ok) {
          button.disabled = false;
          return void (status.textContent = namedText(result.error.body, result.error.message));
        }
        void render();
      }, status);
      return button;
    }) : [h("p", { class: "note" }, "No Sui wallet found. Install or unlock Slush, then reload this page.")]));
  };
  draw();
  onWalletsChanged(draw);
  return box;
}

function body(view: SignView): HTMLElement[] {
  const status = liveRegion();
  const message = h("details", {}, h("summary", {}, "Exactly what you're signing"), h("pre", { class: "message" }, view.message), h("p", { class: "note" }, "This message approves this one request only, until it expires."));
  if (view.kind === "onboarding") {
    return [
      h("h1", { tabindex: "-1" }, `Confirm your wallet for ${view.payeeName}`),
      h("p", { class: "lede" }, "You were added as a payee of an agent that only pays wallets their owners have proven. Sign once with this wallet. Signing costs nothing and moves no money."),
      h("dl", { class: "facts" }, h("div", {}, h("dt", {}, "Payee"), h("dd", {}, view.payeeName)), h("div", {}, h("dt", {}, "Your wallet"), h("dd", {}, addressEl(view.address))), h("div", {}, h("dt", {}, "Network"), h("dd", {}, networkWords(view.network))), h("div", {}, h("dt", {}, "Request expires"), h("dd", {}, when(view.expires)))),
      message, status, walletButtons(view.address, view, "onboarding", status),
      h("p", { class: "note" }, "Didn't expect this? Don't sign. Nothing is paid to this wallet unless it signs."),
    ];
  }
  const role = nextRole(view);
  const expected = role === "current" ? view.fromAddress : view.toAddress;
  return [
    h("h1", { tabindex: "-1" }, `Confirm your new wallet for ${view.payeeName}'s payments`),
    h("p", { class: "lede" }, view.owner ? "The owner confirmed this change. Sign once with the new wallet to prove it is yours. Signing costs nothing and moves no money." : "To move your payments, sign once with the wallet you use now, then once with the new one. Signing costs nothing and moves no money."),
    h("dl", { class: "facts" }, h("div", {}, h("dt", {}, "Payee"), h("dd", {}, view.payeeName)), h("div", {}, h("dt", {}, "Current wallet"), h("dd", {}, addressEl(view.fromAddress))), h("div", {}, h("dt", {}, "New wallet"), h("dd", {}, addressEl(view.toAddress))), h("div", {}, h("dt", {}, "Request expires"), h("dd", {}, when(view.expires)))),
    h("section", { "aria-labelledby": "steps-title" }, h("h2", { id: "steps-title", class: "note" }, "Two signatures"), h("ol", { class: "steps" },
      stepRow(1, view.owner ? "Confirmed by the owner" : "Sign with your current wallet", view.owner ? "owner" : view.steps.current, view.owner ? `Waiting period ends ${when(view.owner.readyAt)}` : ""),
      stepRow(2, "Sign with your new wallet", view.steps.next, ""))),
    message, status,
    role ? walletButtons(expected, view, role, status) : h("p", { class: "money" }, view.owner && Date.parse(view.owner.readyAt) > Date.now() ? `Both steps are done. The change takes effect when the owner's waiting period ends, ${when(view.owner.readyAt)}.` : "Both steps are done. The change is being recorded."),
    h("p", { class: "note" }, "Didn't ask for this? Don't sign. Your payments keep going to your current wallet."),
  ];
}

async function render(): Promise<void> {
  const result = await api<SignView>("GET", `/api/sign/${nonce}`);
  if (!result.ok) {
    root?.replaceChildren(h("h1", { tabindex: "-1" }, "This link can't be used"), h("p", { class: "money" }, "Nothing was changed."), h("p", {}, namedText(result.error.body, result.error.message)));
    return;
  }
  const view = result.data;
  if (banner) {
    banner.hidden = !view.memory.startsWith("sandbox");
    banner.textContent = banner.hidden ? "" : "Sandbox memory: nothing here is stored on Walrus Memory. For local screen checks only.";
  }
  if (view.expired) {
    root?.replaceChildren(h("h1", { tabindex: "-1" }, "This request expired"), h("p", { class: "money" }, "Nothing was changed."), h("p", {}, "Ask the person who sent the link to start a new request."));
    return;
  }
  root?.replaceChildren(...body(view));
  root?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
}

void render();
