import type { Extraction } from "@countersign/adapters/model";
import type { DiscordLinks } from "@countersign/web/discordLinks";
import type { ChatOwner } from "../chat/conversation.ts";
import { startDiscord, type DiscordGateway } from "./gateway.ts";
import { discordHandler } from "./handler.ts";

export type DiscordStart = {
  readonly token: string;
  readonly applicationId: string;
  readonly network: "mainnet" | "testnet";
  readonly publicUrl: string | null;
  readonly links: DiscordLinks;
  readonly ownerFor: (ownerId: string) => ChatOwner | null;
  readonly notifyAdmin: (text: string) => Promise<void>;
  readonly extract: (text: string, payeeIds: readonly string[]) => Promise<Extraction>;
  readonly answeredByCode: () => void;
};

export function startDiscordBot(s: DiscordStart): DiscordGateway {
  return startDiscord(s.token, s.applicationId, discordHandler({
    network: s.network, publicUrl: s.publicUrl, extract: s.extract, answeredByCode: s.answeredByCode,
    ownerFor: async (discordUserId) => {
      const ownerId = await s.links.ownerOf(discordUserId);
      return ownerId ? s.ownerFor(ownerId) : null;
    },
    redeem: async (code, discordUserId) => {
      const linked = await s.links.redeem(code, discordUserId);
      if (linked.ok) await s.notifyAdmin(`Owner ${linked.ownerId} connected a Discord account.`);
      return linked;
    },
    takeDmWarning: (ownerId) => s.links.takeDmWarning(ownerId),
  }));
}
