import type { ContinuityProof, ControlProof, SignatureVerification, SuiAddress } from "./types.ts";
import type { SignatureCheck, SignatureVerifier } from "./ports.ts";
import type { CheckTrail } from "./receipts.ts";
import type { ReasonCode } from "./vocabulary.ts";

export type RoundTripResult = "PROVEN" | "NOT_PROVEN" | "UNKNOWN";

export interface RoundTripChecker {
  check(proof: Extract<ControlProof, { kind: "round_trip" }>, toAddress: SuiAddress): Promise<RoundTripResult>;
}

export type ProofStep = { readonly ok: true; readonly verification: SignatureVerification | null } | { readonly ok: false; readonly reason: ReasonCode };

type Role = SignatureVerification["role"];

function fromSignature(check: SignatureCheck, role: Role, signer: SuiAddress, unsupported: ReasonCode): ProofStep {
  if (check.result === "VALID") return { ok: true, verification: { role, signer, scheme: check.scheme, maxEpoch: check.maxEpoch, checkedAtEpoch: check.checkedAtEpoch } };
  if (check.result === "WRONG_SIGNER") return { ok: false, reason: "WRONG_WALLET" };
  if (check.result === "INVALID") return { ok: false, reason: "SIGNATURE_INVALID" };
  if (check.result === "UNKNOWN") return { ok: false, reason: "CHAIN_UNKNOWN" };
  return { ok: false, reason: unsupported };
}

export async function checkContinuity(proof: ContinuityProof, message: string, fromAddress: SuiAddress, deps: { signatures: SignatureVerifier; nowMs: number; cooldownMs: number }, trail: CheckTrail): Promise<ProofStep> {
  if (proof.kind === "owner_confirmed") {
    trail.pass("OWNER_CONFIRMED");
    const readyAt = new Date(proof.confirmedAt).getTime() + deps.cooldownMs;
    if (!Number.isFinite(readyAt) || readyAt > deps.nowMs) {
      trail.fail("COOLDOWN_ELAPSED");
      return { ok: false, reason: "COOLDOWN_ACTIVE" };
    }
    trail.pass("COOLDOWN_ELAPSED");
    return { ok: true, verification: null };
  }
  const step = fromSignature(await deps.signatures.verifyPersonalMessage(message, proof.signature, fromAddress), "continuity", fromAddress, "NO_CONTINUITY");
  if (step.ok) trail.pass("CONTINUITY");
  else trail.fail("CONTINUITY");
  return step;
}

export async function checkControl(proof: ControlProof, message: string, toAddress: SuiAddress, deps: { signatures: SignatureVerifier; roundTrips: RoundTripChecker }, trail: CheckTrail): Promise<ProofStep> {
  let step: ProofStep;
  if (proof.kind === "round_trip") {
    const result = await deps.roundTrips.check(proof, toAddress);
    step = result === "PROVEN" ? { ok: true, verification: null } : { ok: false, reason: result === "UNKNOWN" ? "CHAIN_UNKNOWN" : "CONTROL_NOT_PROVEN" };
  } else {
    step = fromSignature(await deps.signatures.verifyPersonalMessage(message, proof.signature, toAddress), "control", toAddress, "CONTROL_NOT_PROVEN");
  }
  if (step.ok) trail.pass("CONTROL");
  else trail.fail("CONTROL");
  return step;
}
