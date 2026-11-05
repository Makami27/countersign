import { getWallets, type Wallet, type WalletAccount } from "@mysten/wallet-standard";
import { registerSlushWallet } from "@mysten/slush-wallet";

export type Connected = { readonly wallet: Wallet; readonly account: WalletAccount };
export type WalletStep<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export const POPUP_BLOCKED = "Your browser blocked the Slush window. Allow pop-ups for this site (icon at the right of the address bar), then click again.";
export const EXTENSION_TIP = "Tip: the Slush browser extension signs without pop-up windows.";

registerSlushWallet("Countersign");

const connected = new Map<string, Connected>();

export function signingWallets(): readonly Wallet[] {
  return getWallets().get().filter((w) => "standard:connect" in w.features && "sui:signPersonalMessage" in w.features);
}

export function onWalletsChanged(listener: () => void): void {
  getWallets().on("register", listener);
}

export function connectedAs(expected: string): Connected | null {
  return connected.get(expected.toLowerCase()) ?? null;
}

type ConnectFeature = { connect(): Promise<{ accounts: readonly WalletAccount[] }> };
type SignFeature = { signPersonalMessage(input: { message: Uint8Array; account: WalletAccount; chain?: `${string}:${string}` }): Promise<{ bytes: string; signature: string }> };

function blockedOr(error: unknown, otherwise: string): string {
  return error instanceof Error && /failed to open new window/i.test(error.message) ? POPUP_BLOCKED : otherwise;
}

export async function connectWallet(wallet: Wallet, expected: string | null, role: string): Promise<WalletStep<Connected>> {
  const connect = wallet.features["standard:connect"] as ConnectFeature | undefined;
  if (!connect || !("sui:signPersonalMessage" in wallet.features)) return { ok: false, message: `${wallet.name} can't sign messages. Nothing was signed.` };
  let accounts: readonly WalletAccount[];
  try {
    accounts = (await connect.connect()).accounts;
  } catch (error) {
    return { ok: false, message: blockedOr(error, `${wallet.name} didn't connect. Nothing was signed.`) };
  }
  const account = expected === null ? accounts[0] : accounts.find((a) => a.address.toLowerCase() === expected.toLowerCase());
  if (!account) {
    const shown = accounts.map((a) => a.address).join(", ") || "no account";
    return { ok: false, message: expected === null ? `${wallet.name} shared no account. Nothing was changed.` : `This step needs your ${role} ${expected}. ${wallet.name} offered ${shown}. Switch to that account in your wallet, then connect again. Nothing was signed.` };
  }
  const result = { wallet, account };
  connected.set(account.address.toLowerCase(), result);
  return { ok: true, value: result };
}

type ExecuteFeature = { signAndExecuteTransaction(input: { transaction: { toJSON(): Promise<string> }; account: WalletAccount; chain: `${string}:${string}` }): Promise<{ digest: string }> };

export function depositWallets(): readonly Wallet[] {
  return getWallets().get().filter((w) => "standard:connect" in w.features && "sui:signAndExecuteTransaction" in w.features);
}

export function rememberedAccount(wallet: Wallet, preferred: string | null): Connected | null {
  const known = preferred ? connected.get(preferred.toLowerCase()) : undefined;
  if (known?.wallet === wallet) return known;
  const accounts = wallet.accounts;
  const account = accounts.find((a) => a.address.toLowerCase() === preferred?.toLowerCase()) ?? [...connected.values()].find((c) => c.wallet === wallet)?.account;
  return account ? { wallet, account } : null;
}

export async function executeTransaction(by: Connected, transaction: string, network: "mainnet" | "testnet"): Promise<WalletStep<string>> {
  const execute = by.wallet.features["sui:signAndExecuteTransaction"] as ExecuteFeature | undefined;
  if (!execute) return { ok: false, message: `${by.wallet.name} can't send transactions. Nothing was sent.` };
  try {
    return { ok: true, value: (await execute.signAndExecuteTransaction({ transaction: { toJSON: async () => transaction }, account: by.account, chain: `sui:${network}` })).digest };
  } catch (error) {
    return { ok: false, message: blockedOr(error, "Your wallet didn't send it. Nothing was sent.") };
  }
}

export async function signMessage(by: Connected, message: string, network: "mainnet" | "testnet"): Promise<WalletStep<string>> {
  const sign = by.wallet.features["sui:signPersonalMessage"] as SignFeature | undefined;
  if (!sign) return { ok: false, message: `${by.wallet.name} can't sign messages. Nothing was signed.` };
  try {
    return { ok: true, value: (await sign.signPersonalMessage({ message: new TextEncoder().encode(message), account: by.account, chain: `sui:${network}` })).signature };
  } catch (error) {
    return { ok: false, message: blockedOr(error, "The wallet didn't sign. Nothing was signed or changed.") };
  }
}
