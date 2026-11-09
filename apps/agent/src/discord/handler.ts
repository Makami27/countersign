import type { InboundMessage } from "@countersign/core";
import type { Extraction } from "@countersign/adapters/model";
import { Conversation, type ChatOwner, type Say } from "../chat/conversation.ts";
import { MARKDOWN_FORMAT } from "./format.ts";
import { DISCORD_CODE_REFUSED, DISCORD_LINKED_REPLY, DISCORD_WORDS, discordUnlinkedText, dmWarning } from "./words.ts";

const MAX_CHOICES = 25;

export type DiscordCommand = { readonly id: string; readonly userId: string; readonly name: string; readonly options: Readonly<Record<string, string>>; readonly at: string };
export type DiscordButton = { readonly userId: string; readonly data: string };
export type DiscordChoice = { readonly name: string; readonly value: string };

export type DiscordHandlerDeps = {
  readonly network: "mainnet" | "testnet";
  readonly publicUrl: string | null;
  readonly ownerFor: (discordUserId: string) => Promise<ChatOwner | null>;
  readonly redeem: (code: string, discordUserId: string) => Promise<{ readonly ok: true; readonly ownerId: string } | { readonly ok: false }>;
  readonly takeDmWarning: (ownerId: string) => Promise<boolean>;
  readonly extract: (text: string, payeeIds: readonly string[]) => Promise<Extraction>;
  readonly answeredByCode: () => void;
  readonly now?: () => number;
};

export type DiscordHandler = {
  readonly command: (command: DiscordCommand, say: Say) => Promise<void>;
  readonly button: (button: DiscordButton, say: Say) => Promise<void>;
  readonly payeeChoices: (userId: string, typed: string) => Promise<readonly DiscordChoice[]>;
};

export function discordHandler(deps: DiscordHandlerDeps): DiscordHandler {
  const chat = new Conversation({ network: deps.network, publicUrl: deps.publicUrl, format: MARKDOWN_FORMAT, words: DISCORD_WORDS, extract: deps.extract, answeredByCode: deps.answeredByCode, ...(deps.now ? { now: deps.now } : {}) });
  const unlinked = discordUnlinkedText(deps.publicUrl);
  const signUrl = (nonce: string) => `${deps.publicUrl ?? ""}/sign/${nonce}`;

  const warned = async (owner: ChatOwner, say: Say): Promise<Say> => {
    if (!(await deps.takeDmWarning(owner.ownerId))) return say;
    let pending = true;
    return async (reply) => {
      if (!pending) return say(reply);
      pending = false;
      const warning = dmWarning(deps.publicUrl);
      await say({ ...reply, text: `${reply.text}\n\n${reply.rich ? MARKDOWN_FORMAT.escape(warning) : warning}` });
    };
  };

  const inbound = (command: DiscordCommand, text: string, from: string): InboundMessage => ({ id: `dc:${command.id}`, channel: "discord", from, text, receivedAt: command.at });

  return {
    async command(command, say) {
      if (command.name === "link") {
        const linked = await deps.redeem(command.options["code"] ?? "", command.userId);
        return say({ text: linked.ok ? DISCORD_LINKED_REPLY : DISCORD_CODE_REFUSED, rich: false });
      }
      const owner = await deps.ownerFor(command.userId);
      if (command.name === "help") return say({ text: owner ? chat.help().text : `${chat.help().text}\n\n${unlinked}`, rich: false });
      if (!owner) return say({ text: unlinked, rich: false });
      const to = await warned(owner, say);
      switch (command.name) {
        case "payees": return to(await chat.payees(owner));
        case "balance": return to(await chat.balance(owner));
        case "schedules": return to(chat.schedules(owner));
        case "cancel": return to(chat.cancel(owner));
        case "pay": return chat.message(owner, to, inbound(command, `pay ${command.options["payee"] ?? ""} ${command.options["amount"] ?? ""}`, command.userId), signUrl);
        case "check": return chat.message(owner, to, inbound(command, command.options["message"] ?? "", "forwarded"), signUrl);
        default: return to(chat.help());
      }
    },
    async button(button, say) {
      const owner = await deps.ownerFor(button.userId);
      if (!owner) return say({ text: unlinked, rich: false });
      await chat.button(owner, await warned(owner, say), button.data);
    },
    async payeeChoices(userId, typed) {
      const owner = await deps.ownerFor(userId);
      if (!owner) return [];
      const wanted = typed.trim().toLowerCase();
      return (await owner.payees()).filter((p) => p.name.toLowerCase().includes(wanted)).slice(0, MAX_CHOICES).map((p) => ({ name: p.name.slice(0, 100), value: p.name.slice(0, 100) }));
    },
  };
}
