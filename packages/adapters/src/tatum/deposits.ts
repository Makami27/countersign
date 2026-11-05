import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { TransactionError } from "@mysten/sui/client";
import { normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { SuiAddress } from "@countersign/core";
import { SUI_COIN_TYPE, readAgentBalances } from "./balances.ts";
import type { Network } from "./client.ts";
import { USDC_COIN_TYPE } from "./payments.ts";

export const DEPOSIT_FEE_RESERVE_BASE_UNITS = 10_000_000n;

export type DepositAmounts = { readonly usdcBaseUnits: bigint; readonly suiBaseUnits: bigint };
export type PreparedDeposit =
  | { readonly ok: true; readonly transaction: string }
  | { readonly ok: false; readonly kind: "NOT_ENOUGH"; readonly coin: "USDC" | "SUI"; readonly heldBaseUnits: bigint; readonly neededBaseUnits: bigint }
  | { readonly ok: false; readonly kind: "UNKNOWN"; readonly detail: string };
export type DepositSighting =
  | { readonly kind: "CONFIRMED"; readonly usdcBaseUnits: bigint; readonly suiBaseUnits: bigint }
  | { readonly kind: "FAILED" | "NOT_FOUND" }
  | { readonly kind: "UNKNOWN"; readonly detail: string };

function short(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "unexpected error";
}

export function depositTransaction(network: Network, sender: SuiAddress, to: SuiAddress, amounts: DepositAmounts): Transaction {
  const tx = new Transaction();
  tx.setSender(sender);
  const coins = [
    ...(amounts.usdcBaseUnits > 0n ? [coinWithBalance({ type: USDC_COIN_TYPE[network], balance: amounts.usdcBaseUnits })] : []),
    ...(amounts.suiBaseUnits > 0n ? [coinWithBalance({ balance: amounts.suiBaseUnits })] : []),
  ];
  tx.transferObjects(coins, to);
  return tx;
}

export async function prepareDeposit(client: SuiGrpcClient, network: Network, sender: SuiAddress, to: SuiAddress, amounts: DepositAmounts): Promise<PreparedDeposit> {
  const held = await readAgentBalances(client, network, sender);
  if (held.status !== "KNOWN") return { ok: false, kind: "UNKNOWN", detail: held.detail };
  if (held.usdc.totalBaseUnits < amounts.usdcBaseUnits) return { ok: false, kind: "NOT_ENOUGH", coin: "USDC", heldBaseUnits: held.usdc.totalBaseUnits, neededBaseUnits: amounts.usdcBaseUnits };
  const suiNeeded = amounts.suiBaseUnits + DEPOSIT_FEE_RESERVE_BASE_UNITS;
  if (held.sui.totalBaseUnits < suiNeeded) return { ok: false, kind: "NOT_ENOUGH", coin: "SUI", heldBaseUnits: held.sui.totalBaseUnits, neededBaseUnits: suiNeeded };
  try {
    return { ok: true, transaction: await depositTransaction(network, sender, to, amounts).toJSON({ client, supportedIntents: [] }) };
  } catch (error) {
    return { ok: false, kind: "UNKNOWN", detail: short(error) };
  }
}

type Sightable = Pick<SuiGrpcClient, "getTransaction">;

export async function sightDeposit(client: Sightable, network: Network, digest: string, to: SuiAddress): Promise<DepositSighting> {
  try {
    const result = await client.getTransaction({ digest, include: { balanceChanges: true } });
    if (result.$kind !== "Transaction") return { kind: "FAILED" };
    const credited = (coinType: string): bigint => (result.Transaction.balanceChanges ?? [])
      .filter((c) => normalizeSuiAddress(c.address) === to && normalizeStructTag(c.coinType) === normalizeStructTag(coinType) && BigInt(c.amount) > 0n)
      .reduce((sum, c) => sum + BigInt(c.amount), 0n);
    return { kind: "CONFIRMED", usdcBaseUnits: credited(USDC_COIN_TYPE[network]), suiBaseUnits: credited(SUI_COIN_TYPE) };
  } catch (error) {
    if (error instanceof TransactionError && error.reason === "notFound") return { kind: "NOT_FOUND" };
    return { kind: "UNKNOWN", detail: short(error) };
  }
}
