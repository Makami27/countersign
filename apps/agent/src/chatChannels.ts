import type { Bot } from "grammy";
import type { SqlRows } from "@countersign/adapters/sql";
import { TelegramLinks } from "@countersign/web/telegramLinks";
import { DISCORD_OFF, DiscordLinks, type DiscordPort } from "@countersign/web/discordLinks";
import type { OwnerContext } from "@countersign/web/ownerContext";
import type { Config } from "./config.ts";
import { discordNotifier } from "./discord/notices.ts";
import type { DiscordGateway } from "./discord/gateway.ts";

export class ChatChannels {
  readonly telegramLinks: TelegramLinks;
  readonly discordLinks: DiscordLinks;
  bot: Bot | null = null;
  discord: DiscordGateway | null = null;
  readonly #config: Config;
  #botUsername: string | null = null;
  readonly #notifyDiscord: (ownerId: string, text: string) => Promise<void>;

  private constructor(config: Config, telegramLinks: TelegramLinks, discordLinks: DiscordLinks) {
    this.#config = config;
    this.telegramLinks = telegramLinks;
    this.discordLinks = discordLinks;
    this.#notifyDiscord = discordNotifier(discordLinks, (userId, content) => (this.discord ? this.discord.sendDm(userId, content) : Promise.resolve("FAILED")));
  }

  static async open(rows: SqlRows, config: Config): Promise<ChatChannels> {
    const telegramLinks = await TelegramLinks.open(rows, { telegramUserId: config.telegram.ownerUserId, ownerId: config.ownerId });
    return new ChatChannels(config, telegramLinks, await DiscordLinks.open(rows));
  }

  async #telegram(chat: number, text: string): Promise<void> {
    await this.bot?.api.sendMessage(chat, text).catch((error: Error) => console.error(`Telegram notice not sent: ${error.message.slice(0, 120)}`));
  }

  readonly notifyAdmin = async (text: string): Promise<void> => {
    await this.#telegram(this.#config.telegram.ownerUserId, text);
    await this.#notifyDiscord(this.#config.ownerId, text);
  };

  notifyFor(ownerId: string): (text: string) => Promise<void> {
    if (ownerId === this.#config.ownerId) return this.notifyAdmin;
    return async (text) => {
      const chat = await this.telegramLinks.chatOf(ownerId);
      if (chat !== null) await this.#telegram(chat, text);
      await this.#notifyDiscord(ownerId, text);
    };
  }

  telegramFor(ownerId: string): OwnerContext["telegram"] {
    return {
      link: async () => {
        if (!this.bot) return null;
        this.#botUsername ??= (await this.bot.api.getMe().catch(() => null))?.username ?? null;
        if (!this.#botUsername) return null;
        const issued = await this.telegramLinks.issue(ownerId);
        return { url: `https://t.me/${this.#botUsername}?start=${issued.token}`, expires: issued.expires };
      },
      linked: async () => (await this.telegramLinks.chatOf(ownerId)) !== null,
    };
  }

  discordFor(ownerId: string): DiscordPort {
    const discord = this.#config.discord;
    return discord ? this.discordLinks.portFor(ownerId, discord.applicationId, () => this.discord?.ready() ?? false) : DISCORD_OFF;
  }

  async forget(ownerId: string): Promise<void> {
    await this.telegramLinks.forget(ownerId);
    await this.discordLinks.forget(ownerId);
  }
}
