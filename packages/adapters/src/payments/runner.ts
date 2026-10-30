import { INTERRUPTED_WHILE_SENDING, reconcilePayment, type Clock, type PaymentIntent, type PaymentLedger, type ReasonCode } from "@countersign/core";
import type { PaymentChain } from "../tatum/payments.ts";

export const SETTLE_POLL_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

export type PaymentRunnerDeps = {
  readonly ledger: PaymentLedger;
  readonly chain: PaymentChain;
  readonly clock: Clock;
  readonly sleep?: (ms: number) => Promise<void>;
};

export class PaymentRunner {
  readonly #d: PaymentRunnerDeps;

  constructor(deps: PaymentRunnerDeps) {
    this.#d = deps;
  }

  async send(paymentId: string): Promise<PaymentIntent> {
    const intent = this.#require(paymentId);
    if (intent.state !== "RESERVED") return intent;
    const prepared = await this.#d.chain.prepare(intent.address, intent.amountBaseUnits);
    if (!prepared.ok) {
      this.#move(paymentId, "FAILED", `Nothing was sent: the transfer could not be built (${prepared.detail}).`, "PAYMENT_NOT_BUILT");
      return this.#require(paymentId);
    }
    const { digest, validUntilEpoch } = prepared.payment;
    if (!this.#d.ledger.movePayment(paymentId, { to: "SENDING", at: this.#now(), detail: null, digest, validUntilEpoch })) return this.#require(paymentId);
    const submitted = await this.#d.chain.submit(prepared.payment);
    if (submitted.state === "SENT") this.#move(paymentId, "SENT", "The gateway executed the transfer.");
    else if (submitted.state === "FAILED") {
      this.#move(paymentId, "FAILED", submitted.detail, "PAYMENT_FAILED_ON_CHAIN");
      return this.#require(paymentId);
    } else this.#move(paymentId, "UNKNOWN", submitted.detail);
    return this.settleSoon(paymentId);
  }

  async settleSoon(paymentId: string): Promise<PaymentIntent> {
    const sleep = this.#d.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (const delay of SETTLE_POLL_DELAYS_MS) {
      const after = await this.reconcile(paymentId);
      if (after.state !== "SENT" && after.state !== "UNKNOWN") return after;
      await sleep(delay);
    }
    return this.reconcile(paymentId);
  }

  async reconcile(paymentId: string): Promise<PaymentIntent> {
    const intent = this.#require(paymentId);
    if (intent.digest === null || (intent.state !== "SENT" && intent.state !== "UNKNOWN")) return intent;
    const sighting = await this.#d.chain.sight(intent.digest, intent.address, intent.amountBaseUnits);
    const decision = reconcilePayment(intent, sighting);
    if (decision.kind === "MOVE" && decision.to === "FAILED") this.#move(paymentId, "FAILED", decision.detail, decision.reason);
    else if (decision.kind === "MOVE") this.#move(paymentId, "SETTLED", decision.detail);
    return decision.kind === "MOVE" ? this.#require(paymentId) : this.#require(paymentId);
  }

  async recoverInterrupted(): Promise<readonly PaymentIntent[]> {
    for (const intent of this.#d.ledger.unresolvedPayments()) {
      if (intent.state === "SENDING") this.#move(intent.id, "UNKNOWN", INTERRUPTED_WHILE_SENDING);
    }
    const results: PaymentIntent[] = [];
    for (const intent of this.#d.ledger.unresolvedPayments()) results.push(await this.reconcile(intent.id));
    return results;
  }

  #move(paymentId: string, to: PaymentIntent["state"], detail: string, reason?: ReasonCode): void {
    this.#d.ledger.movePayment(paymentId, reason === undefined ? { to, at: this.#now(), detail } : { to, at: this.#now(), detail, reason });
  }


  #require(paymentId: string): PaymentIntent {
    const intent = this.#d.ledger.payment(paymentId);
    if (!intent) throw new Error(`No payment ${paymentId} in the ledger.`);
    return intent;
  }

  #now(): string {
    return this.#d.clock.now().toISOString();
  }
}
