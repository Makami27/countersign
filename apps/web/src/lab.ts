import { randomBytes, sign } from "node:crypto";
import { isRefusal, Countersign, InMemoryIndex, InMemoryMemory, InMemoryPaymentLedger, addressesIn, changeMessage, formatUsdc, headOf, onboardingMessage, type Outcome, type PayeeVersionRecord, type ReceiptRecord, type SuiAddress } from "@countersign/core";
import { SharedAttackList } from "@countersign/core/shared";
import { recordSignerFromSeed } from "@countersign/adapters/signer";
import { traceFor, type TraceStep } from "./trace.ts";
import { labVerify, newWallet, type Wallet } from "./labWallets.ts";
import { FORGED_NOTE, MESSAGE_LABELS, letterText, type LetterKind } from "./labLetters.ts";
import { NOTHING_ASKED, amountQuestion, questionWords, quickAmounts, readPayment, saidNotProvenWords, type KnownPayee } from "./paymentReading.ts";

export const LAB_PAYEES = [
  { id: "landlord", name: "Landlord" },
  { id: "designer", name: "Designer" },
] as const;

type LabPayeeId = (typeof LAB_PAYEES)[number]["id"];
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 500;
const MAX_MESSAGE_CHARS = 2000;
const CAPS = { perPaymentBaseUnits: 5_000_000n, perDayBaseUnits: 1_000_000_000n };

export type LabView = {
  readonly payees: readonly { id: string; name: string; payableAddress: SuiAddress | null; versions: readonly PayeeVersionRecord[] }[];
  readonly refusals: readonly ReceiptRecord[];
  readonly memoryRecords: number;
  readonly activity: readonly ActivityEntry[];
};

export type ActivityEntry = { readonly at: string; readonly label: string; readonly verdict: string; readonly reason: string | null; readonly receipt: string | null; readonly note: string | null };

export type LabAnswer =
  | { readonly kind: "ask_amount"; readonly payeeId: string; readonly name: string; readonly address: SuiAddress; readonly question: string; readonly amounts: readonly string[] }
  | { readonly kind: "preview"; readonly payeeId: string; readonly name: string; readonly address: SuiAddress; readonly amount: string };

export type LabReply = { readonly outcome: Outcome; readonly trace: readonly TraceStep[]; readonly view: LabView; readonly note: string | null; readonly answer?: LabAnswer };

class LabIndex extends InMemoryIndex {
  readonly refusals: ReceiptRecord[] = [];

  override async putReceipt(record: ReceiptRecord, blobId: string | null): Promise<void> {
    if (isRefusal(record)) this.refusals.unshift(record);
    await super.putReceipt(record, blobId);
  }
}

class LabSession {
  readonly wallets = new Map<SuiAddress, Wallet>();
  readonly memory = new InMemoryMemory();
  readonly index = new LabIndex();
  readonly engine: Countersign;
  readonly current = new Map<LabPayeeId, Wallet>();
  readonly activity: ActivityEntry[] = [];
  touched = Date.now();
  #seq = 0;

  constructor() {
    const signer = recordSignerFromSeed(randomBytes(32).toString("base64"));
    const wallets = this.wallets;
    this.engine = new Countersign({
      ownerId: "lab",
      network: "testnet",
      memory: this.memory,
      index: this.index,
      payments: new InMemoryPaymentLedger(this.index),
      signer,
      signatures: {
        verifyPersonalMessage: async (message, signature, address) => labVerify(wallets, message, signature, address),
      },
      roundTrips: { check: async () => "NOT_PROVEN" },
      clock: { now: () => new Date() },
      nonces: { next: () => `${(++this.#seq).toString(36)}${randomBytes(3).toString("hex")}` },
      caps: CAPS,
      cooldownMs: 60_000,
      shared: new SharedAttackList({ memory: this.memory, signer, now: () => new Date() }),
    });
  }

  async seed(): Promise<void> {
    for (const payee of LAB_PAYEES) {
      const wallet = newWallet();
      this.wallets.set(wallet.address, wallet);
      this.current.set(payee.id, wallet);
      const started = await this.engine.requestOnboarding(payee.name, wallet.address, `lab-owner-${payee.id}`);
      if (started.verdict !== "ONBOARDING_STARTED") throw new Error(`lab payee ${payee.id} could not start onboarding`);
      const signed = onboardingMessage({ nonce: started.nonce, payeeId: started.payeeId, name: payee.name, address: started.address, expires: started.expires });
      await this.engine.completeOnboarding(started.nonce, { kind: "signature", signature: sign(null, Buffer.from(signed), wallet.key).toString("base64") });
    }
  }

  view(): LabView {
    return {
      payees: LAB_PAYEES.map((p) => {
        const versions = this.index.versionsNow(p.id);
        const head = headOf(versions);
        return { id: p.id, name: p.name, payableAddress: head.kind === "verified" ? head.version.address : null, versions };
      }),
      refusals: this.index.refusals.slice(0, 12),
      memoryRecords: [...this.memory.spaces.values()].reduce((n, texts) => n + texts.length, 0),
      activity: this.activity.slice(0, 20),
    };
  }

  #log(label: string, outcome: Outcome, note: string | null): void {
    const receipt = "receipt" in outcome ? outcome.receipt : null;
    this.activity.unshift({ at: new Date().toISOString(), label, verdict: outcome.verdict, reason: outcome.verdict === "REFUSED" ? outcome.reason : null, receipt, note });
    this.activity.splice(20);
  }

  async letter(kind: LetterKind, payeeId: LabPayeeId): Promise<LabReply> {
    const payee = LAB_PAYEES.find((p) => p.id === payeeId);
    const current = this.current.get(payeeId);
    if (!payee || !current) throw new Error(`unknown lab payee ${payeeId}`);
    const text = letterText(kind, payeeId, payee.name, current.address);
    if (kind !== "forged") return this.scam(payeeId, text, MESSAGE_LABELS[kind]);
    this.memory.plant(`countersign:lab:payee:${payeeId}`, text);
    await this.engine.restore();
    const outcome = await this.engine.handle({ id: `lab:${randomBytes(4).toString("hex")}`, channel: "lab", from: "owner", text: `Pay ${payeeId}`, receivedAt: new Date().toISOString() }, { kind: "pay", payeeId, amountBaseUnits: "1000000", reasonQuote: `Pay ${payeeId}` });
    this.#log(MESSAGE_LABELS.forged, outcome, FORGED_NOTE);
    return { outcome, trace: traceFor("pay", outcome), view: this.view(), note: FORGED_NOTE };
  }

  #known(): readonly KnownPayee[] {
    return this.view().payees.map((p) => ({ id: p.id, name: p.name, verified: p.payableAddress }));
  }

  #answered(label: string, verdict: string, note: string, answer?: LabAnswer): LabReply {
    this.activity.unshift({ at: new Date().toISOString(), label, verdict, reason: null, receipt: null, note });
    this.activity.splice(20);
    return { outcome: { verdict: "NONE" }, trace: [], view: this.view(), note, ...(answer ? { answer } : {}) };
  }

  async #change(payeeId: string, address: SuiAddress, text: string, label: string): Promise<LabReply> {
    const message = { id: `lab:${randomBytes(4).toString("hex")}`, channel: "lab" as const, from: "visitor", text, receivedAt: new Date().toISOString() };
    const outcome = await this.engine.handle(message, { kind: "change_address", payeeId, newAddress: address, reasonQuote: text });
    const name = LAB_PAYEES.find((p) => p.id === payeeId)?.name ?? payeeId;
    const note = outcome.verdict === "CHANGE_STARTED" ? saidNotProvenWords(name) : null;
    this.#log(label, outcome, note);
    return { outcome, trace: traceFor("change_address", outcome), view: this.view(), note };
  }

  async scam(payeeId: LabPayeeId, text: string, label = "Your message"): Promise<LabReply> {
    const clipped = text.slice(0, MAX_MESSAGE_CHARS);
    const reading = readPayment(clipped, this.#known(), payeeId);
    const stated = addressesIn(clipped)[0];
    if (!reading) return stated ? this.#change(payeeId, stated, clipped, label) : this.#answered(label, "NONE", NOTHING_ASKED);
    if (reading.kind === "change") return this.#change(reading.payee.id, reading.address, clipped, label);
    if (reading.kind === "ask_amount") {
      const amounts = quickAmounts(CAPS.perPaymentBaseUnits);
      return this.#answered(label, "ASK_AMOUNT", questionWords(reading, []), { kind: "ask_amount", payeeId: reading.payee.id, name: reading.payee.name, address: reading.verified, question: amountQuestion(reading.payee.name), amounts });
    }
    if (reading.kind === "pay") {
      const amount = formatUsdc(BigInt(reading.amountBaseUnits));
      return this.#answered(label, "PAY_PREVIEW", `This reads as a payment of ${amount} USDC to ${reading.payee.name}. Nothing was sent.`, { kind: "preview", payeeId: reading.payee.id, name: reading.payee.name, address: reading.verified, amount });
    }
    return this.#answered(label, "NONE", questionWords(reading, LAB_PAYEES.map((p) => p.name)));
  }

  async pay(payeeId: LabPayeeId, amountBaseUnits = "1000000"): Promise<LabReply> {
    const message = { id: `lab:${randomBytes(4).toString("hex")}`, channel: "lab" as const, from: "owner", text: `Pay ${payeeId}`, receivedAt: new Date().toISOString() };
    const outcome = await this.engine.handle(message, { kind: "pay", payeeId, amountBaseUnits, reasonQuote: message.text });
    this.#log(`Pay ${payeeId}`, outcome, null);
    return { outcome, trace: traceFor("pay", outcome), view: this.view(), note: null };
  }

  async genuineChange(payeeId: LabPayeeId): Promise<LabReply> {
    const old = this.current.get(payeeId);
    if (!old) throw new Error(`unknown lab payee ${payeeId}`);
    const next = newWallet();
    this.wallets.set(next.address, next);
    const text = `Hi, it's me. My new wallet is ${next.address}. I'll sign the change from my current wallet.`;
    const started = await this.engine.handle({ id: `lab:${randomBytes(4).toString("hex")}`, channel: "lab", from: "payee", text, receivedAt: new Date().toISOString() }, { kind: "change_address", payeeId, newAddress: next.address, reasonQuote: text });
    if (started.verdict !== "CHANGE_STARTED") return { outcome: started, trace: traceFor("change_address", started), view: this.view(), note: null };
    const signed = changeMessage({ nonce: started.nonce, payeeId, fromAddress: started.fromAddress, toAddress: started.toAddress, expires: started.expires });
    const outcome = await this.engine.completeChange(
      started.nonce,
      { kind: "signature", signature: sign(null, Buffer.from(signed), old.key).toString("base64") },
      { kind: "signature", signature: sign(null, Buffer.from(signed), next.key).toString("base64") },
    );
    if (outcome.verdict === "CHANGE_VERIFIED") this.current.set(payeeId, next);
    return { outcome, trace: traceFor("change_address", outcome), view: this.view(), note: "The payee's current wallet signed the change and the new wallet proved control." };
  }
}

export class LabSessions {
  readonly #sessions = new Map<string, LabSession>();

  async open(id: string | null): Promise<{ id: string; session: LabSession }> {
    this.#sweep();
    const existing = id ? this.#sessions.get(id) : undefined;
    if (existing && id) {
      existing.touched = Date.now();
      return { id, session: existing };
    }
    const fresh = new LabSession();
    await fresh.seed();
    const newId = randomBytes(16).toString("hex");
    this.#sessions.set(newId, fresh);
    return { id: newId, session: fresh };
  }

  reset(id: string | null): void {
    if (id) this.#sessions.delete(id);
  }

  #sweep(): void {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, s] of this.#sessions) if (s.touched < cutoff) this.#sessions.delete(id);
    while (this.#sessions.size >= MAX_SESSIONS) {
      const oldest = this.#sessions.keys().next().value;
      if (oldest === undefined) break;
      this.#sessions.delete(oldest);
    }
  }
}

export function isLabPayee(value: unknown): value is LabPayeeId {
  return LAB_PAYEES.some((p) => p.id === value);
}
