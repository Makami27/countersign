import type { PayeeVersionRecord, SuiAddress } from "@countersign/core";

export const PAYEE_A = `0x${"b".repeat(64)}` as SuiAddress;
export const PAYEE_B = `0x${"d".repeat(64)}` as SuiAddress;

export function verifiedVersion(payeeId: string, version: number, address: SuiAddress, supersedes: number | null): PayeeVersionRecord {
  return {
    type: "payee_version", payeeId, name: payeeId, version, address, status: "VERIFIED", supersedes,
    evidence: { kind: "payee_onboarding", ownerConfirmationId: "owner:test", nonce: `n${version}`, control: { kind: "signature", signature: "test" }, verifications: [] },
    createdAt: "2026-10-30T09:00:00Z",
  };
}
