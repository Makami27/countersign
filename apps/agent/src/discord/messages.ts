import { escapeMarkdown } from "discord.js";
import type { Reply } from "../chat/conversation.ts";

export const DISCORD_MESSAGE_LIMIT = 2000;

export function contentOf(reply: Reply): string {
  return reply.rich ? reply.text : escapeMarkdown(reply.text);
}

export function chunks(content: string, limit = DISCORD_MESSAGE_LIMIT): readonly string[] {
  const out: string[] = [];
  let current = "";
  for (const paragraph of content.split("\n\n")) {
    const joined = current ? `${current}\n\n${paragraph}` : paragraph;
    if (joined.length <= limit) {
      current = joined;
      continue;
    }
    if (current) out.push(current);
    let rest = paragraph;
    while (rest.length > limit) {
      out.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    current = rest;
  }
  if (current || out.length === 0) out.push(current);
  return out;
}
