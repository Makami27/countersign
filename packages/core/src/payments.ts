import type { SuiAddress } from "./types.ts";
import type { ReasonCode } from "./vocabulary.ts";

export const PAYMENT_STATES = ["RESERVED", "SENDING", "SENT", "SETTLED", "FAILED", "UNKNOWN"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PAYMENT_TRANSITIONS = {
  RESERVED: ["SENDING", "FAILED"],
  SENDING: ["SENT", "FAILED", "UNKNOWN"],
  SENT: ["SETTLED", "FAILED"],
  UNKNOWN: ["SETTLED", "FAILED"],
  SETTLED: [],
  FAILED: [],
} as const satisfies Record<PaymentState, readonly PaymentState[]>;

export function canMovePayment(from: PaymentState, to: PaymentState): boolean {
  return (PAYMENT_TRANSITIONS[from] as readonly PaymentState[]).includes(to);
}

export function statesThatMayMoveTo(to: PaymentState): readonly PaymentState[] {
  return PAYMENT_STATES.filter((from) => canMovePayment(from, to));
}

export type NewPaymentIntent = {
  readonly id: string;
  readonly payeeId: string;
  readonly payeeVersion: number;
  readonly payeeBlobId: string | null;
  readonly address: SuiAddress;
  readonly amountBaseUnits: bigint;
  readonly period: string;
  readonly createdAt: string;
};

export type PaymentIntent = NewPaymentIntent & {
  readonly state: PaymentState;
  readonly digest: string | null;
  readonly validUntilEpoch: string | null;
  readonly detail: string | null;
  readonly reason: ReasonCode | null;
  readonly updatedAt: string;
};

export type PaymentMove = {
  readonly to: PaymentState;
  readonly at: string;
  readonly detail: string | null;
  readonly reason?: ReasonCode;
  readonly digest?: string;
  readonly validUntilEpoch?: string | null;
};

export type ChainSighting =
  | { readonly kind: "FOUND"; readonly success: boolean; readonly creditedPayee: boolean }
  | { readonly kind: "NOT_FOUND"; readonly currentEpoch: bigint }
  | { readonly kind: "UNKNOWN"; readonly detail: string };

export type Reconciliation =
  | { readonly kind: "MOVE"; readonly to: "SETTLED"; readonly detail: string }
  | { readonly kind: "MOVE"; readonly to: "FAILED"; readonly reason: ReasonCode; readonly detail: string }
  | { readonly kind: "HOLD"; readonly detail: string };

const RECONCILABLE: readonly PaymentState[] = ["SENT", "UNKNOWN"];

export const INTERRUPTED_WHILE_SENDING = "The agent stopped while sending this payment, so its outcome is unknown. It will not be resent; it is checked by digest.";

export function reconcilePayment(intent: PaymentIntent, sighting: ChainSighting): Reconciliation {
  if (intent.state === "SENDING") return { kind: "HOLD", detail: "A payment still marked SENDING must first be moved to UNKNOWN." };
  if (!RECONCILABLE.includes(intent.state) || intent.digest === null) return { kind: "HOLD", detail: `A ${intent.state} payment is not reconciled by digest.` };
  if (sighting.kind === "UNKNOWN") return { kind: "HOLD", detail: `The chain gave no definite answer: ${sighting.detail}` };
  if (sighting.kind === "FOUND") {
    if (!sighting.success) return { kind: "MOVE", to: "FAILED", reason: "PAYMENT_FAILED_ON_CHAIN", detail: "The transaction executed and failed on chain, so no USDC moved." };
    return sighting.creditedPayee
      ? { kind: "MOVE", to: "SETTLED", detail: "The transaction executed and credited the payee the exact amount." }
      : { kind: "HOLD", detail: "The transaction executed but the payee credit was not seen. The owner must check it." };
  }
  if (intent.state === "SENT") return { kind: "HOLD", detail: "The gateway reported this payment as sent but it can't be found yet." };
  if (intent.validUntilEpoch !== null && sighting.currentEpoch > BigInt(intent.validUntilEpoch)) {
    return { kind: "MOVE", to: "FAILED", reason: "PAYMENT_EXPIRED", detail: `Not on chain, and it could only execute until epoch ${intent.validUntilEpoch}; it can never execute now.` };
  }
  return { kind: "HOLD", detail: "Not on chain yet and it could still execute, so it stays UNKNOWN and is never resent." };
}

const USDC_DECIMALS = 6n;

export function formatUsdc(baseUnits: bigint): string {
  const scale = 10n ** USDC_DECIMALS;
  const whole = baseUnits / scale;
  const fraction = (baseUnits % scale).toString().padStart(Number(USDC_DECIMALS), "0").replace(/0+$/, "");
  return fraction === "" ? `${whole}.00` : `${whole}.${fraction.length === 1 ? `${fraction}0` : fraction}`;
}

const USDC_AMOUNT = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/;

export function usdcToBaseUnits(amountText: string): string | null {
  const match = USDC_AMOUNT.exec(amountText);
  if (!match) return null;
  const whole = BigInt(match[1] ?? "0");
  const fraction = BigInt((match[2] ?? "").padEnd(Number(USDC_DECIMALS), "0"));
  const baseUnits = whole * 10n ** USDC_DECIMALS + fraction;
  return baseUnits > 0n ? baseUnits.toString() : null;
}
