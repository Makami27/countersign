import type { Wallet } from "@mysten/wallet-standard";
import { api } from "../api.ts";
import { h, listen, liveRegion } from "../dom.ts";
import { EXTENSION_TIP, connectWallet, slushOnTheWeb, signingWallets, walletLabel } from "../signFlow.ts";
import { GOOGLE_ACTION, GOOGLE_WORDS, NO_OTHER_WALLET, OTHER_WALLET_ACTION, PREPARING_SIGN_IN, SIGN_IN_HEADING, SIGN_IN_REFUSED, SLUSH_UNAVAILABLE, signInWaiting } from "../walletFacts.ts";
import { walletStep } from "../walletSteps.ts";

type Challenge = { readonly nonce: string; readonly message: string; readonly expires: string; readonly network: "mainnet" | "testnet" };

export function signInPage(onSignedIn: (address: string) => void, why: string | null, startWithChooser: boolean): HTMLElement {
  const status = liveRegion();
  const box = h("div", { class: "sign-in-box" });

  const connectingButton = (wallet: Wallet, label: string, primary: boolean) => {
    const button = h("button", { class: primary ? "btn primary sign-in-main" : "btn", type: "button" }, label);
    listen(button, "click", async () => {
      const connecting = connectWallet(wallet, null, "wallet");
      button.disabled = true;
      status.textContent = signInWaiting(walletLabel(wallet));
      const connected = await connecting;
      button.disabled = false;
      if (!connected.ok) return void (status.textContent = connected.message);
      const address = connected.value.account.address;
      status.textContent = PREPARING_SIGN_IN;
      const challenge = await api<Challenge>("POST", "/api/session/challenge", { address });
      if (!challenge.ok) return void (status.textContent = challenge.error.message);
      status.textContent = "One more step: approve signing in. It costs nothing and moves no money.";
      box.replaceChildren(
        walletStep({ role: "wallet", expected: address, message: challenge.data.message, network: challenge.data.network, status, signLabel: "Finish signing in", refusedWords: SIGN_IN_REFUSED, waitingWords: signInWaiting, onSigned: async (signature) => {
          status.textContent = "Checking your signature through Tatum…";
          const session = await api("POST", "/api/session", { address, nonce: challenge.data.nonce, signature });
          if (!session.ok) return void (status.textContent = session.error.message);
          onSignedIn(address);
        } }),
        h("details", {}, h("summary", {}, "Exactly what you're approving"), h("pre", { class: "message" }, challenge.data.message)));
    }, status);
    return button;
  };

  const chooser = () => {
    const wallets = signingWallets().filter((wallet) => wallet !== slushOnTheWeb());
    box.replaceChildren(
      ...(wallets.length
        ? [h("div", { class: "actions" }, ...wallets.map((wallet) => connectingButton(wallet, `Sign in with ${walletLabel(wallet)}`, false))), h("p", { class: "note" }, EXTENSION_TIP)]
        : [h("p", { class: "note" }, NO_OTHER_WALLET)]),
      h("button", { class: "link-button", type: "button", onclick: main }, GOOGLE_ACTION));
  };

  const main = () => {
    box.replaceChildren(
      connectingButton(slushOnTheWeb(), GOOGLE_ACTION, true),
      h("p", { class: "note" }, SLUSH_UNAVAILABLE, h("button", { class: "link-button", type: "button", onclick: chooser }, OTHER_WALLET_ACTION), "."));
  };

  if (startWithChooser) chooser();
  else main();
  const notice = why ? h("p", { class: "note", role: "status" }, why) : "";
  return h("section", { class: "narrow", "aria-labelledby": "login-title" }, h("h1", { id: "login-title" }, SIGN_IN_HEADING),
    h("div", { class: "signing-line" }, h("span", { class: "line", "aria-hidden": "true" }), h("span", {}, GOOGLE_WORDS)), notice, status, box);
}
