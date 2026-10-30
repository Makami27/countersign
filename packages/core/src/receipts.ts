import type { ReceiptCheck, ReceiptRecord, ReceiptVerdict } from "./types.ts";
import { REASONS, type CheckCode, type ReasonCode } from "./vocabulary.ts";

export class CheckTrail {
  readonly #checks: ReceiptCheck[] = [];

  pass(check: CheckCode): void {
    this.#checks.push({ check, result: "PASS" });
  }

  fail(check: CheckCode): void {
    this.#checks.push({ check, result: "FAIL" });
  }

  get checks(): readonly ReceiptCheck[] {
    return [...this.#checks];
  }
}

export function remembersAttack(receipt: ReceiptRecord): boolean {
  if (receipt.verdict !== "REFUSED" && receipt.verdict !== "CHANGE_REJECTED") return false;
  if (receipt.reason === null || receipt.address === null) return false;
  return !REASONS[receipt.reason].retryable && receipt.reason !== "KNOWN_ATTACK_PATTERN";
}

export function isRefusal(receipt: ReceiptRecord): boolean {
  return receipt.verdict === "REFUSED" || receipt.verdict === "CHANGE_REJECTED";
}

const PAYMENT_CHECKS: readonly CheckCode[] = ["MEMORY_COMPLETE", "PAYEE_VERIFIED", "AMOUNT_VALID", "WITHIN_CAPS"];

export function paymentOutcome(state: "SETTLED" | "FAILED", failure: ReasonCode | null): { readonly verdict: ReceiptVerdict; readonly reason: ReasonCode | null; readonly trail: CheckTrail } {
  const trail = new CheckTrail();
  for (const check of PAYMENT_CHECKS) trail.pass(check);
  if (state === "SETTLED") {
    trail.pass("SETTLED_ON_CHAIN");
    return { verdict: "PAID", reason: null, trail };
  }
  trail.fail("SETTLED_ON_CHAIN");
  return { verdict: "PAYMENT_FAILED", reason: failure ?? "PAYMENT_FAILED_ON_CHAIN", trail };
}
