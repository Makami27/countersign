import { h, listen } from "./dom.ts";
import { SIGN_REFUSED } from "./walletFacts.ts";
import { EXTENSION_TIP, connectWallet, connectedAs, onWalletsChanged, signMessage, signingWallets, walletLabel, type Connected } from "./signFlow.ts";

export type WalletRole = "current wallet" | "new wallet" | "owner wallet" | "wallet";

export type StepOptions = {
  readonly role: WalletRole;
  readonly expected: string;
  readonly message: string;
  readonly network: "mainnet" | "testnet";
  readonly status: HTMLElement;
  readonly onSigned: (signature: string) => Promise<void>;
  readonly signLabel?: string;
  readonly refusedWords?: string;
  readonly waitingWords?: (walletName: string) => string;
};

function roleWords(role: WalletRole): string {
  return role === "wallet" || role === "owner wallet" ? "your wallet" : `the ${role}`;
}

export function walletStep(o: StepOptions): HTMLElement {
  const box = h("div", { class: "actions" });
  const signButton = (by: Connected) => {
    const button = h("button", { class: "btn primary", type: "button" }, o.signLabel ?? `Sign with ${roleWords(o.role)}`);
    listen(button, "click", async () => {
      const signing = signMessage(by, o.message, o.network);
      button.disabled = true;
      o.status.textContent = o.waitingWords?.(walletLabel(by.wallet)) ?? `Waiting for ${by.wallet.name}. Signing moves no money.`;
      const signed = await signing;
      button.disabled = false;
      if (!signed.ok) return void (o.status.textContent = signed.message === SIGN_REFUSED && o.refusedWords ? o.refusedWords : signed.message);
      await o.onSigned(signed.value);
    }, o.status);
    box.replaceChildren(button);
  };
  const draw = () => {
    const known = connectedAs(o.expected);
    if (known) return signButton(known);
    const wallets = signingWallets();
    box.replaceChildren(...(wallets.length ? wallets.map((wallet) => {
      const button = h("button", { class: "btn primary", type: "button" }, `Connect ${roleWords(o.role)} (${walletLabel(wallet)})`);
      listen(button, "click", async () => {
        const connecting = connectWallet(wallet, o.expected, roleWords(o.role));
        button.disabled = true;
        o.status.textContent = `Waiting for ${wallet.name} to connect.`;
        const result = await connecting;
        button.disabled = false;
        if (!result.ok) return void (o.status.textContent = result.message);
        o.status.textContent = `Connected. Now sign with ${roleWords(o.role)}.`;
        signButton(result.value);
      }, o.status);
      return button;
    }) : [h("p", { class: "note" }, "No Sui wallet found. Install or unlock Slush, then reload this page.")]), h("p", { class: "note" }, EXTENSION_TIP));
  };
  draw();
  onWalletsChanged(() => {
    if (!connectedAs(o.expected)) draw();
  });
  return box;
}
