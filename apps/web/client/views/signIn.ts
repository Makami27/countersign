import { api } from "../api.ts";
import { h, listen, liveRegion } from "../dom.ts";
import { EXTENSION_TIP, connectWallet, signingWallets } from "../signFlow.ts";
import { walletStep } from "../walletSteps.ts";

type Challenge = { readonly nonce: string; readonly message: string; readonly expires: string; readonly network: "mainnet" | "testnet" };

export function signInPage(onSignedIn: () => void, why: string | null): HTMLElement {
  const status = liveRegion();
  const box = h("div", {});
  const wallets = signingWallets();
  const buttons = wallets.map((wallet) => {
    const button = h("button", { class: "btn primary", type: "button" }, `Sign in with your wallet (${wallet.name})`);
    listen(button, "click", async () => {
      const connecting = connectWallet(wallet, null, "wallet");
      button.disabled = true;
      status.textContent = `Waiting for ${wallet.name} to connect.`;
      const connected = await connecting;
      button.disabled = false;
      if (!connected.ok) return void (status.textContent = connected.message);
      const address = connected.value.account.address;
      status.textContent = "Getting a one-time sign-in message…";
      const challenge = await api<Challenge>("POST", "/api/session/challenge", { address });
      if (!challenge.ok) return void (status.textContent = challenge.error.message);
      status.textContent = "Now sign the message. It proves this wallet is yours; it costs nothing and moves no money.";
      box.replaceChildren(h("details", {}, h("summary", {}, "Exactly what you're signing"), h("pre", { class: "message" }, challenge.data.message)),
        walletStep({ role: "wallet", expected: address, message: challenge.data.message, network: challenge.data.network, status, onSigned: async (signature) => {
          status.textContent = "Checking your signature through Tatum…";
          const session = await api("POST", "/api/session", { address, nonce: challenge.data.nonce, signature });
          if (!session.ok) return void (status.textContent = session.error.message);
          onSignedIn();
        } }));
    }, status);
    return button;
  });
  box.append(h("div", { class: "actions" }, ...(buttons.length ? buttons : [h("p", { class: "note" }, "No Sui wallet found. Install Slush (it lets you continue with Google), then reload this page.")])), h("p", { class: "note" }, EXTENSION_TIP));
  const notice = why ? h("p", { class: "note", role: "status" }, why) : "";
  return h("section", { class: "narrow", "aria-labelledby": "login-title" }, h("h1", { id: "login-title" }, "Sign in to your agent"),
    h("p", { class: "lede" }, "Sign in with your Sui wallet. Slush lets you continue with Google. The first wallet to sign in becomes this agent's owner wallet."), notice, status, box);
}
