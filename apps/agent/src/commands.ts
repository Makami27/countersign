import type { BalancesView } from "@countersign/web/ownerContext";
import { HTML_FORMAT } from "./chat/format.ts";
import { balanceText, helpLines, payeesText, type ChannelWords, type Network, type PayeeLine } from "./chat/commands.ts";

export { cancelText, schedulesText, type PayeeLine, type ScheduleLine } from "./chat/commands.ts";

export const COMMANDS = [
  { command: "help", description: "What this bot can do" },
  { command: "payees", description: "Your payees and where each one is paid" },
  { command: "balance", description: "The agent wallet's balance" },
  { command: "schedules", description: "Your scheduled payments" },
  { command: "cancel", description: "Cancel a payment you haven't confirmed" },
  { command: "login", description: "Sign-in link for the owner app" },
] as const;

export const TELEGRAM_WORDS: ChannelWords = {
  payHow: "Pay someone: send \"pay rent 0.10\" (the payee's name, then the amount). You confirm with a button before anything is sent.",
  checkHow: "Check a message: forward an email or chat about a payee here, or paste its text. A new address in it is never paid until the payee's own wallet proves it.",
  payWith: "\"pay <name> <amount>\"",
  amountHint: "Tap an amount or reply with a number.",
  extra: [],
  commands: COMMANDS,
};

export function helpText(publicUrl: string | null, network: Network): string {
  return helpLines(TELEGRAM_WORDS, publicUrl, network);
}

export function payeesHtml(payees: readonly PayeeLine[], publicUrl: string | null): string {
  return payeesText(HTML_FORMAT, payees, publicUrl, TELEGRAM_WORDS.payWith);
}

export function balanceHtml(agentAddress: string, balances: BalancesView, network: Network): string {
  return balanceText(HTML_FORMAT, agentAddress, balances, network);
}
