import type { PayeeSummary } from "./types.ts";
import { PAYABLE } from "./views/payees.ts";
import { showMoment } from "./moment.ts";
import { notePayees } from "./momentFacts.ts";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function payeeMoments(payees: readonly PayeeSummary[]): void {
  for (const event of notePayees(storage(), payees.map((p) => ({ id: p.id, name: p.name, payable: PAYABLE.has(p.status), address: p.address })))) {
    showMoment(event.kind === "verified"
      ? { title: `${event.name} is verified`, detail: "Their wallet signed. They can be paid now.", address: event.address }
      : { title: `${event.name}'s address changed`, detail: "Both proofs checked out. Payments now go to the new address.", address: event.address });
  }
}
