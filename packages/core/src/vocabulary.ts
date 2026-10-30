export const REASON_CODES = [
  "PAYEE_NOT_VERIFIED",
  "UNKNOWN_PAYEE",
  "ADDRESS_NOT_IN_MESSAGE",
  "LOOKALIKE_ADDRESS",
  "CONFLICT",
  "CAP_EXCEEDED",
  "SIGNATURE_INVALID",
  "NONCE_REUSED",
  "EXPIRED",
  "NO_CONTINUITY",
  "COOLDOWN_ACTIVE",
  "CONTROL_NOT_PROVEN",
  "MEMORY_INCOMPLETE",
  "CHAIN_UNKNOWN",
  "KNOWN_ATTACK_PATTERN",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export type ReasonInfo = {
  readonly message: string;
  readonly retryable: boolean;
  readonly nextAction: string;
};

export const REASONS = {
  PAYEE_NOT_VERIFIED: { message: "This payee has no verified address.", retryable: false, nextAction: "Nothing was sent. Verify the payee in the owner app." },
  UNKNOWN_PAYEE: { message: "No single payee matches that name.", retryable: false, nextAction: "Nothing was sent. Use the exact payee name." },
  ADDRESS_NOT_IN_MESSAGE: { message: "The proposed address does not appear in the message.", retryable: false, nextAction: "Nothing was changed." },
  LOOKALIKE_ADDRESS: { message: "The new address imitates a known address.", retryable: false, nextAction: "Nothing was changed. Confirm the address with the payee directly." },
  CONFLICT: { message: "This payee has conflicting verified records.", retryable: false, nextAction: "Payee frozen. Resolve it in the owner app." },
  CAP_EXCEEDED: { message: "The payment is above a spending cap.", retryable: false, nextAction: "Nothing was sent." },
  SIGNATURE_INVALID: { message: "The signature does not verify.", retryable: false, nextAction: "Nothing was changed." },
  NONCE_REUSED: { message: "This change request was already used or does not exist.", retryable: false, nextAction: "Start a new change request." },
  EXPIRED: { message: "This change request expired.", retryable: false, nextAction: "Start a new change request." },
  NO_CONTINUITY: { message: "The change was not approved by the payee's current address or by the owner.", retryable: true, nextAction: "Ask the payee to sign from their current wallet, or confirm in the owner app." },
  COOLDOWN_ACTIVE: { message: "The owner-confirmed change is still in its waiting period.", retryable: true, nextAction: "Nothing was changed yet. Try again after the cooldown." },
  CONTROL_NOT_PROVEN: { message: "The new address did not prove control.", retryable: true, nextAction: "The new address must sign the change or return the test transfer." },
  MEMORY_INCOMPLETE: { message: "Memory could not be read completely.", retryable: true, nextAction: "Nothing was sent. Retry when memory is complete." },
  CHAIN_UNKNOWN: { message: "The chain did not give a definite answer.", retryable: true, nextAction: "Nothing was decided. Retry shortly." },
  KNOWN_ATTACK_PATTERN: { message: "This matches an earlier refused attempt.", retryable: false, nextAction: "Nothing was changed." },
} as const satisfies Record<ReasonCode, ReasonInfo>;

export const VERDICTS = ["PAY_RESERVED", "REFUSED", "CHANGE_STARTED", "CHANGE_VERIFIED", "NONE"] as const;
export type VerdictCode = (typeof VERDICTS)[number];

export const PAYEE_STATUSES = ["VERIFIED", "STATED", "REVOKED"] as const;
export type PayeeStatus = (typeof PAYEE_STATUSES)[number];

export const SIGNATURE_RESULTS = ["VALID", "INVALID", "UNSUPPORTED", "UNKNOWN"] as const;
export type SignatureResult = (typeof SIGNATURE_RESULTS)[number];
