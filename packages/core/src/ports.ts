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
  putPayeeVersion(record: PayeeVersionRecord): Promise<void>;
  payeeVersions(payeeId: string): Promise<readonly PayeeVersionRecord[]>;
  payeeIds(): Promise<readonly string[]>;
  verifiedAddresses(): Promise<readonly SuiAddress[]>;
  putReceipt(record: ReceiptRecord): Promise<void>;
  receipt(id: string): Promise<ReceiptRecord | null>;
  earlierRefusalFor(address: SuiAddress): Promise<ReceiptRecord | null>;
  insertPendingChange(change: PendingChange): Promise<void>;
  pendingChange(nonce: string): Promise<PendingChange | null>;
  consumePendingChange(nonce: string): Promise<boolean>;
  insertPendingOnboarding(onboarding: PendingOnboarding): Promise<void>;
  pendingOnboarding(nonce: string): Promise<PendingOnboarding | null>;
  consumePendingOnboarding(nonce: string): Promise<boolean>;
  receiptsFor(payeeId: string | null, limit: number): Promise<readonly ReceiptRecord[]>;
  pendingChangesFor(payeeId: string): Promise<readonly PendingChange[]>;
  pendingOnboardingFor(payeeId: string): Promise<PendingOnboarding | null>;
  clearIndex(): Promise<void>;
}

export type Reservation = "RESERVED" | "CAP_EXCEEDED" | "DUPLICATE" | "PAYEE_CHANGED";

export interface PaymentLedger {
  reservePayment(intent: NewPaymentIntent, perDayCapBaseUnits: bigint): Promise<Reservation>;
  movePayment(id: string, move: PaymentMove): Promise<boolean>;
  payment(id: string): Promise<PaymentIntent | null>;
  unresolvedPayments(): Promise<readonly PaymentIntent[]>;
  recentPayments(limit: number, payeeId: string | null): Promise<readonly PaymentIntent[]>;
}

export interface Clock {
  now(): Date;
}

export interface NonceSource {
  next(): string;
}
