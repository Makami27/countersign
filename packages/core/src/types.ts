import type { CheckCode, PayeeStatus, ReasonCode, SharedReason } from "./vocabulary.ts";

export type SuiAddress = string & { readonly __brand: "SuiAddress" };

export type InboundMessage = {
  readonly id: string;
  readonly channel: "telegram" | "web" | "lab" | "cli" | "paste";
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

export type SignatureVerification = {
  readonly role: "continuity" | "control";
  readonly signer: SuiAddress;
  readonly scheme: "ED25519" | "ZKLOGIN";
  readonly maxEpoch: string | null;
  readonly checkedAtEpoch: string;
};

export type Evidence =
  | { readonly kind: "onboarding_requested"; readonly ownerConfirmationId: string; readonly nonce: string; readonly expires: string }
  | { readonly kind: "payee_onboarding"; readonly ownerConfirmationId: string; readonly nonce: string; readonly control: ControlProof; readonly verifications: readonly SignatureVerification[] }
  | { readonly kind: "continuity_signature"; readonly nonce: string; readonly signature: string; readonly control: ControlProof; readonly verifications: readonly SignatureVerification[] }
  | { readonly kind: "owner_confirmed_change"; readonly nonce: string; readonly ownerConfirmationId: string; readonly control: ControlProof; readonly verifications: readonly SignatureVerification[] }
  | { readonly kind: "stated"; readonly sourceMessageId: string; readonly nonce: string };

export type PayeeVersionRecord = {
  readonly type: "payee_version";
  readonly payeeId: string;
  readonly name: string;
  readonly version: number;
  readonly address: SuiAddress;
  readonly status: PayeeStatus;
  readonly supersedes: number | null;
  readonly evidence: Evidence;
  readonly createdAt: string;
};

export type ReceiptCheck = { readonly check: CheckCode; readonly result: "PASS" | "FAIL" };

export type SeenElsewhere = { readonly firstReceipt: string; readonly agents: number };

export type ReceiptVerdict = "PAID" | "PAYMENT_FAILED" | "REFUSED" | "CHANGE_VERIFIED" | "CHANGE_REJECTED";

export type ReceiptRecord = {
  readonly type: "receipt";
  readonly receipt: string;
  readonly verdict: ReceiptVerdict;
  readonly reason: ReasonCode | null;
  readonly ref: string;
  readonly payeeId: string | null;
  readonly address: SuiAddress | null;
  readonly amountBaseUnits: string | null;
  readonly checks: readonly ReceiptCheck[];
  readonly memoryBlobIds: readonly string[];
  readonly suiDigest: string | null;
  readonly network: "mainnet" | "testnet";
  readonly createdAt: string;
  readonly seenElsewhere?: SeenElsewhere;
};

export type OwnerWalletRecord = {
  readonly type: "owner_wallet";
  readonly ownerId: string;
  readonly version: number;
  readonly address: SuiAddress;
  readonly previous: SuiAddress | null;
  readonly how: "first_registration" | "old_wallet_signed" | "cooldown_elapsed";
  readonly proofs: readonly { readonly signer: SuiAddress; readonly message: string; readonly signature: string }[];
  readonly verifications: readonly SignatureVerification[];
  readonly createdAt: string;
};

export type ScheduleTerms = {
  readonly payeeId: string;
  readonly amountBaseUnits: string;
  readonly every: "week" | "two_weeks" | "month" | "year";
  readonly day: number;
  readonly month: number | null;
};

export type ScheduleRecord = ScheduleTerms & {
  readonly type: "schedule";
  readonly ownerId: string;
  readonly scheduleId: string;
  readonly version: number;
  readonly status: "ACTIVE" | "DELETED";
  readonly approval: { readonly signer: SuiAddress; readonly message: string; readonly signature: string };
  readonly verifications: readonly SignatureVerification[];
  readonly createdAt: string;
};

export type MemoryRecord = PayeeVersionRecord | ReceiptRecord | OwnerWalletRecord | ScheduleRecord;

export type Envelope = { readonly record: MemoryRecord; readonly sig: string };

export type AttackSeenRecord = { readonly type: "attack_seen"; readonly address: SuiAddress; readonly reason: SharedReason; readonly receipt: string; readonly agentKey: string; readonly seenAt: string };
export type AttackRetractedRecord = { readonly type: "attack_retracted"; readonly address: SuiAddress; readonly receipt: string; readonly agentKey: string; readonly retractedAt: string };
export type SharedRecord = AttackSeenRecord | AttackRetractedRecord;

export type Refused = { readonly verdict: "REFUSED"; readonly reason: ReasonCode; readonly receipt: string; readonly cites: string | null; readonly seenElsewhere?: SeenElsewhere };
export type ChangeStarted = { readonly verdict: "CHANGE_STARTED"; readonly nonce: string; readonly expires: string; readonly fromAddress: SuiAddress; readonly toAddress: SuiAddress };
export type ChangeVerified = { readonly verdict: "CHANGE_VERIFIED"; readonly version: number; readonly blobId: string; readonly receipt: string };
export type PayReserved = { readonly verdict: "PAY_RESERVED"; readonly paymentId: string; readonly address: SuiAddress; readonly amountBaseUnits: bigint };
export type OnboardingStarted = { readonly verdict: "ONBOARDING_STARTED"; readonly payeeId: string; readonly nonce: string; readonly expires: string; readonly address: SuiAddress };
export type Nothing = { readonly verdict: "NONE" };

export type Outcome = Refused | ChangeStarted | ChangeVerified | PayReserved | OnboardingStarted | Nothing;

export type PayeeHead =
  | { readonly kind: "none" }
  | { readonly kind: "conflict" }
  | { readonly kind: "verified"; readonly version: PayeeVersionRecord };
