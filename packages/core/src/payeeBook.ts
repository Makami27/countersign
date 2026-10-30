import type { PayeeHead, PayeeVersionRecord } from "./types.ts";

export function headOf(versions: readonly PayeeVersionRecord[]): PayeeHead {
  const verified = versions.filter((v) => v.status === "VERIFIED");
  if (verified.length === 0) return { kind: "none" };
  const superseded = new Set(verified.map((v) => v.supersedes).filter((v): v is number => v !== null));
  const heads = verified.filter((v) => !superseded.has(v.version));
  const only = heads.length === 1 ? heads[0] : undefined;
  return only ? { kind: "verified", version: only } : { kind: "conflict" };
}

export function nextVersionNumber(versions: readonly PayeeVersionRecord[]): number {
  return versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
}

export function payeeNamespace(ownerId: string, payeeId: string): string {
  return `countersign:${ownerId}:payee:${payeeId}`;
}

export function refusalsNamespace(ownerId: string): string {
  return `countersign:${ownerId}:refusals`;
}

export function payeeIdFromNamespace(ownerId: string, namespace: string): string | null {
  const prefix = `countersign:${ownerId}:payee:`;
  return namespace.startsWith(prefix) ? namespace.slice(prefix.length) : null;
}

export const TEST_NAMESPACE_ROOT = "countersign-test:";

export function isRealUseNamespace(ownerId: string, namespace: string): boolean {
  return namespace.startsWith(`countersign:${ownerId}:`);
}
