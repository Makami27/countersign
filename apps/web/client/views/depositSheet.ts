import { formatUsdc, usdcToBaseUnits } from "@countersign/core";
import { api } from "../api.ts";
import { addressEl, h, listen, liveRegion, networkWords } from "../dom.ts";
import { EXTENSION_TIP, connectWallet, depositWallets, executeTransaction, rememberedAccount, type Connected } from "../signFlow.ts";
import type { Overview } from "../types.ts";
import { AGENT_WALLET, DEPOSIT_ACTION, FAUCETS, formatSui, suiToBaseUnits } from "../walletFacts.ts";
import { openSheet } from "./sheets.ts";

type Prepared = { readonly transaction: string; readonly to: string; readonly sender: string; readonly usdcBaseUnits: string; readonly suiBaseUnits: string };
type Confirmation = { readonly state: "CONFIRMED" | "FAILED" | "NOT_FOUND" | "UNKNOWN"; readonly usdcBaseUnits?: string; readonly suiBaseUnits?: string };

const CONFIRM_EVERY_MS = 2_000;
const CONFIRM_TRIES = 15;

function moneyWords(usdcBase: string, suiBase: string, test: string): string {
  const parts = [BigInt(usdcBase) > 0n ? `${formatUsdc(BigInt(usdcBase))} ${test}USDC` : null, BigInt(suiBase) > 0n ? `${formatSui(suiBase)} ${test}SUI` : null].filter(Boolean);
  return parts.join(" and ");
}

async function confirmDeposit(digest: string): Promise<Confirmation | null> {
  for (let attempt = 0; attempt < CONFIRM_TRIES; attempt++) {
    const answer = await api<Confirmation>("POST", "/api/app/deposits/confirm", { digest });
    if (answer.ok && (answer.data.state === "CONFIRMED" || answer.data.state === "FAILED")) return answer.data;
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_EVERY_MS));
  }
  return null;
}

function faucetNote(overview: Overview): HTMLElement | null {
  if (overview.network !== "testnet") return null;
  return h("p", { class: "note" }, "Your wallet needs test funds first? Get them from ", h("a", { href: FAUCETS[0].href, target: "_blank", rel: "noreferrer" }, FAUCETS[0].label), " and ", h("a", { href: FAUCETS[1].href, target: "_blank", rel: "noreferrer" }, FAUCETS[1].label), ".");
}

export function depositSheet(overview: Overview, onClosed: () => void): void {
  const test = overview.network === "testnet" ? "test " : "";
  openSheet(DEPOSIT_ACTION, (close, body) => {
    const usdcAmount = h("input", { id: "deposit-usdc", inputmode: "decimal", autocomplete: "off", placeholder: "5" });
    const suiAmount = h("input", { id: "deposit-sui", inputmode: "decimal", autocomplete: "off", placeholder: "0.25" });
    const status = liveRegion();
    const stage = h("div", { class: "sheet-stage" });
    const owner = overview.ownerWallet.known ? (overview.ownerWallet.current?.address ?? null) : null;

    const review = (prepared: Prepared, by: Connected) => {
      const sign = h("button", { class: "btn primary", type: "button" }, `Sign in ${by.wallet.name}`);
      listen(sign, "click", async () => {
        const sending = executeTransaction(by, prepared.transaction, overview.network);
        sign.disabled = true;
        status.textContent = `Waiting for ${by.wallet.name}. Check the amount and destination there before you sign.`;
        const sent = await sending;
        sign.disabled = false;
        if (!sent.ok) return void (status.textContent = sent.message);
        finishing(prepared, sent.value);
      }, status);
      stage.replaceChildren(
        h("p", { class: "money" }, `Send ${moneyWords(prepared.usdcBaseUnits, prepared.suiBaseUnits, test)}. Nothing has moved yet.`),
        h("div", { class: "compare" },
          h("div", { class: "row" }, h("span", { class: "label" }, "From your wallet"), addressEl(prepared.sender)),
          h("div", { class: "row" }, h("span", { class: "label" }, `To ${AGENT_WALLET}`), addressEl(prepared.to))),
        h("p", { class: "note" }, `${networkWords(overview.network)}. This is a plain transfer and nothing else; your wallet also takes a small network fee in SUI.`),
        status,
        h("div", { class: "actions" }, sign, h("button", { class: "btn", type: "button", onclick: () => amounts() }, "Change amounts")));
    };

    const finishing = (prepared: Prepared, digest: string) => {
      const money = moneyWords(prepared.usdcBaseUnits, prepared.suiBaseUnits, test);
      const line = h("p", { class: "money", role: "status" }, `Your wallet sent ${money}. Confirming it through Tatum…`);
      stage.replaceChildren(line, h("p", { class: "note" }, `Transaction ${digest}`), h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: close }, "Close")));
      void confirmDeposit(digest).then((confirmed) => {
        if (!confirmed) return void (line.textContent = `Your wallet sent it, but Tatum hasn't confirmed it yet. Don't send it again: the balance updates when it lands.`);
        if (confirmed.state === "FAILED") return void (line.textContent = "The transfer failed on chain. No funds moved; only the network fee was spent. You can try again.");
        line.textContent = `Deposit confirmed: the agent wallet received ${moneyWords(confirmed.usdcBaseUnits ?? "0", confirmed.suiBaseUnits ?? "0", test)}.`;
      });
    };

    const prepare = async (by: Connected, usdcText: string, suiText: string) => {
      status.textContent = "Preparing the transfer through Tatum. Nothing is signed yet.";
      const prepared = await api<Prepared>("POST", "/api/app/deposits/prepare", { sender: by.account.address, usdc: usdcText, sui: suiText });
      if (!prepared.ok) return void (status.textContent = prepared.error.message);
      status.textContent = "";
      review(prepared.data, by);
    };

    const connect = (usdcText: string, suiText: string) => {
      const wallets = depositWallets();
      const known = wallets.map((wallet) => rememberedAccount(wallet, owner)).find((found) => found !== null);
      if (known) return prepare(known, usdcText, suiText);
      const buttons = wallets.map((wallet) => {
        const button = h("button", { class: "btn primary", type: "button" }, `Connect your wallet (${wallet.name})`);
        listen(button, "click", async () => {
          const connecting = connectWallet(wallet, null, "wallet");
          button.disabled = true;
          status.textContent = `Waiting for ${wallet.name} to connect.`;
          const connected = await connecting;
          button.disabled = false;
          if (!connected.ok) return void (status.textContent = connected.message);
          await prepare(connected.value, usdcText, suiText);
        }, status);
        return button;
      });
      stage.replaceChildren(h("p", {}, "Connect the wallet you're sending from. Nothing is signed yet."), status,
        h("div", { class: "actions" }, ...(buttons.length ? buttons : [h("p", { class: "note" }, "No Sui wallet found. Install or unlock Slush, then reload this page.")]), h("button", { class: "btn", type: "button", onclick: () => amounts() }, "Change amounts")), h("p", { class: "note" }, EXTENSION_TIP));
      return Promise.resolve();
    };

    const amounts = () => {
      const form = h("form", {},
        h("p", {}, `Your wallet sends a normal transfer to the agent wallet. You see the amount and the full address before signing.`),
        h("label", { for: "deposit-usdc" }, `${test}USDC to send`, h("span", { class: "hint" }, "This is what pays your bills."), usdcAmount),
        h("label", { for: "deposit-sui" }, `${test}SUI to send`, h("span", { class: "hint" }, "This pays network fees. 0.25 lasts many payments."), suiAmount),
        faucetNote(overview), status,
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Review the transfer"), h("button", { class: "btn", type: "button", onclick: close }, "Cancel")));
      listen(form, "submit", async (event) => {
        event.preventDefault();
        const usdcText = usdcAmount.value.trim();
        const suiText = suiAmount.value.trim();
        if (!usdcText && !suiText) return void (status.textContent = "Give an amount of USDC, SUI or both. Nothing was signed.");
        if (usdcText && !usdcToBaseUnits(usdcText)) return void (status.textContent = "Give the USDC amount as a number, for example 5. Nothing was signed.");
        if (suiText && !suiToBaseUnits(suiText)) return void (status.textContent = "Give the SUI amount as a number, for example 0.25. Nothing was signed.");
        await connect(usdcText, suiText);
      }, status);
      stage.replaceChildren(form);
    };

    amounts();
    body.append(stage);
  }, onClosed);
}
