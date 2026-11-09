import { escapeMarkdown } from "discord.js";
import type { Format } from "../chat/format.ts";

export const MARKDOWN_FORMAT: Format = {
  escape: (text) => escapeMarkdown(text),
  bold: (escaped) => `**${escaped}**`,
  underline: (escaped) => `__${escaped}__`,
  link: (url) => url,
  url: (url) => url,
};
