import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { SuiAddress } from "@countersign/core";
import type { Network } from "./client.ts";
import { USDC_COIN_TYPE } from "./payments.ts";

export const SUI_COIN_TYPE = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
const BASE_UNITS = /^(0|[1-9]\d*)$/;

export type HeldBalance = {
  readonly coinType: string;
  readonly totalBaseUnits: bigint;
  readonly inCoinObjectsBaseUnits: bigint;
  readonly inAddressBalanceBaseUnits: bigint;
};

export type AgentBalances =
  | { readonly status: "KNOWN"; readonly sui: HeldBalance; readonly usdc: HeldBalance }
  | { readonly status: "UNKNOWN"; readonly detail: string };

type RawBalance = { readonly coinType: string; readonly balance: string; readonly coinBalance: string; readonly addressBalance: string };

function held(raw: RawBalance): HeldBalance | null {
  if (![raw.balance, raw.coinBalance, raw.addressBalance].every((v) => BASE_UNITS.test(v))) return null;
  return { coinType: raw.coinType, totalBaseUnits: BigInt(raw.balance), inCoinObjectsBaseUnits: BigInt(raw.coinBalance), inAddressBalanceBaseUnits: BigInt(raw.addressBalance) };
}

export async function readAgentBalances(client: SuiGrpcClient, network: Network, owner: SuiAddress): Promise<AgentBalances> {
  let sui: RawBalance;
  let usdc: RawBalance;
  try {
    sui = (await client.getBalance({ owner, coinType: SUI_COIN_TYPE })).balance;
    usdc = (await client.getBalance({ owner, coinType: USDC_COIN_TYPE[network] })).balance;
  } catch (error) {
    return { status: "UNKNOWN", detail: error instanceof Error ? error.message.slice(0, 200) : "balance read failed" };
  }
  if (sui.coinType !== SUI_COIN_TYPE || usdc.coinType !== USDC_COIN_TYPE[network]) return { status: "UNKNOWN", detail: "the gateway answered for a different coin type" };
  const suiHeld = held(sui);
  const usdcHeld = held(usdc);
  if (!suiHeld || !usdcHeld) return { status: "UNKNOWN", detail: "the gateway returned a balance that is not an integer" };
  return { status: "KNOWN", sui: suiHeld, usdc: usdcHeld };
}
