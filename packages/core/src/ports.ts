import type { PayeeVersionRecord, RefusalRecord, SuiAddress } from "./types.ts";
import type { SignatureResult } from "./vocabulary.ts";

export interface RecordSigner {
  sign(canonical: string): string;
  verify(canonical: string, signature: string): boolean;
}

export type MemoryWrite = { readonly status: "WRITTEN"; readonly blobId: string } | { readonly status: "UNKNOWN" };

export type MemoryRead = { readonly complete: true; readonly texts: readonly string[] } | { readonly complete: false; readonly why: "DROPPED" | "COUNT_MISMATCH" | "UNREACHABLE" };

export interface MemoryPort {
  remember(namespace: string, text: string, idempotencyKey: string): Promise<MemoryWrite>;
  readAll(namespace: string): Promise<MemoryRead>;
}

export interface SignatureVerifier {
  verifyPersonalMessage(message: string, signature: string, address: SuiAddress): Promise<SignatureResult>;
}

export type PendingChange = {
  readonly nonce: string;
  readonly payeeId: string;
  readonly fromAddress: SuiAddress;
  readonly toAddress: SuiAddress;
  readonly expires: string;
};

export interface IndexStore {
  putPayeeVersion(record: PayeeVersionRecord): void;
  payeeVersions(payeeId: string): readonly PayeeVersionRecord[];
  payeeIds(): readonly string[];
  verifiedAddresses(): readonly SuiAddress[];
  putRefusal(record: RefusalRecord): void;
  earlierRefusalFor(address: SuiAddress): RefusalRecord | null;
  insertPendingChange(change: PendingChange): void;
  pendingChange(nonce: string): PendingChange | null;
  consumePendingChange(nonce: string): boolean;
  reserveBudget(period: string, amount: bigint, cap: bigint): boolean;
  clearIndex(): void;
}

export interface Clock {
  now(): Date;
}

export interface NonceSource {
  next(): string;
}
