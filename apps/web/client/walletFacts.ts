const SUI_DECIMALS = 9;
const SUI_AMOUNT = /^(\d+)(?:\.(\d{1,9}))?$/;
const SHOWN_SUI_DIGITS = 4;
export const LOW_SUI_BASE_UNITS = 50_000_000n;

export const AGENT_WALLET = "Agent wallet: pays your bills";
export const AGENT_WALLET_FULL = "Agent wallet: pays your bills (fund this one)";
export const YOUR_WALLET = "Your wallet: signs approvals (never pays)";
export const DEPOSIT_ACTION = "Deposit from your wallet";

export const FAUCETS = [
  { label: "test SUI (faucet.sui.io)", href: "https://faucet.sui.io/?network=testnet" },
  { label: "test USDC (faucet.circle.com, choose Sui testnet)", href: "https://faucet.circle.com/" },
] as const;

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
