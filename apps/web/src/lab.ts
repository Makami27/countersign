import { createHash, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { isRefusal, Countersign, InMemoryIndex, InMemoryMemory, InMemoryPaymentLedger, addressesIn, changeMessage, headOf, onboardingMessage, type Outcome, type PayeeVersionRecord, type ReceiptRecord, type SignatureCheck, type SuiAddress } from "@countersign/core";
import { traceFor, type TraceStep } from "./trace.ts";

export const LAB_PAYEES = [
  { id: "landlord", name: "Landlord" },
  { id: "designer", name: "Designer" },
] as const;

type LabPayeeId = (typeof LAB_PAYEES)[number]["id"];
type Wallet = { readonly address: SuiAddress; readonly key: KeyObject; readonly publicKey: KeyObject };

const LAB_EPOCH = "lab sandbox";

function signedBy(wallet: Wallet, message: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(message), wallet.publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

function labVerify(wallets: ReadonlyMap<SuiAddress, Wallet>, message: string, signature: string, address: SuiAddress): SignatureCheck {
  const expected = wallets.get(address);
  if (expected && signedBy(expected, message, signature)) return { result: "VALID", scheme: "ED25519", maxEpoch: null, checkedAtEpoch: LAB_EPOCH };
  return [...wallets.values()].some((w) => signedBy(w, message, signature)) ? { result: "WRONG_SIGNER" } : { result: "INVALID" };
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 500;
const MAX_MESSAGE_CHARS = 2000;

function newWallet(): Wallet {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const address = `0x${createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("hex")}` as SuiAddress;
  return { address, key: privateKey, publicKey };
}

export type LabView = {
  readonly payees: readonly { id: string; name: string; payableAddress: SuiAddress | null; versions: readonly PayeeVersionRecord[] }[];
  readonly refusals: readonly ReceiptRecord[];
  readonly memoryRecords: number;
};

export type LabReply = { readonly outcome: Outcome; readonly trace: readonly TraceStep[]; readonly view: LabView; readonly note: string | null };

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
  touched = Date.now();
  #seq = 0;

  constructor() {
    const records = generateKeyPairSync("ed25519");
    const wallets = this.wallets;
    this.engine = new Countersign({
      ownerId: "lab",
      network: "testnet",
      memory: this.memory,
      index: this.index,
      payments: new InMemoryPaymentLedger(this.index),
      signer: {
        sign: (c) => sign(null, Buffer.from(c), records.privateKey).toString("base64"),
        verify: (c, s) => verify(null, Buffer.from(c), records.publicKey, Buffer.from(s, "base64")),
      },
      signatures: {
        verifyPersonalMessage: async (message, signature, address) => labVerify(wallets, message, signature, address),
      },
      roundTrips: { check: async () => "NOT_PROVEN" },
      clock: { now: () => new Date() },
      nonces: { next: () => `${(++this.#seq).toString(36)}${randomBytes(3).toString("hex")}` },
      caps: { perPaymentBaseUnits: 5_000_000n, perDayBaseUnits: 1_000_000_000n },
      cooldownMs: 60_000,
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
    };
  }

  async scam(payeeId: LabPayeeId, text: string): Promise<LabReply> {
    const clipped = text.slice(0, MAX_MESSAGE_CHARS);
    const message = { id: `lab:${randomBytes(4).toString("hex")}`, channel: "lab" as const, from: "visitor", text: clipped, receivedAt: new Date().toISOString() };
    const address = addressesIn(clipped)[0];
    const proposal = address
      ? ({ kind: "change_address", payeeId, newAddress: address, reasonQuote: clipped } as const)
      : ({ kind: "pay", payeeId, amountBaseUnits: "1000000", reasonQuote: clipped } as const);
    const outcome = await this.engine.handle(message, proposal);
    const note = address ? null : "No wallet address in that message, so the agent treated it as a payment request.";
    return { outcome, trace: traceFor(proposal.kind, outcome), view: this.view(), note };
  }

  async pay(payeeId: LabPayeeId): Promise<LabReply> {
    const message = { id: `lab:${randomBytes(4).toString("hex")}`, channel: "lab" as const, from: "owner", text: `Pay ${payeeId}`, receivedAt: new Date().toISOString() };
    const outcome = await this.engine.handle(message, { kind: "pay", payeeId, amountBaseUnits: "1000000", reasonQuote: message.text });
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
