import type { PayeeStatus, ReasonCode } from "./vocabulary.ts";

export type SuiAddress = string & { readonly __brand: "SuiAddress" };

export type InboundMessage = {
  readonly id: string;
  readonly channel: "telegram" | "web" | "lab";
  readonly from: string;
  readonly text: string;
  readonly receivedAt: string;
};

export type Proposal =
  | { readonly kind: "pay"; readonly payeeId: string; readonly amountBaseUnits: string; readonly reasonQuote: string }
  | { readonly kind: "change_address"; readonly payeeId: string; readonly newAddress: string; readonly reasonQuote: string }
  | { readonly kind: "none" };

export type ControlProof =
  | { readonly kind: "signature"; readonly signature: string }
  | { readonly kind: "round_trip"; readonly outDigest: string; readonly returnDigest: string; readonly amountBaseUnits: string };

export type ContinuityProof =
  | { readonly kind: "signature"; readonly signature: string }
  | { readonly kind: "owner_confirmed"; readonly ownerConfirmationId: string; readonly confirmedAt: string };

export type Evidence =
  | { readonly kind: "owner_onboarding"; readonly ownerConfirmationId: string }
  | { readonly kind: "continuity_signature"; readonly nonce: string; readonly signature: string; readonly control: ControlProof }
  | { readonly kind: "owner_confirmed_change"; readonly nonce: string; readonly ownerConfirmationId: string; readonly control: ControlProof }
  | { readonly kind: "stated"; readonly sourceMessageId: string; readonly nonce: string };

export type PayeeVersionRecord = {
  readonly type: "payee_version";
  readonly payeeId: string;
  readonly version: number;
  readonly address: SuiAddress;
  readonly status: PayeeStatus;
  readonly supersedes: number | null;
  readonly evidence: Evidence;
  readonly createdAt: string;
};

export type RefusalRecord = {
  readonly type: "refusal";
  readonly receipt: string;
  readonly reason: ReasonCode;
  readonly ref: string;
  readonly payeeId: string | null;
  readonly address: SuiAddress | null;
  readonly createdAt: string;
};

export type MemoryRecord = PayeeVersionRecord | RefusalRecord;

export type Envelope = { readonly record: MemoryRecord; readonly sig: string };

export type Refused = { readonly verdict: "REFUSED"; readonly reason: ReasonCode; readonly receipt: string; readonly cites: string | null };
export type ChangeStarted = { readonly verdict: "CHANGE_STARTED"; readonly nonce: string; readonly expires: string; readonly fromAddress: SuiAddress; readonly toAddress: SuiAddress };
export type ChangeVerified = { readonly verdict: "CHANGE_VERIFIED"; readonly version: number; readonly blobId: string };
export type PayReserved = { readonly verdict: "PAY_RESERVED"; readonly paymentId: string; readonly address: SuiAddress; readonly amountBaseUnits: bigint };
export type Nothing = { readonly verdict: "NONE" };

export type Outcome = Refused | ChangeStarted | ChangeVerified | PayReserved | Nothing;

export type PayeeHead =
  | { readonly kind: "none" }
  | { readonly kind: "conflict" }
  | { readonly kind: "verified"; readonly version: PayeeVersionRecord };
