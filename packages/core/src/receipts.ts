import type { ReceiptCheck, ReceiptRecord, ReceiptVerdict } from "./types.ts";
import type { CheckCode, ReasonCode } from "./vocabulary.ts";

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

const ATTACK_REASONS: readonly ReasonCode[] = ["LOOKALIKE_ADDRESS", "KNOWN_ATTACK_PATTERN", "SEEN_BY_OTHER_AGENT"];

export function remembersAttack(receipt: ReceiptRecord): boolean {
  if (receipt.reason === null || receipt.address === null) return false;
  if (receipt.verdict === "REFUSED") return ATTACK_REASONS.includes(receipt.reason);
  return receipt.verdict === "CHANGE_REJECTED" && (ATTACK_REASONS.includes(receipt.reason) || receipt.reason === "SIGNATURE_INVALID");
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
