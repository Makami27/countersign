import { Bot, InlineKeyboard, type Context } from "grammy";
import type { InboundMessage } from "@countersign/core";
import type { Extraction } from "@countersign/adapters/gemini";
import { STORE_UNANSWERED_REPLY } from "./replies.ts";
import { COMMANDS, TELEGRAM_WORDS } from "./commands.ts";
import { signInLinkText, unlinkedText } from "./telegramText.ts";
import { HTML_FORMAT } from "./chat/format.ts";
import { Conversation, type ChatOwner, type Reply, type Say } from "./chat/conversation.ts";

const POLL_RETRY_MS = 15_000;

export type BotOwner = ChatOwner;

export type BotDeps = {
  readonly token: string;
  readonly network: "mainnet" | "testnet";
  readonly publicUrl: string | null;
  readonly ownerFor: (telegramUserId: number) => Promise<BotOwner | null>;
  readonly redeemLink: (token: string, telegramUserId: number) => Promise<{ readonly ok: true; readonly ownerId: string } | { readonly ok: false; readonly why: "UNKNOWN" | "ADMIN_CHAT" }>;
  readonly extract: (text: string, payeeIds: readonly string[]) => Promise<Extraction>;
  readonly answeredByCode: () => void;
};

function keyboardOf(reply: Reply): InlineKeyboard | null {
  if (!reply.buttons) return null;
  const keyboard = new InlineKeyboard();
  reply.buttons.forEach((row, i) => {
    if (i > 0) keyboard.row();
    for (const button of row) keyboard.text(button.label, button.data);
  });
  return keyboard;
}

function sayTo(ctx: Context): Say {
  return async (reply) => {
    const keyboard = keyboardOf(reply);
    await ctx.reply(reply.text, { ...(reply.rich ? { parse_mode: "HTML" as const } : {}), ...(keyboard ? { reply_markup: keyboard } : {}) });
  };
}

export function startBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.token);
  const chat = new Conversation({ network: deps.network, publicUrl: deps.publicUrl, format: HTML_FORMAT, words: TELEGRAM_WORDS, extract: deps.extract, answeredByCode: deps.answeredByCode });
  const ownerOf = async (ctx: Context) => (ctx.from ? deps.ownerFor(ctx.from.id) : null);
  const signUrl = (nonce: string) => `${deps.publicUrl ?? ""}/sign/${nonce}`;
  const unlinked = (ctx: Context) => ctx.reply(unlinkedText(deps.publicUrl));

  bot.command("start", async (ctx) => {
    const token = typeof ctx.match === "string" ? ctx.match.trim() : "";
    if (token && ctx.from) {
      const linked = await deps.redeemLink(token, ctx.from.id);
      return void (await ctx.reply(linked.ok ? "Connected: this chat now runs your Countersign agent and gets its notices." : linked.why === "ADMIN_CHAT" ? "This chat already belongs to this agent's admin. Nothing was changed." : "That link expired or was already used. Nothing was changed. Make a new one in the owner app."));
    }
    if (!(await ownerOf(ctx))) return void (await unlinked(ctx));
    await sayTo(ctx)(chat.help());
  });

  bot.command("login", async (ctx) => {
    await ctx.reply(signInLinkText(deps.publicUrl));
  });

  bot.command("help", async (ctx) => {
    const linked = await ownerOf(ctx);
    const help = chat.help().text;
    await ctx.reply(linked ? help : `${help}\n\n${unlinkedText(deps.publicUrl)}`);
  });

  bot.command("payees", async (ctx) => {
    const owner = await ownerOf(ctx);
    if (!owner) return void (await unlinked(ctx));
    await sayTo(ctx)(await chat.payees(owner));
  });

  bot.command("balance", async (ctx) => {
    const owner = await ownerOf(ctx);
    if (!owner) return void (await unlinked(ctx));
    await sayTo(ctx)(await chat.balance(owner));
  });

  bot.command("schedules", async (ctx) => {
    const owner = await ownerOf(ctx);
    await ctx.reply(owner ? chat.schedules(owner).text : unlinkedText(deps.publicUrl));
  });

  bot.command("cancel", async (ctx) => {
    const owner = await ownerOf(ctx);
    await ctx.reply(owner ? chat.cancel(owner).text : unlinkedText(deps.publicUrl));
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    const owner = await ownerOf(ctx);
    if (!owner) return void (await unlinked(ctx));
    const forwarded = ctx.message.forward_origin !== undefined;
    const inbound: InboundMessage = { id: `tg:${ctx.message.message_id}`, channel: "telegram", from: forwarded ? "forwarded" : String(ctx.from.id), text: ctx.message.text, receivedAt: new Date(ctx.message.date * 1000).toISOString() };
    await chat.message(owner, sayTo(ctx), inbound, signUrl);
  });

  bot.on("callback_query:data", async (ctx) => {
    const owner = await ownerOf(ctx);
    if (!owner) return void (await ctx.answerCallbackQuery());
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await chat.button(owner, sayTo(ctx), ctx.callbackQuery.data);
  });

  bot.catch(async (error) => {
    console.error(`Telegram update failed: ${error.message.slice(0, 200)}`);
    await error.ctx.reply(STORE_UNANSWERED_REPLY).catch(() => undefined);
  });
  bot.api.setMyCommands(COMMANDS.map((c) => ({ command: c.command, description: c.description }))).catch((error: Error) => console.error(`Telegram command menu not set: ${error.message.slice(0, 200)}`));
  const poll = (): void => {
    bot.start().catch((error: Error) => {
      console.error(`Telegram polling stopped: ${error.message.slice(0, 200)}. Retrying in ${POLL_RETRY_MS / 1000} s.`);
      setTimeout(poll, POLL_RETRY_MS).unref();
    });
  };
  poll();
  return bot;
}
