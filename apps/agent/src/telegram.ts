import { randomBytes } from "node:crypto";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { headOf, usdcToBaseUnits, type Countersign, type InboundMessage, type IndexStore, type PaymentIntent, type Proposal } from "@countersign/core";
import type { Extraction } from "@countersign/adapters/gemini";
import { MODEL_UNREADABLE_REPLY, RECEIPT_PENDING_REPLY, STORE_UNANSWERED_REPLY, paymentPendingReply, paymentReply, receiptReply, replyFor } from "./replies.ts";
import { readMessage } from "@countersign/web/screen";
import { BUSY } from "@countersign/web/quota";
import { COMMANDS, balanceHtml, cancelText, helpText, payeesHtml, schedulesText, type PayeeLine, type ScheduleLine } from "./commands.ts";
import type { BalancesView } from "@countersign/web/ownerContext";
import { READING_REPLY, changeStartedHtml, confirmPaymentHtml, questionHtml, signInLinkText, refusalHtml, unlinkedText } from "./telegramText.ts";
import { quickAmounts } from "@countersign/web/paymentReading";

const CONFIRMATION_LIFETIME_MS = 5 * 60 * 1000;
const HTML = { parse_mode: "HTML" as const };

const POLL_RETRY_MS = 15_000;

export type BotOwner = { readonly ownerId: string; readonly engine: Countersign; readonly index: IndexStore; readonly sendPayment: (paymentId: string) => Promise<PaymentIntent>; readonly busy: () => boolean; readonly countModel: () => void; readonly agentAddress: string; readonly balances: () => Promise<BalancesView>; readonly payees: () => Promise<readonly PayeeLine[]>; readonly schedules: () => readonly ScheduleLine[]; readonly perPaymentCap: () => bigint };

export type BotDeps = {
  readonly token: string;
  readonly network: "mainnet" | "testnet";
  readonly publicUrl: string | null;
  readonly ownerFor: (telegramUserId: number) => Promise<BotOwner | null>;
  readonly redeemLink: (token: string, telegramUserId: number) => Promise<{ readonly ok: true; readonly ownerId: string } | { readonly ok: false; readonly why: "UNKNOWN" | "ADMIN_CHAT" }>;
  readonly extract: (text: string, payeeIds: readonly string[]) => Promise<Extraction>;
  readonly answeredByCode: () => void;
};

type PendingPay = { readonly ownerId: string; readonly inbound: InboundMessage; readonly proposal: Extract<Proposal, { kind: "pay" }>; readonly expires: number };
type PendingAmount = { readonly id: string; readonly inbound: InboundMessage; readonly payeeId: string; readonly expires: number };
const AMOUNT_ONLY = /^\s*\$?\s*(\d+(?:\.\d{1,6})?)\s*(?:usdc)?\s*$/i;

export function startBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.token);
  const confirmations = new Map<string, PendingPay>();
  const askedAmounts = new Map<string, PendingAmount>();
  const previewPay = async (ctx: Context, owner: BotOwner, inbound: InboundMessage, proposal: Extract<Proposal, { kind: "pay" }>) => {
    const preview = await owner.engine.previewPayment(inbound, proposal);
    if (preview.verdict === "REFUSED") return void (await ctx.reply(refusalHtml(preview, await owner.engine.receiptRecord(preview.receipt), null, deps.publicUrl), HTML));
    const id = randomBytes(9).toString("base64url");
    confirmations.set(id, { ownerId: owner.ownerId, inbound, proposal, expires: Date.now() + CONFIRMATION_LIFETIME_MS });
    const keyboard = new InlineKeyboard().text("Pay", `pay:${id}`).text("Cancel", `cancel:${id}`);
    await ctx.reply(confirmPaymentHtml(preview.name, preview.address, preview.amountBaseUnits, deps.network), { ...HTML, reply_markup: keyboard });
  };
  const previewAmount = async (ctx: Context, owner: BotOwner, asked: PendingAmount, amountText: string) => {
    askedAmounts.delete(owner.ownerId);
    const amountBaseUnits = usdcToBaseUnits(amountText);
    if (!amountBaseUnits) return void (await ctx.reply("Give the amount in USDC, for example 0.10. Nothing was sent."));
    await previewPay(ctx, owner, asked.inbound, { kind: "pay", payeeId: asked.payeeId, amountBaseUnits, reasonQuote: asked.inbound.text });
  };
  const ownerOf = async (ctx: Context) => (ctx.from ? deps.ownerFor(ctx.from.id) : null);
  const signUrl = (nonce: string) => `${deps.publicUrl ?? ""}/sign/${nonce}`;

  bot.command("start", async (ctx) => {
    const token = typeof ctx.match === "string" ? ctx.match.trim() : "";
    if (token && ctx.from) {
      const linked = await deps.redeemLink(token, ctx.from.id);
      return void (await ctx.reply(linked.ok ? "Connected: this chat now runs your Countersign agent and gets its notices." : linked.why === "ADMIN_CHAT" ? "This chat already belongs to this agent's admin. Nothing was changed." : "That link expired or was already used. Nothing was changed. Make a new one in the owner app."));
    }
    if (!(await ownerOf(ctx))) return void (await ctx.reply(unlinkedText(deps.publicUrl)));
    await ctx.reply(helpText(deps.publicUrl, deps.network));
  });

  bot.command("login", async (ctx) => {
    await ctx.reply(signInLinkText(deps.publicUrl));
  });

  bot.command("help", async (ctx) => {
    const linked = await ownerOf(ctx);
    await ctx.reply(linked ? helpText(deps.publicUrl, deps.network) : `${helpText(deps.publicUrl, deps.network)}

${unlinkedText(deps.publicUrl)}`);
  });

  bot.command("payees", async (ctx) => {
    const owner = await ownerOf(ctx);
    await ctx.reply(owner ? payeesHtml(await owner.payees(), deps.publicUrl) : unlinkedText(deps.publicUrl), HTML);
  });

  bot.command("balance", async (ctx) => {
    const owner = await ownerOf(ctx);
    await ctx.reply(owner ? balanceHtml(owner.agentAddress, await owner.balances(), deps.network) : unlinkedText(deps.publicUrl), HTML);
  });

  bot.command("schedules", async (ctx) => {
    const owner = await ownerOf(ctx);
    await ctx.reply(owner ? schedulesText(owner.schedules(), deps.publicUrl) : unlinkedText(deps.publicUrl));
  });

  bot.command("cancel", async (ctx) => {
    const owner = await ownerOf(ctx);
    if (!owner) return void (await ctx.reply(unlinkedText(deps.publicUrl)));
    const mine = [...confirmations.entries()].filter(([, p]) => p.ownerId === owner.ownerId && p.expires >= Date.now());
    for (const [id] of mine) confirmations.delete(id);
    await ctx.reply(cancelText(mine.length, deps.publicUrl));
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    const owner = await ownerOf(ctx);
    if (!owner) return void (await ctx.reply(unlinkedText(deps.publicUrl)));
    if (owner.busy()) return void (await ctx.reply(BUSY));
    const waitingAmount = askedAmounts.get(owner.ownerId);
    const typedAmount = AMOUNT_ONLY.exec(ctx.message.text)?.[1];
    if (waitingAmount && waitingAmount.expires >= Date.now() && typedAmount) return previewAmount(ctx, owner, waitingAmount, typedAmount);
    const forwarded = ctx.message.forward_origin !== undefined;
    const inbound: InboundMessage = { id: `tg:${ctx.message.message_id}`, channel: "telegram", from: forwarded ? "forwarded" : String(ctx.from.id), text: ctx.message.text, receivedAt: new Date(ctx.message.date * 1000).toISOString() };
    const reading = await readMessage(owner.index, async (text, payeeIds) => {
      await ctx.reply(READING_REPLY);
      owner.countModel();
      return deps.extract(text, payeeIds);
    }, inbound.text);
    if (reading.status === "UNKNOWN") return void (await ctx.reply(MODEL_UNREADABLE_REPLY));
    if (reading.status === "QUESTION") {
      deps.answeredByCode();
      const { question, payeeNames } = reading;
      if (question.kind !== "ask_amount") return void (await ctx.reply(questionHtml(question, payeeNames, deps.publicUrl), HTML));
      const asked = { id: randomBytes(9).toString("base64url"), inbound, payeeId: question.payee.id, expires: Date.now() + CONFIRMATION_LIFETIME_MS };
      askedAmounts.set(owner.ownerId, asked);
      const keyboard = new InlineKeyboard();
      for (const amount of quickAmounts(owner.perPaymentCap())) keyboard.text(`${amount} USDC`, `amount:${asked.id}:${amount}`);
      return void (await ctx.reply(questionHtml(question, payeeNames, deps.publicUrl), { ...HTML, reply_markup: keyboard.row().text("Cancel", `cancel:${asked.id}`) }));
    }
    if (reading.by === "code") deps.answeredByCode();
    const proposal = reading.proposal;
    if (proposal.kind === "pay") return previewPay(ctx, owner, inbound, proposal);
    const outcome = await owner.engine.handle(inbound, proposal);
    const head = proposal.kind === "change_address" ? headOf(await owner.index.payeeVersions(proposal.payeeId)) : null;
    if (outcome.verdict === "REFUSED") return void (await ctx.reply(refusalHtml(outcome, await owner.engine.receiptRecord(outcome.receipt), head?.kind === "verified" ? head.version.address : null, deps.publicUrl), HTML));
    if (outcome.verdict === "CHANGE_STARTED") return void (await ctx.reply(changeStartedHtml(outcome, signUrl(outcome.nonce)), HTML));
    await ctx.reply(replyFor(outcome));
  });

  bot.on("callback_query:data", async (ctx) => {
    const owner = await ownerOf(ctx);
    if (!owner) return void (await ctx.answerCallbackQuery());
    const [action, id, amountText] = ctx.callbackQuery.data.split(":");
    const pending = id ? confirmations.get(id) : undefined;
    if (id) confirmations.delete(id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    if (action === "cancel") {
      if (askedAmounts.get(owner.ownerId)?.id === id) askedAmounts.delete(owner.ownerId);
      return void (await ctx.reply("Cancelled. Nothing was sent."));
    }
    if (action === "amount") {
      const asked = askedAmounts.get(owner.ownerId);
      if (!asked || asked.id !== id || asked.expires < Date.now()) return void (await ctx.reply("This question expired. Nothing was sent. Ask again."));
      return previewAmount(ctx, owner, asked, amountText ?? "");
    }
    if (!pending || pending.expires < Date.now() || pending.ownerId !== owner.ownerId) return void (await ctx.reply("This confirmation expired. Nothing was sent. Ask again."));
    const outcome = await owner.engine.handle(pending.inbound, pending.proposal);
    if (outcome.verdict !== "PAY_RESERVED") return void (await ctx.reply(outcome.verdict === "REFUSED" ? refusalHtml(outcome, await owner.engine.receiptRecord(outcome.receipt), null, deps.publicUrl) : replyFor(outcome), HTML));
    await ctx.reply(paymentPendingReply(outcome.amountBaseUnits, outcome.address, deps.network));
    const payment = await owner.sendPayment(outcome.paymentId);
    await ctx.reply(paymentReply(payment, deps.network));
    if (payment.state !== "SETTLED" && payment.state !== "FAILED") return;
    await ctx.reply(RECEIPT_PENDING_REPLY);
    await ctx.reply(receiptReply(await owner.engine.recordPaymentOutcome(payment), deps.publicUrl));
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
