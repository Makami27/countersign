import { randomBytes } from "node:crypto";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { headOf, type Countersign, type InboundMessage, type IndexStore, type PaymentIntent, type Proposal } from "@countersign/core";
import type { Extraction } from "@countersign/adapters/gemini";
import type { OwnerAuth } from "@countersign/web/ownerAuth";
import { MODEL_UNREADABLE_REPLY, RECEIPT_PENDING_REPLY, STORE_UNANSWERED_REPLY, paymentPendingReply, paymentReply, receiptReply, replyFor } from "./replies.ts";
import { READING_REPLY, changeStartedHtml, confirmPaymentHtml, loginCodeText, refusalHtml } from "./telegramText.ts";

const CONFIRMATION_LIFETIME_MS = 5 * 60 * 1000;
const HTML = { parse_mode: "HTML" as const };

const POLL_RETRY_MS = 15_000;

export type BotDeps = {
  readonly token: string;
  readonly ownerUserId: number;
  readonly network: "mainnet" | "testnet";
  readonly publicUrl: string | null;
  readonly engine: Countersign;
  readonly index: IndexStore;
  readonly auth: OwnerAuth;
  readonly extract: (text: string, payeeIds: readonly string[]) => Promise<Extraction>;
  readonly sendPayment: (paymentId: string) => Promise<PaymentIntent>;
};

type PendingPay = { readonly inbound: InboundMessage; readonly proposal: Extract<Proposal, { kind: "pay" }>; readonly expires: number };

export function startBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.token);
  const confirmations = new Map<string, PendingPay>();
  const isOwner = (ctx: Context) => ctx.from?.id === deps.ownerUserId;
  const signUrl = (nonce: string) => `${deps.publicUrl ?? ""}/sign/${nonce}`;

  bot.command("start", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.reply("Countersign pays your verified payees and refuses new addresses it can't prove. Send \"pay <payee> <amount>\", forward a message about a payee, or send /login for an owner app code.");
  });

  bot.command("login", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.reply(loginCodeText(await deps.auth.issueCode()));
  });

  bot.on("message:text", async (ctx) => {
    if (!isOwner(ctx) || ctx.message.text.startsWith("/")) return;
    const forwarded = ctx.message.forward_origin !== undefined;
    const inbound: InboundMessage = { id: `tg:${ctx.message.message_id}`, channel: "telegram", from: forwarded ? "forwarded" : String(ctx.from.id), text: ctx.message.text, receivedAt: new Date(ctx.message.date * 1000).toISOString() };
    await ctx.reply(READING_REPLY);
    const extraction = await deps.extract(inbound.text, await deps.engine.payeeIds());
    if (extraction.status === "UNKNOWN") return void (await ctx.reply(MODEL_UNREADABLE_REPLY));
    const proposal = extraction.proposal;
    if (proposal.kind === "pay") {
      const preview = await deps.engine.previewPayment(inbound, proposal);
      if (preview.verdict === "REFUSED") return void (await ctx.reply(refusalHtml(preview, await deps.engine.receiptRecord(preview.receipt), null), HTML));
      const id = randomBytes(9).toString("base64url");
      confirmations.set(id, { inbound, proposal, expires: Date.now() + CONFIRMATION_LIFETIME_MS });
      const keyboard = new InlineKeyboard().text("Pay", `pay:${id}`).text("Cancel", `cancel:${id}`);
      return void (await ctx.reply(confirmPaymentHtml(preview.name, preview.address, preview.amountBaseUnits, deps.network), { ...HTML, reply_markup: keyboard }));
    }
    const outcome = await deps.engine.handle(inbound, proposal);
    const head = proposal.kind === "change_address" ? headOf(await deps.index.payeeVersions(proposal.payeeId)) : null;
    if (outcome.verdict === "REFUSED") return void (await ctx.reply(refusalHtml(outcome, await deps.engine.receiptRecord(outcome.receipt), head?.kind === "verified" ? head.version.address : null), HTML));
    if (outcome.verdict === "CHANGE_STARTED") return void (await ctx.reply(changeStartedHtml(outcome, signUrl(outcome.nonce)), HTML));
    await ctx.reply(replyFor(outcome));
  });

  bot.on("callback_query:data", async (ctx) => {
    if (!isOwner(ctx)) return void (await ctx.answerCallbackQuery());
    const [action, id] = ctx.callbackQuery.data.split(":");
    const pending = id ? confirmations.get(id) : undefined;
    if (id) confirmations.delete(id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    if (action === "cancel") return void (await ctx.reply("Cancelled. Nothing was sent."));
    if (!pending || pending.expires < Date.now()) return void (await ctx.reply("This confirmation expired. Nothing was sent. Ask again."));
    const outcome = await deps.engine.handle(pending.inbound, pending.proposal);
    if (outcome.verdict !== "PAY_RESERVED") return void (await ctx.reply(outcome.verdict === "REFUSED" ? refusalHtml(outcome, await deps.engine.receiptRecord(outcome.receipt), null) : replyFor(outcome), HTML));
    await ctx.reply(paymentPendingReply(outcome.amountBaseUnits, outcome.address, deps.network));
    const payment = await deps.sendPayment(outcome.paymentId);
    await ctx.reply(paymentReply(payment, deps.network));
    if (payment.state !== "SETTLED" && payment.state !== "FAILED") return;
    await ctx.reply(RECEIPT_PENDING_REPLY);
    await ctx.reply(receiptReply(await deps.engine.recordPaymentOutcome(payment)));
  });

  bot.catch(async (error) => {
    console.error(`Telegram update failed: ${error.message.slice(0, 200)}`);
    await error.ctx.reply(STORE_UNANSWERED_REPLY).catch(() => undefined);
  });
  const poll = (): void => {
    bot.start().catch((error: Error) => {
      console.error(`Telegram polling stopped: ${error.message.slice(0, 200)}. Retrying in ${POLL_RETRY_MS / 1000} s.`);
      setTimeout(poll, POLL_RETRY_MS).unref();
    });
  };
  poll();
  return bot;
}
