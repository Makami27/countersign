import type { PendingChange, PendingOnboarding } from "./ports.ts";

export const ONBOARDING_MESSAGE_VERSION = "Countersign payee onboarding v1";

export function onboardingMessage(onboarding: PendingOnboarding): string {
  return [ONBOARDING_MESSAGE_VERSION, `payee:${onboarding.payeeId}`, `name:${onboarding.name}`, `address:${onboarding.address}`, `nonce:${onboarding.nonce}`, `expires:${onboarding.expires}`].join(String.fromCharCode(10));
}

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
