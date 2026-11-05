export type PayPhase = "checking" | "RESERVED" | "SENDING" | "SENT" | "SETTLED" | "FAILED" | "UNKNOWN";
export type StageState = "done" | "active" | "waiting" | "failed" | "unsure";
export type PayStage = { readonly key: "checking" | "sending" | "settled"; readonly label: string; readonly words: string; readonly state: StageState };

const SENDING_PHASES: ReadonlySet<PayPhase> = new Set(["RESERVED", "SENDING", "SENT"]);

function checking(phase: PayPhase, name: string): PayStage {
  return phase === "checking"
    ? { key: "checking", label: "Checking", words: `Reading ${name}'s verified address and your caps. Nothing has been sent.`, state: "active" }
    : { key: "checking", label: "Checking", words: "The verified address and your caps checked out.", state: "done" };
}

function sending(phase: PayPhase, amount: string): PayStage {
  if (phase === "checking") return { key: "sending", label: "Sending", words: "Not started. Nothing has been sent.", state: "waiting" };
  if (SENDING_PHASES.has(phase)) return { key: "sending", label: "Sending", words: `${amount} is leaving the agent wallet. Nothing is confirmed yet.`, state: "active" };
  if (phase === "FAILED") return { key: "sending", label: "Sending", words: "It didn't go through. No USDC moved.", state: "failed" };
  if (phase === "UNKNOWN") return { key: "sending", label: "Sending", words: `Not sure yet whether ${amount} arrived. It will not be sent again.`, state: "unsure" };
  return { key: "sending", label: "Sending", words: `${amount} left the agent wallet.`, state: "done" };
}

function settled(phase: PayPhase, amount: string, name: string): PayStage {
  return phase === "SETTLED"
    ? { key: "settled", label: "Settled", words: `${amount} reached ${name}'s verified address.`, state: "done" }
    : { key: "settled", label: "Settled", words: `${name} hasn't received anything yet.`, state: "waiting" };
}

export function payStages(phase: PayPhase, amount: string, name: string): readonly PayStage[] {
  return [checking(phase, name), sending(phase, amount), settled(phase, amount, name)];
}

export function isFinished(phase: PayPhase): boolean {
  return phase === "SETTLED" || phase === "FAILED";
}

export type CapCheck = { readonly ok: true } | { readonly ok: false; readonly words: string };

export function remainingToday(perDayBaseUnits: string, usedTodayBaseUnits: string): bigint {
  const left = BigInt(perDayBaseUnits) - BigInt(usedTodayBaseUnits);
  return left > 0n ? left : 0n;
}
