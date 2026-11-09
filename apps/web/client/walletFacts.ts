import { formatUsdc, usdcToBaseUnits } from "@countersign/core";

const SUI_DECIMALS = 9;
const SUI_AMOUNT = /^(\d+)(?:\.(\d{1,9}))?$/;
const SHOWN_SUI_DIGITS = 4;
export const LOW_SUI_BASE_UNITS = 50_000_000n;

export const AGENT_WALLET = "Agent wallet: pays your bills";
export const AGENT_WALLET_FULL = "Agent wallet: pays your bills (fund this one)";
export const AGENT_WALLET_HEADING = "Agent wallet";
export const AGENT_WALLET_LINE = "Pays your bills. Fund this one.";
export const YOUR_WALLET_SHORT = "Your wallet (signs approvals)";
export const DEPOSIT_SHORT = "Deposit";
export const YOUR_WALLET = "Your wallet: approves changes and sends deposits. It never pays bills.";
export const DEPOSIT_ACTION = "Deposit from your wallet";
export const GOOGLE_ACTION = "Continue with Google";
export const OTHER_WALLET_ACTION = "Use another Sui wallet";
export const GOOGLE_WORDS = "No crypto wallet needed. Slush makes a free one from your Google account the first time. It signs your approvals. Your agent's own wallet pays the bills.";
export const SIGN_IN_HEADING = "Sign in or create your agent";
export const SLUSH_UNAVAILABLE = "Slush not available where you are? ";
export const PREPARING_SIGN_IN = "Preparing your sign-in message…";
export const CONNECT_FAILED = "Couldn't connect to your wallet. Nothing was signed. Try again.";
export const SIGN_REFUSED = "The wallet didn't sign. Nothing was signed or changed.";
export const SIGN_IN_REFUSED = "You didn't approve the sign-in, so nothing changed. Click Finish signing in to try again.";
export const DEPOSIT_NOT_SENT = "The wallet didn't send the deposit. Nothing was sent. Try again from Deposit.";
export const NO_OTHER_WALLET = "No other Sui wallet found in this browser. Install a Sui wallet extension, or continue with Google.";

export function signInWaiting(walletName: string): string {
  return `Waiting for ${walletName}… Nothing has been signed yet.`;
}

export const FAUCETS = [
  { label: "test SUI (faucet.sui.io)", href: "https://faucet.sui.io/?network=testnet" },
  { label: "test USDC (faucet.circle.com, choose Sui testnet)", href: "https://faucet.circle.com/" },
] as const;

const QUICK_AMOUNTS = ["0.10", "1", "5", "10"] as const;

export function quickAmounts(limitBaseUnits: bigint): readonly string[] {
  const allowed = QUICK_AMOUNTS.filter((amount) => BigInt(usdcToBaseUnits(amount) ?? "0") <= limitBaseUnits);
  return allowed.length > 0 ? allowed : [formatUsdc(limitBaseUnits)];
}

export function suiToBaseUnits(amountText: string): string | null {
  const match = SUI_AMOUNT.exec(amountText);
  if (!match) return null;
  const base = BigInt(match[1] ?? "0") * 10n ** BigInt(SUI_DECIMALS) + BigInt((match[2] ?? "").padEnd(SUI_DECIMALS, "0"));
  return base > 0n ? base.toString() : null;
}

export function formatSui(baseUnits: string | bigint): string {
  const padded = BigInt(baseUnits).toString().padStart(SUI_DECIMALS + 1, "0");
  const whole = padded.slice(0, -SUI_DECIMALS);
  const fraction = padded.slice(-SUI_DECIMALS, -SUI_DECIMALS + SHOWN_SUI_DIGITS).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export type NextScheduled = { readonly amountBaseUnits: string; readonly nextDue: string; readonly payeeId: string };
export type LowBalance = { readonly coin: "USDC" | "SUI"; readonly neededBaseUnits: string; readonly payeeId: string | null };

export function lowBalances(usdcBaseUnits: string, suiBaseUnits: string, next: NextScheduled | null): readonly LowBalance[] {
  const low: LowBalance[] = [];
  if (next && BigInt(usdcBaseUnits) < BigInt(next.amountBaseUnits)) low.push({ coin: "USDC", neededBaseUnits: next.amountBaseUnits, payeeId: next.payeeId });
  if (BigInt(suiBaseUnits) < LOW_SUI_BASE_UNITS) low.push({ coin: "SUI", neededBaseUnits: LOW_SUI_BASE_UNITS.toString(), payeeId: null });
  return low;
}
