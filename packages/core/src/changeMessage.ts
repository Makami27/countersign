import type { PendingChange } from "./ports.ts";

export const CHANGE_MESSAGE_VERSION = "Countersign payee change v1";
export const CHANGE_REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function changeMessage(change: PendingChange): string {
  return [
    CHANGE_MESSAGE_VERSION,
    `payee:${change.payeeId}`,
    `from:${change.fromAddress}`,
    `to:${change.toAddress}`,
    `nonce:${change.nonce}`,
    `expires:${change.expires}`,
  ].join("\n");
}
