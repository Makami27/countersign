import { REASONS, formatUsdc, type Outcome, type PaymentIntent, type ReceiptWrite, type SuiAddress } from "@countersign/core";

export const RECEIPT_PENDING_REPLY = "Writing the receipt to Walrus Memory. This takes about 20 seconds; the payment outcome above is already final.";

export function receiptReply(written: ReceiptWrite | null, publicUrl: string | null): string {
  if (!written) return "No receipt was written because the payment has no final outcome yet.";
  const where = publicUrl ? `${publicUrl}/r/${written.receipt}` : written.receipt;
  return written.blobId ? `Receipt: ${where}\nStored on Walrus Memory (blob ${written.blobId}).` : `Receipt: ${where}\nWalrus Memory has not confirmed it yet. The payment outcome above does not change.`;
}

type Network = "mainnet" | "testnet";

function onSui(network: Network): string {
  return network === "mainnet" ? "on Sui mainnet" : "on Sui testnet (test USDC, no real money)";
}

export function paymentPendingReply(amountBaseUnits: bigint, address: SuiAddress, network: Network): string {
  return `Nothing has been sent yet. Sending ${formatUsdc(amountBaseUnits)} USDC to ${address} ${onSui(network)}; this takes a few seconds.`;
}

export function paymentReply(payment: PaymentIntent, network: Network): string {
  const amount = `${formatUsdc(payment.amountBaseUnits)} USDC`;
  const digest = payment.digest ? ` Transaction ${payment.digest}.` : "";
  switch (payment.state) {
    case "SETTLED":
      return `Sent ${amount} to ${payment.address} ${onSui(network)}.${digest}`;
    case "SENT":
      return `Sent ${amount} to ${payment.address} ${onSui(network)}; the network executed it and I'm still waiting to see it in a checkpoint.${digest}`;
    case "FAILED":
      return `No USDC moved. ${payment.detail ?? "The payment failed."} The day's cap was given back.`;
    case "UNKNOWN":
      return `I don't know yet whether ${amount} reached ${payment.address}. It will not be sent again. I'm checking the transaction by its digest.${digest}`;
    case "RESERVED":
    case "SENDING":
      return `Nothing is confirmed yet: ${amount} to ${payment.address} is still being sent.`;
  }
}

export const STORE_UNANSWERED_REPLY = "Nothing was decided. Something the agent depends on didn't answer, so this was not paid or changed. Send it again in a minute.";
export const MODEL_UNREADABLE_REPLY = "Nothing was sent and nothing was changed. I couldn't read that message right now because the language model didn't answer. Send it again in a minute.";

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
      return `Refused. Nothing was sent and nothing was changed. ${[info.message, info.nextAction].filter(Boolean).join(" ")}${cites} Receipt ${outcome.receipt}.`;
    }
    case "ONBOARDING_STARTED":
      return `Payee ${outcome.payeeId} added and waiting for the payee's wallet. Nothing can be paid to ${outcome.address} until that wallet signs. The signing link expires ${outcome.expires}.`;
    case "NONE":
      return "No payment or payee change found in that message. Nothing was changed.";
  }
}
