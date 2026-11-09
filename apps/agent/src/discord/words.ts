import { appLink, type ChannelWords } from "../chat/commands.ts";

export const DISCORD_COMMANDS = [
  { command: "pay", description: "Pay a verified payee; you confirm with a button first" },
  { command: "payees", description: "Your payees and where each one is paid" },
  { command: "balance", description: "The agent wallet's balance" },
  { command: "schedules", description: "Your scheduled payments" },
  { command: "check", description: "Check a message, the same way as pasting it in the owner app" },
  { command: "cancel", description: "Cancel a payment you haven't confirmed" },
  { command: "link", description: "Connect this Discord account with the code from Settings" },
  { command: "help", description: "What this bot can do" },
] as const;

export const DISCORD_WORDS: ChannelWords = {
  payHow: "Pay someone: /pay rent 0.10 (the payee's name, then the amount). You confirm with a button before anything is sent.",
  checkHow: "Check a message: /check with the text of an email or chat about a payee. A new address in it is never paid until the payee's own wallet proves it.",
  payWith: "/pay <name> <amount>",
  amountHint: "Tap an amount, or use /pay with another amount.",
  extra: ["Replies here are visible only to you. Notices come by DM."],
  commands: DISCORD_COMMANDS,
};

export function discordUnlinkedText(publicUrl: string | null): string {
  return `Sign in at ${appLink(publicUrl)}, then Connect Discord in Settings.`;
}

export const DISCORD_LINKED_REPLY = "Connected: this Discord account now runs your Countersign agent and gets its notices by DM.";
export const DISCORD_CODE_REFUSED = "That code expired or was already used. Nothing was changed. Make a new one in Settings in the owner app.";

export function dmWarning(publicUrl: string | null): string {
  return `I couldn't send you a notice by DM: Discord refused it. To get notices, allow direct messages from Countersign, for example by adding it to a server you're in and allowing DMs from that server's members. Notices that didn't arrive are in Activity: ${publicUrl ? `${publicUrl}/app/activity` : "the owner app"}`;
}
