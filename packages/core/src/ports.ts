import type { PayeeVersionRecord, ReceiptRecord, SignatureVerification, SuiAddress } from "./types.ts";
import type { SignatureResult } from "./vocabulary.ts";
import type { NewPaymentIntent, PaymentIntent, PaymentMove } from "./payments.ts";

export interface RecordSigner {
  sign(canonical: string): string;
  verify(canonical: string, signature: string): boolean;
}

export type MemoryWrite = { readonly status: "WRITTEN"; readonly blobId: string } | { readonly status: "UNKNOWN" };

export type StoredText = { readonly text: string; readonly blobId: string };

export type MemoryRead = { readonly complete: true; readonly records: readonly StoredText[] } | { readonly complete: false; readonly why: "DROPPED" | "COUNT_MISMATCH" | "UNREACHABLE" };

export interface MemoryPort {
  remember(namespace: string, text: string, idempotencyKey: string): Promise<MemoryWrite>;
  readAll(namespace: string): Promise<MemoryRead>;
}

export type SignatureCheck =
  | { readonly result: "VALID"; readonly scheme: SignatureVerification["scheme"]; readonly maxEpoch: string | null; readonly checkedAtEpoch: string }
  | { readonly result: Exclude<SignatureResult, "VALID"> };

export interface SignatureVerifier {
  verifyPersonalMessage(message: string, signature: string, address: SuiAddress): Promise<SignatureCheck>;
}

export type PendingChange = {
  readonly nonce: string;
  readonly payeeId: string;
  readonly fromAddress: SuiAddress;
  readonly toAddress: SuiAddress;
  readonly expires: string;
};

export type PendingOnboarding = {
  readonly nonce: string;
  readonly payeeId: string;
  readonly name: string;
  readonly address: SuiAddress;
  readonly expires: string;
};

export interface IndexStore {
  putPayeeVersion(record: PayeeVersionRecord): void;
  payeeVersions(payeeId: string): readonly PayeeVersionRecord[];
  payeeIds(): readonly string[];
  verifiedAddresses(): readonly SuiAddress[];
  putReceipt(record: ReceiptRecord): void;
  receipt(id: string): ReceiptRecord | null;
  earlierRefusalFor(address: SuiAddress): ReceiptRecord | null;
  insertPendingChange(change: PendingChange): void;
  pendingChange(nonce: string): PendingChange | null;
  consumePendingChange(nonce: string): boolean;
  insertPendingOnboarding(onboarding: PendingOnboarding): void;
  pendingOnboarding(nonce: string): PendingOnboarding | null;
  consumePendingOnboarding(nonce: string): boolean;
  clearIndex(): void;
}

export interface PaymentLedger {
  reservePayment(intent: NewPaymentIntent, perDayCapBaseUnits: bigint): boolean;
  movePayment(id: string, move: PaymentMove): boolean;
  payment(id: string): PaymentIntent | null;
  unresolvedPayments(): readonly PaymentIntent[];
}

export interface Clock {
  now(): Date;
}

export interface NonceSource {
  next(): string;
}
