import { REASONS, type Outcome } from "@countersign/core";

export function replyFor(outcome: Outcome): string {
  switch (outcome.verdict) {
    case "PAY_RESERVED":
      return `Payment reserved: ${outcome.amountBaseUnits} base units to ${outcome.address}. Sending now.`;
    case "CHANGE_STARTED":
      return `Change requested to ${outcome.toAddress}. Nothing will be paid there until the payee's current wallet signs it, or you confirm in the owner app and the cooldown ends. Request expires ${outcome.expires}.`;
    case "CHANGE_VERIFIED":
      return `Payee address verified (version ${outcome.version}).`;
    case "REFUSED": {
      const info = REASONS[outcome.reason];
      const cites = outcome.cites ? ` Same as refusal ${outcome.cites}.` : "";
      return `Refused: ${info.message} ${info.nextAction}${cites} Receipt ${outcome.receipt}.`;
    }
    case "NONE":
      return "No payment or payee change found in that message. Nothing was changed.";
  }
}
