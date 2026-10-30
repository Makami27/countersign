import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Signer } from "@mysten/sui/cryptography";
import type { SuiAddress } from "@countersign/core";

export const USDC_COIN_TYPE = {
  mainnet: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  testnet: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
} as const;

export type PaymentResult =
  | { readonly state: "SENT"; readonly digest: string }
  | { readonly state: "FAILED"; readonly digest: string | null; readonly detail: string }
  | { readonly state: "UNKNOWN"; readonly detail: string };

export async function sendUsdc(client: SuiGrpcClient, signer: Signer, network: keyof typeof USDC_COIN_TYPE, to: SuiAddress, amountBaseUnits: bigint): Promise<PaymentResult> {
  const tx = new Transaction();
  tx.setSender(signer.toSuiAddress());
  tx.transferObjects([coinWithBalance({ type: USDC_COIN_TYPE[network], balance: amountBaseUnits })], to);
  let executed: unknown;
  try {
    executed = await client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true } });
  } catch (error) {
    return { state: "UNKNOWN", detail: error instanceof Error ? error.message.slice(0, 200) : "execute threw" };
  }
  return interpret(executed);
}

function interpret(executed: unknown): PaymentResult {
  const shape = executed as { $kind?: string; Transaction?: { digest?: string; effects?: { status?: { success?: boolean; error?: unknown } } }; FailedTransaction?: { digest?: string; effects?: { status?: { error?: unknown } } } };
  if (shape.$kind === "FailedTransaction") return { state: "FAILED", digest: shape.FailedTransaction?.digest ?? null, detail: JSON.stringify(shape.FailedTransaction?.effects?.status?.error ?? "failed").slice(0, 200) };
  const digest = shape.Transaction?.digest;
  if (!digest) return { state: "UNKNOWN", detail: "no digest in response" };
  return shape.Transaction?.effects?.status?.success === false
    ? { state: "FAILED", digest, detail: JSON.stringify(shape.Transaction.effects.status.error ?? "failed").slice(0, 200) }
    : { state: "SENT", digest };
}
