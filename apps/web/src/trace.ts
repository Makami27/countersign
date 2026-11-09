import { REASONS, type Outcome, type ReasonCode } from "@countersign/core";

export type StepState = "passed" | "failed" | "waiting" | "skipped";
export type TraceStep = { readonly label: string; readonly state: StepState; readonly detail: string | null };

const CHANGE_STEPS: readonly { label: string; failsOn: readonly ReasonCode[] }[] = [
  { label: "The address appears word for word in the message", failsOn: ["ADDRESS_NOT_IN_MESSAGE"] },
  { label: "The payee already has a verified address", failsOn: ["PAYEE_NOT_VERIFIED", "CONFLICT"] },
  { label: "Not a repeat of an attempt already refused", failsOn: ["KNOWN_ATTACK_PATTERN"] },
  { label: "Does not imitate a known address", failsOn: ["LOOKALIKE_ADDRESS"] },
  { label: "Kept as unproven, so it can't be paid yet", failsOn: [] },
  { label: "Signed by the payee's current wallet, or confirmed by you", failsOn: ["NO_CONTINUITY", "COOLDOWN_ACTIVE", "EXPIRED", "NONCE_REUSED", "CHAIN_UNKNOWN", "WRONG_WALLET", "SIGNATURE_INVALID"] },
  { label: "The new wallet proves it is in control", failsOn: ["CONTROL_NOT_PROVEN"] },
];

const PAY_STEPS: readonly { label: string; failsOn: readonly ReasonCode[] }[] = [
  { label: "Memory read completely", failsOn: ["MEMORY_INCOMPLETE"] },
  { label: "Exactly one verified address for this payee", failsOn: ["UNKNOWN_PAYEE", "CONFLICT", "PAYEE_NOT_VERIFIED"] },
  { label: "The amount is a valid USDC amount", failsOn: ["AMOUNT_INVALID"] },
  { label: "Within the spending caps", failsOn: ["CAP_EXCEEDED"] },
];

function walk(steps: typeof CHANGE_STEPS, reason: ReasonCode | null, passedThrough: number): TraceStep[] {
  const failedAt = reason === null ? -1 : steps.findIndex((s) => s.failsOn.includes(reason));
  return steps.map((step, i) => {
    if (failedAt >= 0) {
      if (i < failedAt) return { label: step.label, state: "passed", detail: null };
      if (i === failedAt && reason) return { label: step.label, state: "failed", detail: REASONS[reason].message };
      return { label: step.label, state: "skipped", detail: null };
    }
    return { label: step.label, state: i < passedThrough ? "passed" : "waiting", detail: null };
  });
}

export function traceFor(kind: "pay" | "change_address", outcome: Outcome): TraceStep[] {
  const reason = outcome.verdict === "REFUSED" ? outcome.reason : null;
  if (kind === "pay") return walk(PAY_STEPS, reason, PAY_STEPS.length);
  if (outcome.verdict === "CHANGE_VERIFIED") return walk(CHANGE_STEPS, null, CHANGE_STEPS.length);
  if (outcome.verdict === "CHANGE_STARTED") return walk(CHANGE_STEPS, null, 5);
  if (outcome.verdict === "NONE") return [{ label: "That address is already the verified one", state: "passed", detail: null }];
  return walk(CHANGE_STEPS, reason, 0);
}
