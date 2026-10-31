import { getWallets, type Wallet, type WalletAccount } from "@mysten/wallet-standard";
import { registerSlushWallet } from "@mysten/slush-wallet";

export type SignedBy = { readonly signature: string; readonly address: string };
export type WalletStep = { readonly ok: true; readonly signed: SignedBy } | { readonly ok: false; readonly message: string };

registerSlushWallet("Countersign");

export function signingWallets(): readonly Wallet[] {
  return getWallets().get().filter((w) => "standard:connect" in w.features && "sui:signPersonalMessage" in w.features);
}

export function onWalletsChanged(listener: () => void): void {
  getWallets().on("register", listener);
}

type ConnectFeature = { connect(): Promise<{ accounts: readonly WalletAccount[] }> };
type SignFeature = { signPersonalMessage(input: { message: Uint8Array; account: WalletAccount; chain?: `${string}:${string}` }): Promise<{ bytes: string; signature: string }> };

export async function signWith(wallet: Wallet, expected: string, message: string, network: "mainnet" | "testnet"): Promise<WalletStep> {
  const connect = wallet.features["standard:connect"] as ConnectFeature | undefined;
  const sign = wallet.features["sui:signPersonalMessage"] as SignFeature | undefined;
  if (!connect || !sign) return { ok: false, message: `${wallet.name} can't sign messages. Nothing was signed.` };
  let accounts: readonly WalletAccount[];
  try {
    accounts = (await connect.connect()).accounts;
  } catch {
    return { ok: false, message: `${wallet.name} didn't connect. Nothing was signed.` };
  }
  const account = accounts.find((a) => a.address.toLowerCase() === expected.toLowerCase());
  if (!account) {
    const shown = accounts.map((a) => a.address).join(", ") || "no account";
    return { ok: false, message: `This step needs the wallet ${expected}. ${wallet.name} offered ${shown}. Switch to that account in your wallet and try again. Nothing was signed.` };
  }
  try {
    const signed = await sign.signPersonalMessage({ message: new TextEncoder().encode(message), account, chain: `sui:${network}` });
    return { ok: true, signed: { signature: signed.signature, address: account.address } };
  } catch {
    return { ok: false, message: "The wallet didn't sign. Nothing was signed or changed." };
  }
}

export async function connectedAddress(): Promise<{ readonly ok: true; readonly address: string } | { readonly ok: false; readonly message: string }> {
  const wallet = signingWallets()[0];
  const connect = wallet?.features["standard:connect"] as ConnectFeature | undefined;
  if (!wallet || !connect) return { ok: false, message: "No Sui wallet was found in this browser. Nothing was changed." };
  try {
    const address = (await connect.connect()).accounts[0]?.address;
    return address ? { ok: true, address } : { ok: false, message: `${wallet.name} shared no account. Nothing was changed.` };
  } catch {
    return { ok: false, message: `${wallet.name} didn't connect. Nothing was changed.` };
  }
}
