import { getWallets } from "@mysten/wallet-standard";
import { registerSlushWallet } from "@mysten/slush-wallet";

registerSlushWallet("Countersign S10z spike");

const list = document.querySelector("#wallets");
const status = document.querySelector("#status");
const result = document.querySelector("#result");

function say(text) {
  status.textContent = text;
}

function signers() {
  return getWallets().get().filter((wallet) => wallet.features["standard:connect"] && wallet.features["sui:signPersonalMessage"]);
}

function render() {
  const wallets = signers();
  list.replaceChildren(...wallets.map((wallet) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Connect ${wallet.name} and sign`;
    button.addEventListener("click", () => run(wallet));
    return button;
  }));
  if (wallets.length === 0) say("No Sui wallet found yet. Install or unlock Slush, then reload.");
}

async function run(wallet) {
  try {
    say(`Connecting ${wallet.name}…`);
    const { accounts } = await wallet.features["standard:connect"].connect();
    const account = accounts[0];
    if (!account) return say("The wallet returned no account. Nothing was signed.");
    const challenge = await (await fetch("/challenge")).json();
    say(`Waiting for ${wallet.name} to sign. Signing moves no money.`);
    const signed = await wallet.features["sui:signPersonalMessage"].signPersonalMessage({
      message: new TextEncoder().encode(challenge.message),
      account,
      chain: "sui:mainnet",
    });
    say("Signed. Verifying through Tatum on mainnet and testnet (about 10 s)…");
    const response = await fetch("/signature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: account.address, bytes: signed.bytes, signature: signed.signature, wallet: wallet.name }),
    });
    const summary = await response.json();
    say(summary.headline);
    result.textContent = JSON.stringify(summary, null, 2);
  } catch (error) {
    say(`Stopped: ${error instanceof Error ? error.message : String(error)}. Nothing was sent.`);
  }
}

getWallets().on("register", render);
render();
