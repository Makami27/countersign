export const REASON_CODES = [
  "PAYEE_NOT_VERIFIED",
  "UNKNOWN_PAYEE",
  "NAME_INVALID",
  "ADDRESS_NOT_IN_MESSAGE",
  "LOOKALIKE_ADDRESS",
  "CONFLICT",
  "CAP_EXCEEDED",
  "PAYEE_CHANGED",
  "AMOUNT_INVALID",
  "SIGNATURE_INVALID",
  "WRONG_WALLET",
  "NONCE_REUSED",
  "EXPIRED",
  "NO_CONTINUITY",
  "COOLDOWN_ACTIVE",
  "CONTROL_NOT_PROVEN",
  "MEMORY_INCOMPLETE",
  "MEMORY_WRITE_UNCONFIRMED",
  "CHAIN_UNKNOWN",
  "KNOWN_ATTACK_PATTERN",
  "PAYMENT_NOT_BUILT",
  "PAYMENT_FAILED_ON_CHAIN",
  "PAYMENT_EXPIRED",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export type ReasonInfo = {
  readonly message: string;
  readonly retryable: boolean;
  readonly nextAction: string;
};

export const REASONS = {
  PAYEE_NOT_VERIFIED: { message: "This payee has no verified address.", retryable: false, nextAction: "Nothing was sent. Verify the payee in the owner app." },
  NAME_INVALID: { message: "The payee name is empty, too long, or has no letters or digits.", retryable: false, nextAction: "Nothing was added. Use a short name such as Flat 4B rent." },
  UNKNOWN_PAYEE: { message: "No single payee matches that name.", retryable: false, nextAction: "Nothing was sent. Use the exact payee name." },
  ADDRESS_NOT_IN_MESSAGE: { message: "The proposed address does not appear in the message.", retryable: false, nextAction: "Nothing was changed." },
  LOOKALIKE_ADDRESS: { message: "The new address imitates a known address.", retryable: false, nextAction: "Nothing was changed. Confirm the address with the payee directly." },
  CONFLICT: { message: "This payee has conflicting verified records.", retryable: false, nextAction: "Payee frozen. Resolve it in the owner app." },
  CAP_EXCEEDED: { message: "The payment is above a spending cap.", retryable: false, nextAction: "Nothing was sent." },
  PAYEE_CHANGED: { message: "The payee's verified address changed while this payment was being checked.", retryable: true, nextAction: "Nothing was sent. Ask again to pay the current verified address." },
  AMOUNT_INVALID: { message: "The amount is not a valid USDC amount.", retryable: false, nextAction: "Nothing was sent. Give the amount in USDC, for example 0.10." },
  SIGNATURE_INVALID: { message: "The signature does not verify for this change message.", retryable: false, nextAction: "Nothing was changed. Sign the exact message shown on the signing page." },
  WRONG_WALLET: { message: "The message was signed by a different wallet than the one this step needs.", retryable: true, nextAction: "Nothing was changed. Connect the wallet named on the signing page and sign again." },
  NONCE_REUSED: { message: "This change request was already used or does not exist.", retryable: false, nextAction: "Start a new change request." },
  EXPIRED: { message: "This change request expired.", retryable: false, nextAction: "Start a new change request." },
  NO_CONTINUITY: { message: "The change was not approved by the payee's current address or by the owner.", retryable: true, nextAction: "Ask the payee to sign from their current wallet, or confirm in the owner app." },
  COOLDOWN_ACTIVE: { message: "The owner-confirmed change is still in its waiting period.", retryable: true, nextAction: "Nothing was changed yet. Try again after the cooldown." },
  CONTROL_NOT_PROVEN: { message: "The new address did not prove control.", retryable: true, nextAction: "The new address must sign the change or return the test transfer." },
  MEMORY_WRITE_UNCONFIRMED: { message: "Nothing was changed. Walrus Memory didn't confirm the write; try again in a few minutes.", retryable: true, nextAction: "" },
  MEMORY_INCOMPLETE: { message: "Memory could not be read completely.", retryable: true, nextAction: "Nothing was sent. Retry when memory is complete." },
  CHAIN_UNKNOWN: { message: "The chain did not give a definite answer.", retryable: true, nextAction: "Nothing was decided. Retry shortly." },
  KNOWN_ATTACK_PATTERN: { message: "This matches an earlier refused attempt.", retryable: false, nextAction: "Nothing was changed." },
  PAYMENT_NOT_BUILT: { message: "The transfer could not be built, so nothing was sent.", retryable: true, nextAction: "No USDC moved. Check the agent wallet balance, then ask again." },
  PAYMENT_FAILED_ON_CHAIN: { message: "The transfer executed and failed on chain.", retryable: true, nextAction: "No USDC moved; only gas was spent. Ask again." },
  PAYMENT_EXPIRED: { message: "The transfer never reached the chain and can no longer execute.", retryable: true, nextAction: "No USDC moved. Ask again." },
} as const satisfies Record<ReasonCode, ReasonInfo>;

export const VERDICTS = ["PAY_RESERVED", "REFUSED", "CHANGE_STARTED", "CHANGE_VERIFIED", "ONBOARDING_STARTED", "NONE"] as const;
export type VerdictCode = (typeof VERDICTS)[number];

export const PAYEE_STATUSES = ["VERIFIED", "STATED", "REVOKED"] as const;
export type PayeeStatus = (typeof PAYEE_STATUSES)[number];

export const SIGNATURE_RESULTS = ["VALID", "INVALID", "WRONG_SIGNER", "UNSUPPORTED", "UNKNOWN"] as const;
export type SignatureResult = (typeof SIGNATURE_RESULTS)[number];

export const CHECK_CODES = [
  "ADDRESS_IN_MESSAGE",
  "PAYEE_VERIFIED",
  "NOT_KNOWN_ATTACK",
  "NOT_LOOKALIKE",
  "MEMORY_COMPLETE",
  "AMOUNT_VALID",
  "WITHIN_CAPS",
  "CONTINUITY",
  "OWNER_CONFIRMED",
  "COOLDOWN_ELAPSED",
  "CONTROL",
  "SETTLED_ON_CHAIN",
] as const;

export type CheckCode = (typeof CHECK_CODES)[number];
