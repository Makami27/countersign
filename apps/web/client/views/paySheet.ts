import { REASONS, formatUsdc, usdcToBaseUnits, type ReasonCode } from "@countersign/core";
import { api } from "../api.ts";
import { addressEl, h, listen, networkWords, signatureFigure, usdc } from "../dom.ts";
import { isFinished, payStages, remainingToday, type PayPhase } from "../payStages.ts";
import type { Overview, PaymentStatus, Refusal } from "../types.ts";
import { quickAmounts } from "../walletFacts.ts";
import { showMoment } from "../moment.ts";
import { openSheet } from "./sheets.ts";

export type PayTarget = { readonly id: string; readonly name: string; readonly address: string };

const POLL_MS = 1_500;
const RECEIPT_WAIT_MS = 90_000;
const UNKNOWN_WAIT_MS = 45_000;

function storedWhere(overview: Overview): string {
  return overview.memory.relayer.startsWith("sandbox") ? "in sandbox memory (not Walrus Memory)" : "on Walrus Memory";
}

function refusalWords(refusal: Refusal, overview: Overview, baseUnits: string): string {
  if (refusal.reason !== "CAP_EXCEEDED") return [refusal.message, refusal.nextAction].filter(Boolean).join(" ");
  return BigInt(baseUnits) > BigInt(overview.caps.perPaymentBaseUnits)
    ? `${usdc(baseUnits)} is above the per-payment cap of ${usdc(overview.caps.perPaymentBaseUnits)}. Change it in Settings if you mean it.`
    : `This would pass today's cap of ${usdc(overview.caps.perDayBaseUnits)}; ${usdc(overview.caps.usedTodayBaseUnits)} is already used today.`;
}

function stageList(phase: PayPhase, amount: string, name: string): HTMLElement {
  return h("ol", { class: "steps pay-steps" }, ...payStages(phase, amount, name).map((stage) => h("li", { class: `stage ${stage.state}`, "aria-current": stage.state === "active" ? "step" : undefined },
    h("span", { class: "n", "aria-hidden": "true" }, { done: "✓", active: "…", waiting: "·", failed: "×", unsure: "?" }[stage.state]),
    h("span", { class: "stage-words" }, h("strong", {}, stage.label), h("span", {}, stage.words)))));
}

export function paySheet(target: PayTarget, overview: Overview, onClosed: () => void, onDeposit: () => void, prefilled: string | null = null): void {
  openSheet(`Pay ${target.name}`, (close, body) => {
    const perPayment = BigInt(overview.caps.perPaymentBaseUnits);
    const leftToday = remainingToday(overview.caps.perDayBaseUnits, overview.caps.usedTodayBaseUnits);
    const held = overview.balances.status === "KNOWN" ? BigInt(overview.balances.usdcBaseUnits) : null;
    const limit = [perPayment, leftToday, held ?? perPayment].reduce((smallest, value) => (value < smallest ? value : smallest));
    const limitOfCaps = perPayment < leftToday ? perPayment : leftToday;
    const stage = h("div", { class: "sheet-stage" });
    const done = () => h("button", { class: "btn", type: "button", onclick: close }, "Close");

    const problemFor = (baseUnits: string): string | null => {
      const asked = BigInt(baseUnits);
      if (asked > perPayment) return `Nothing was sent. ${usdc(baseUnits)} is above the per-payment cap of ${usdc(overview.caps.perPaymentBaseUnits)}. Change it in Settings if you mean it.`;
      if (asked > leftToday) return `Nothing was sent. Only ${usdc(leftToday.toString())} is left of today's cap of ${usdc(overview.caps.perDayBaseUnits)}.`;
      if (held !== null && asked > held) return `Nothing was sent. The agent wallet holds ${usdc(held.toString())}. Deposit more before paying ${usdc(baseUnits)}.`;
      return null;
    };

    const amountStep = () => {
      const amount = h("input", { id: "amount", name: "amount", inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.10", value: prefilled ?? undefined });
      const error = h("p", { class: "error", role: "alert" });
      const fix = h("div", { class: "actions" });
      const proceed = (text: string) => {
        const baseUnits = usdcToBaseUnits(text.trim());
        fix.replaceChildren();
        if (!baseUnits) return void (error.textContent = "Give the amount in USDC, for example 0.10. Nothing was sent.");
        const problem = problemFor(baseUnits);
        if (problem) {
          error.textContent = problem;
          if (held !== null && BigInt(baseUnits) > held && BigInt(baseUnits) <= limitOfCaps) fix.append(h("button", { class: "btn", type: "button", onclick: () => { close(); onDeposit(); } }, "Deposit from your wallet"));
          return;
        }
        confirmStep(baseUnits);
      };
      const quick = quickAmounts(limit).filter((value) => BigInt(usdcToBaseUnits(value) ?? "0") <= limit);
      const form = h("form", {},
        limit > 0n ? h("div", { class: "actions amounts", role: "group", "aria-label": "Quick amounts" }, ...quick.map((value) => h("button", { class: "btn", type: "button", onclick: () => proceed(value) }, `${value} USDC`))) : null,
        h("label", { for: "amount" }, "Or type an amount in USDC", amount),
        h("dl", { class: "facts caps-left" },
          h("div", {}, h("dt", {}, "Per-payment cap"), h("dd", {}, usdc(overview.caps.perPaymentBaseUnits))),
          h("div", {}, h("dt", {}, "Left of today's cap"), h("dd", {}, usdc(leftToday.toString()))),
          h("div", {}, h("dt", {}, "Agent wallet holds"), h("dd", {}, held === null ? "Not known right now" : usdc(held.toString())))),
        error, fix,
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Continue"), h("button", { class: "btn", type: "button", onclick: close }, "Cancel")));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        proceed(amount.value);
      });
      stage.replaceChildren(form);
      if (prefilled) proceed(prefilled);
      prefilled = null;
    };

    const confirmStep = (baseUnits: string) => {
      const amount = usdc(baseUnits);
      const pay = h("button", { class: "btn primary", type: "button" }, `Pay ${amount}`);
      pay.addEventListener("click", () => void send(baseUnits));
      stage.replaceChildren(
        h("p", { class: "money pay-headline" }, `Pay ${amount} to ${target.name}?`),
        h("p", {}, "It goes to this verified address, and nowhere else:"),
        signatureFigure(target.address),
        addressEl(target.address),
        h("p", { class: "note" }, `${networkWords(overview.network)}. Paid from the agent wallet. Nothing has been sent yet.`),
        h("div", { class: "actions" }, pay, h("button", { class: "btn", type: "button", onclick: amountStep }, "Change amount")));
    };

    const showing = (phase: PayPhase, baseUnits: string, ...extra: (HTMLElement | null)[]) => {
      stage.replaceChildren(stageList(phase, usdc(baseUnits), target.name), ...extra.filter((node) => node !== null));
    };

    const stopped = (baseUnits: string, words: string, receipt: string | null, canRetry: boolean) => {
      showing("checking", baseUnits);
      stage.replaceChildren(
        h("div", { class: "outcome refused", role: "alert" }, h("p", { class: "money" }, "Nothing was sent."), h("p", {}, words)),
        receipt ? h("p", { class: "links" }, h("a", { href: `/r/${receipt}` }, "See the refusal receipt")) : "",
        h("div", { class: "actions" }, canRetry ? h("button", { class: "btn primary", type: "button", onclick: amountStep }, "Change amount") : "", done()));
    };

    const send = async (baseUnits: string) => {
      showing("checking", baseUnits, h("p", { class: "note", role: "status" }, `Checking ${storedWhere(overview)}.`));
      const started = await api<{ paymentId: string }>("POST", "/api/app/payments", { payeeId: target.id, amount: formatUsdc(BigInt(baseUnits)), expectedAddress: target.address });
      if (!started.ok) {
        const refusal = started.error.body?.["refusal"] as Refusal | undefined;
        if (refusal) return stopped(baseUnits, refusalWords(refusal, overview, baseUnits), refusal.receipt, refusal.reason === "CAP_EXCEEDED");
        if (started.error.status === 0) return void stage.replaceChildren(h("div", { class: "outcome stated", role: "alert" }, h("p", { class: "money" }, "The outcome isn't known yet."), h("p", {}, started.error.message)), h("div", { class: "actions" }, h("a", { class: "btn", href: "/app/activity" }, "Open Activity"), done()));
        return stopped(baseUnits, started.error.message.replace(/^Nothing was sent\.\s*/, ""), null, false);
      }
      await follow(started.data.paymentId, baseUnits);
    };

    const follow = async (paymentId: string, baseUnits: string) => {
      const began = Date.now();
      for (;;) {
        const result = await api<PaymentStatus>("GET", `/api/app/payments/${paymentId}`);
        if (!result.ok) return void stage.replaceChildren(h("div", { class: "outcome stated", role: "alert" }, h("p", { class: "money" }, "The payment was started, and this screen lost track of it."), h("p", {}, `${result.error.message} It will not be sent twice; Activity shows where it stands.`)), h("div", { class: "actions" }, h("a", { class: "btn", href: "/app/activity" }, "Open Activity"), done()));
        const { payment, receipt } = result.data;
        const phase = payment.state as PayPhase;
        const waited = Date.now() - began;
        if (phase === "SETTLED") settledStep(baseUnits, payment.digest, receipt?.receipt ?? null, waited > RECEIPT_WAIT_MS);
        else if (phase === "FAILED") failedStep(baseUnits, payment, receipt?.receipt ?? null);
        else if (phase === "UNKNOWN") {
          showing(phase, baseUnits, h("div", { class: "outcome stated", role: "status" }, h("p", { class: "money" }, `Not sure yet whether ${usdc(baseUnits)} arrived.`), h("p", {}, `It will not be sent again. The agent keeps checking transaction ${payment.digest ?? "(no digest yet)"} and updates Activity.`)), h("div", { class: "actions" }, h("a", { class: "btn", href: "/app/activity" }, "Open Activity"), done()));
          if (waited > UNKNOWN_WAIT_MS) return;
        } else showing(phase, baseUnits, h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: close }, "Close. The payment continues.")));
        if (isFinished(phase) && (receipt || waited > RECEIPT_WAIT_MS)) return;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    };

    let celebrated = false;
    const settledStep = (baseUnits: string, digest: string | null, receipt: string | null, gaveUp: boolean) => {
      if (!celebrated) showMoment({ title: `Paid ${target.name}`, detail: `${usdc(baseUnits)} reached their verified address.`, address: target.address });
      celebrated = true;
      const receiptLine = receipt
        ? h("div", { class: "actions" }, h("a", { class: "btn primary", href: `/r/${receipt}` }, "View the receipt"), done())
        : h("div", {}, h("p", { class: "note", role: "status" }, gaveUp ? `The payment is final. The receipt hasn't been confirmed ${storedWhere(overview)} yet; it will appear in Activity.` : `The payment is final. Writing the receipt ${storedWhere(overview)} (about 20 seconds)…`), h("div", { class: "actions" }, done()));
      showing("SETTLED", baseUnits, h("p", { class: "money pay-headline", role: "status" }, `Sent ${usdc(baseUnits)} to ${target.name}.`), digest ? h("p", { class: "note digest" }, `Transaction ${digest}`) : null, receiptLine);
    };

    const failedStep = (baseUnits: string, payment: PaymentStatus["payment"], receipt: string | null) => {
      const lowOnFunds = payment.reason === "PAYMENT_NOT_BUILT";
      showing("FAILED", baseUnits,
        h("div", { class: "outcome refused", role: "alert" }, h("p", { class: "money" }, "No USDC moved."), h("p", {}, payment.reason && payment.reason in REASONS ? REASONS[payment.reason as ReasonCode].message : "The transfer didn't go through."),
          payment.detail ? h("details", {}, h("summary", {}, "What the chain said"), h("p", { class: "note digest" }, payment.detail)) : null, h("p", {}, lowOnFunds ? "Check that the agent wallet holds enough USDC and SUI for fees, then try again." : "You can try again; it won't be paid twice.")),
        receipt ? h("p", { class: "links" }, h("a", { href: `/r/${receipt}` }, "See the receipt")) : null,
        h("div", { class: "actions" }, lowOnFunds ? h("button", { class: "btn primary", type: "button", onclick: () => { close(); onDeposit(); } }, "Deposit from your wallet") : h("button", { class: "btn primary", type: "button", onclick: () => confirmStep(baseUnits) }, "Try again"), done()));
    };

    amountStep();
    body.append(stage);
  }, onClosed);
}
