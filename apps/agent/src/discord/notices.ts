import { MARKDOWN_FORMAT } from "./format.ts";

export type DmResult = "SENT" | "REFUSED" | "FAILED";

export type NoticeLinks = {
  readonly userOf: (ownerId: string) => Promise<string | null>;
  readonly dmDelivered: (ownerId: string) => Promise<void>;
  readonly dmRefused: (ownerId: string, text: string) => Promise<void>;
  readonly keepUndelivered: (ownerId: string, text: string) => Promise<void>;
};

export function discordNotifier(links: NoticeLinks, sendDm: (userId: string, content: string) => Promise<DmResult>): (ownerId: string, text: string) => Promise<void> {
  return async (ownerId, text) => {
    const userId = await links.userOf(ownerId);
    if (!userId) return;
    const sent = await sendDm(userId, MARKDOWN_FORMAT.escape(text));
    if (sent === "SENT") return links.dmDelivered(ownerId);
    if (sent === "REFUSED") return links.dmRefused(ownerId, text);
    await links.keepUndelivered(ownerId, text);
  };
}
