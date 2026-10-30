import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { TransactionError } from "@mysten/sui/client";
import { normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Signer } from "@mysten/sui/cryptography";
import type { ChainSighting, SuiAddress } from "@countersign/core";
import type { Network } from "./client.ts";

export const USDC_COIN_TYPE = {
  mainnet: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  testnet: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
} as const satisfies Record<Network, string>;

export type PreparedPayment = { readonly bytes: Uint8Array; readonly signature: string; readonly digest: string; readonly validUntilEpoch: string | null };
export type Prepared = { readonly ok: true; readonly payment: PreparedPayment } | { readonly ok: false; readonly detail: string };
export type Submitted = { readonly state: "SENT" } | { readonly state: "FAILED"; readonly detail: string } | { readonly state: "UNKNOWN"; readonly detail: string };

function short(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "unexpected error";
}

function lastValidEpoch(tx: Transaction): string | null {
  const expiration = tx.getData().expiration;
  if (!expiration) return null;
  if (expiration.$kind === "Epoch") return String(expiration.Epoch);
  if (expiration.$kind === "ValidDuring") return expiration.ValidDuring.maxEpoch === null ? null : String(expiration.ValidDuring.maxEpoch);
  if (expiration.$kind === "Validity") return expiration.Validity.maxEpoch === null ? null : String(expiration.Validity.maxEpoch);
  return null;
}

export async function prepareUsdcTransfer(client: SuiGrpcClient, signer: Signer, network: Network, to: SuiAddress, amountBaseUnits: bigint): Promise<Prepared> {
  try {
    const tx = new Transaction();
    tx.setSender(signer.toSuiAddress());
    tx.transferObjects([coinWithBalance({ type: USDC_COIN_TYPE[network], balance: amountBaseUnits })], to);
    const bytes = await tx.build({ client });
    const { signature } = await signer.signTransaction(bytes);
    return { ok: true, payment: { bytes, signature, digest: await tx.getDigest(), validUntilEpoch: lastValidEpoch(tx) } };
  } catch (error) {
    return { ok: false, detail: short(error) };
  }
}

export async function submitPrepared(client: SuiGrpcClient, payment: PreparedPayment): Promise<Submitted> {
  try {
    const result = await client.executeTransaction({ transaction: payment.bytes, signatures: [payment.signature], include: { effects: true } });
    if (result.$kind === "Transaction") return { state: "SENT" };
    return { state: "FAILED", detail: `Executed and failed on chain: ${JSON.stringify(result.FailedTransaction.status.error).slice(0, 200)}` };
  } catch (error) {
    return { state: "UNKNOWN", detail: short(error) };
  }
}

export async function currentEpoch(client: SuiGrpcClient): Promise<bigint | null> {
  try {
    const { response } = await client.ledgerService.getServiceInfo({});
    return response.epoch === undefined ? null : BigInt(response.epoch);
  } catch {
    return null;
  }
}

export async function sightPayment(client: SuiGrpcClient, network: Network, digest: string, payee: SuiAddress, amountBaseUnits: bigint): Promise<ChainSighting> {
  try {
    const result = await client.getTransaction({ digest, include: { balanceChanges: true } });
    const transaction = result.$kind === "Transaction" ? result.Transaction : result.FailedTransaction;
    const usdc = normalizeStructTag(USDC_COIN_TYPE[network]);
    const credits = (transaction.balanceChanges ?? []).filter((c) => normalizeSuiAddress(c.address) === payee && normalizeStructTag(c.coinType) === usdc && c.amount === amountBaseUnits.toString());
    return { kind: "FOUND", success: result.$kind === "Transaction", creditedPayee: credits.length === 1 };
  } catch (error) {
    if (!(error instanceof TransactionError && error.reason === "notFound")) return { kind: "UNKNOWN", detail: short(error) };
    const epoch = await currentEpoch(client);
    return epoch === null ? { kind: "UNKNOWN", detail: "not found, and the current epoch could not be read" } : { kind: "NOT_FOUND", currentEpoch: epoch };
  }
}

export interface PaymentChain {
  prepare(to: SuiAddress, amountBaseUnits: bigint): Promise<Prepared>;
  submit(payment: PreparedPayment): Promise<Submitted>;
  sight(digest: string, payee: SuiAddress, amountBaseUnits: bigint): Promise<ChainSighting>;
}

export function tatumPaymentChain(client: SuiGrpcClient, signer: Signer, network: Network): PaymentChain {
  return {
    prepare: (to, amountBaseUnits) => prepareUsdcTransfer(client, signer, network, to, amountBaseUnits),
    submit: (payment) => submitPrepared(client, payment),
    sight: (digest, payee, amountBaseUnits) => sightPayment(client, network, digest, payee, amountBaseUnits),
  };
}
