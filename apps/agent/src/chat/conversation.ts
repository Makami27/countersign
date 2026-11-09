import { randomBytes } from "node:crypto";
import { headOf, usdcToBaseUnits, type Countersign, type InboundMessage, type IndexStore, type PaymentIntent, type Proposal } from "@countersign/core";
import type { Extraction } from "@countersign/adapters/model";
import type { BalancesView } from "@countersign/web/ownerContext";
import { readMessage } from "@countersign/web/screen";
import { BUSY } from "@countersign/web/quota";
import { quickAmounts } from "@countersign/web/paymentReading";
import { MODEL_UNREADABLE_REPLY, RECEIPT_PENDING_REPLY, paymentPendingReply, paymentReply, receiptReply, replyFor } from "../replies.ts";
import { balanceText, cancelText, helpLines, payeesText, schedulesText, type ChannelWords, type Network, type PayeeLine, type ScheduleLine } from "./commands.ts";
import { READING_REPLY, changeStartedText, confirmPaymentText, questionText, refusalText } from "./text.ts";
import type { Format } from "./format.ts";

export const CONFIRMATION_LIFETIME_MS = 5 * 60 * 1000;
const AMOUNT_ONLY = /^\s*\$?\s*(\d+(?:\.\d{1,6})?)\s*(?:usdc)?\s*$/i;

export type ChatOwner = { readonly ownerId: string; readonly engine: Countersign; readonly index: IndexStore; readonly sendPayment: (paymentId: string) => Promise<PaymentIntent>; readonly busy: () => boolean; readonly countModel: () => void; readonly agentAddress: string; readonly balances: (fresh?: boolean) => Promise<BalancesView>; readonly payees: () => Promise<readonly PayeeLine[]>; readonly schedules: () => readonly ScheduleLine[]; readonly perPaymentCap: () => bigint };
export type Button = { readonly label: string; readonly data: string };
export type Reply = { readonly text: string; readonly rich: boolean; readonly buttons?: readonly (readonly Button[])[] };
export type Say = (reply: Reply) => Promise<void>;

export type ConversationDeps = {
  readonly network: Network;
  readonly publicUrl: string | null;
  readonly format: Format;
  readonly words: ChannelWords;
  readonly extract: (text: string, payeeIds: readonly string[]) => Promise<Extraction>;
  readonly answeredByCode: () => void;
  readonly now?: () => number;
};

type PendingPay = { readonly ownerId: string; readonly inbound: InboundMessage; readonly proposal: Extract<Proposal, { kind: "pay" }>; readonly expires: number };
type PendingAmount = { readonly id: string; readonly inbound: InboundMessage; readonly payeeId: string; readonly expires: number };

const plain = (text: string): Reply => ({ text, rich: false });

export class Conversation {
  readonly #d: ConversationDeps;
  readonly #confirmations = new Map<string, PendingPay>();
  readonly #askedAmounts = new Map<string, PendingAmount>();

  constructor(deps: ConversationDeps) {
    this.#d = deps;
  }

  #now(): number {
    return this.#d.now?.() ?? Date.now();
  }

  #rich(text: string, buttons?: readonly (readonly Button[])[]): Reply {
    return buttons ? { text, rich: true, buttons } : { text, rich: true };
  }

  help(): Reply {
    return plain(helpLines(this.#d.words, this.#d.publicUrl, this.#d.network));
  }

  async payees(owner: ChatOwner): Promise<Reply> {
    return this.#rich(payeesText(this.#d.format, await owner.payees(), this.#d.publicUrl, this.#d.words.payWith));
  }

  async balance(owner: ChatOwner): Promise<Reply> {
    return this.#rich(balanceText(this.#d.format, owner.agentAddress, await owner.balances(), this.#d.network));
  }

  schedules(owner: ChatOwner): Reply {
    return plain(schedulesText(owner.schedules(), this.#d.publicUrl));
  }

  cancel(owner: ChatOwner): Reply {
    const mine = [...this.#confirmations.entries()].filter(([, p]) => p.ownerId === owner.ownerId && p.expires >= this.#now());
    for (const [id] of mine) this.#confirmations.delete(id);
    return plain(cancelText(mine.length, this.#d.publicUrl));
  }

  async #previewPay(owner: ChatOwner, say: Say, inbound: InboundMessage, proposal: Extract<Proposal, { kind: "pay" }>): Promise<void> {
    const preview = await owner.engine.previewPayment(inbound, proposal);
    if (preview.verdict === "REFUSED") return say(this.#rich(refusalText(this.#d.format, preview, await owner.engine.receiptRecord(preview.receipt), null, this.#d.publicUrl)));
    const id = randomBytes(9).toString("base64url");
    this.#confirmations.set(id, { ownerId: owner.ownerId, inbound, proposal, expires: this.#now() + CONFIRMATION_LIFETIME_MS });
    await say(this.#rich(confirmPaymentText(this.#d.format, preview.name, preview.address, preview.amountBaseUnits, this.#d.network), [[{ label: "Pay", data: `pay:${id}` }, { label: "Cancel", data: `cancel:${id}` }]]));
  }

  async #previewAmount(owner: ChatOwner, say: Say, asked: PendingAmount, amountText: string): Promise<void> {
    this.#askedAmounts.delete(owner.ownerId);
    const amountBaseUnits = usdcToBaseUnits(amountText);
    if (!amountBaseUnits) return say(plain("Give the amount in USDC, for example 0.10. Nothing was sent."));
    await this.#previewPay(owner, say, asked.inbound, { kind: "pay", payeeId: asked.payeeId, amountBaseUnits, reasonQuote: asked.inbound.text });
  }

  async message(owner: ChatOwner, say: Say, inbound: InboundMessage, signUrl: (nonce: string) => string): Promise<void> {
    if (owner.busy()) return say(plain(BUSY));
    const waitingAmount = this.#askedAmounts.get(owner.ownerId);
    const typedAmount = AMOUNT_ONLY.exec(inbound.text)?.[1];
    if (waitingAmount && waitingAmount.expires >= this.#now() && typedAmount) return this.#previewAmount(owner, say, waitingAmount, typedAmount);
    const reading = await readMessage(owner.index, async (text, payeeIds) => {
      await say(plain(READING_REPLY));
      owner.countModel();
      return this.#d.extract(text, payeeIds);
    }, inbound.text);
    if (reading.status === "UNKNOWN") return say(plain(MODEL_UNREADABLE_REPLY));
    const f = this.#d.format;
    if (reading.status === "QUESTION") {
      this.#d.answeredByCode();
      const { question, payeeNames } = reading;
      const text = questionText(f, question, payeeNames, this.#d.publicUrl, this.#d.words.amountHint);
      if (question.kind !== "ask_amount") return say(this.#rich(text));
      const asked = { id: randomBytes(9).toString("base64url"), inbound, payeeId: question.payee.id, expires: this.#now() + CONFIRMATION_LIFETIME_MS };
      this.#askedAmounts.set(owner.ownerId, asked);
      const amounts = quickAmounts(owner.perPaymentCap()).map((amount) => ({ label: `${amount} USDC`, data: `amount:${asked.id}:${amount}` }));
      return say(this.#rich(text, [amounts, [{ label: "Cancel", data: `cancel:${asked.id}` }]]));
    }
    if (reading.by === "code") this.#d.answeredByCode();
    const proposal = reading.proposal;
    if (proposal.kind === "pay") return this.#previewPay(owner, say, inbound, proposal);
    const outcome = await owner.engine.handle(inbound, proposal);
    const head = proposal.kind === "change_address" ? headOf(await owner.index.payeeVersions(proposal.payeeId)) : null;
    if (outcome.verdict === "REFUSED") return say(this.#rich(refusalText(f, outcome, await owner.engine.receiptRecord(outcome.receipt), head?.kind === "verified" ? head.version.address : null, this.#d.publicUrl)));
    if (outcome.verdict === "CHANGE_STARTED") return say(this.#rich(changeStartedText(f, outcome, signUrl(outcome.nonce))));
    await say(plain(replyFor(outcome)));
  }

  async button(owner: ChatOwner, say: Say, data: string): Promise<void> {
    const [action, id, amountText] = data.split(":");
    const found = id ? this.#confirmations.get(id) : undefined;
    const pending = found?.ownerId === owner.ownerId ? found : undefined;
    if (id && pending) this.#confirmations.delete(id);
    if (action === "cancel") {
      if (this.#askedAmounts.get(owner.ownerId)?.id === id) this.#askedAmounts.delete(owner.ownerId);
      return say(plain("Cancelled. Nothing was sent."));
    }
    if (action === "amount") {
      const asked = this.#askedAmounts.get(owner.ownerId);
      if (!asked || asked.id !== id || asked.expires < this.#now()) return say(plain("This question expired. Nothing was sent. Ask again."));
      return this.#previewAmount(owner, say, asked, amountText ?? "");
    }
    if (!pending || pending.expires < this.#now()) return say(plain("This confirmation expired. Nothing was sent. Ask again."));
    const outcome = await owner.engine.handle(pending.inbound, pending.proposal);
    if (outcome.verdict !== "PAY_RESERVED") return say(outcome.verdict === "REFUSED" ? this.#rich(refusalText(this.#d.format, outcome, await owner.engine.receiptRecord(outcome.receipt), null, this.#d.publicUrl)) : this.#rich(this.#d.format.escape(replyFor(outcome))));
    await say(plain(paymentPendingReply(outcome.amountBaseUnits, outcome.address, this.#d.network)));
    const payment = await owner.sendPayment(outcome.paymentId);
    await say(plain(paymentReply(payment, this.#d.network)));
    if (payment.state !== "SETTLED" && payment.state !== "FAILED") return;
    await say(plain(RECEIPT_PENDING_REPLY));
    await say(plain(receiptReply(await owner.engine.recordPaymentOutcome(payment), this.#d.publicUrl)));
  }
}
