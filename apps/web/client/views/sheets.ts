import { usdcToBaseUnits } from "@countersign/core";
import { api } from "../api.ts";
import { withApprovals } from "../approvals.ts";
import { addressEl, h, liveRegion, networkWords, usdc, listen } from "../dom.ts";
import type { Overview, PayeeDetail, PaymentStatus, Refusal } from "../types.ts";

const POLL_MS = 1_500;
const RECEIPT_WAIT_MS = 90_000;

export function openSheet(title: string, build: (close: () => void, body: HTMLElement) => void, onClosed: () => void): void {
  const body = h("div", { class: "narrow", style: undefined });
  const dialog = h("dialog", { "aria-labelledby": "sheet-title" }, h("h2", { id: "sheet-title" }, title), body);
  const close = () => dialog.close();
  dialog.addEventListener("close", () => {
    dialog.remove();
    onClosed();
  });
  document.querySelector(".app")?.append(dialog);
  build(close, body);
  dialog.showModal();
}

function refusalText(refusal: Refusal, overview: Overview, amount: string): string {
  if (refusal.reason !== "CAP_EXCEEDED") return [refusal.message, refusal.nextAction].filter(Boolean).join(" ");
  const perPayment = BigInt(overview.caps.perPaymentBaseUnits);
  return BigInt(amount) > perPayment
    ? `Nothing was sent. ${usdc(amount)} is above the per-payment cap of ${usdc(overview.caps.perPaymentBaseUnits)}. Change it in Settings if you mean it.`
    : `Nothing was sent. This would pass today's cap of ${usdc(overview.caps.perDayBaseUnits)}; ${usdc(overview.caps.usedTodayBaseUnits)} is already used today.`;
}

function storedWhere(overview: Overview): string {
  return overview.memory.relayer.startsWith("sandbox") ? "in sandbox memory (not Walrus Memory)" : "on Walrus Memory";
}

async function follow(paymentId: string, status: HTMLElement, overview: Overview): Promise<void> {
  const started = Date.now();
  for (;;) {
    const result = await api<PaymentStatus>("GET", `/api/app/payments/${paymentId}`);
    if (!result.ok) return void (status.textContent = result.error.message);
    const { payment, receipt } = result.data;
    const amount = usdc(payment.amountBaseUnits);
    if (payment.state === "SETTLED") status.textContent = receipt ? `Sent ${amount} on ${networkWords(overview.network)}. Transaction ${payment.digest}. Receipt ${receipt.receipt} is stored ${storedWhere(overview)}.` : `Sent ${amount}. Transaction ${payment.digest}. Writing the receipt ${storedWhere(overview)} (about 20 seconds)…`;
    else if (payment.state === "FAILED") status.textContent = receipt ? `No USDC moved. ${payment.detail ?? ""} Receipt ${receipt.receipt}.` : `No USDC moved. ${payment.detail ?? ""} Writing the receipt…`;
    else if (payment.state === "UNKNOWN") return void (status.textContent = `Not sure yet whether ${amount} arrived. It will not be sent again; the agent checks the transaction ${payment.digest ?? ""} and updates Activity.`);
    else status.textContent = `Sending ${amount}… nothing is confirmed yet.`;
    if ((payment.state === "SETTLED" || payment.state === "FAILED") && (receipt || Date.now() - started > RECEIPT_WAIT_MS)) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export function paySheet(detail: PayeeDetail, overview: Overview, onClosed: () => void): void {
  const payTo = detail.payTo;
  if (!payTo) return;
  openSheet(`Pay ${detail.summary.name}`, (close, body) => {
    const amount = h("input", { id: "amount", name: "amount", inputmode: "decimal", autocomplete: "off", required: true, placeholder: "0.10" });
    const error = h("p", { class: "error", role: "alert" });
    const step = h("div", {});
    const form = h("form", {}, h("label", { for: "amount" }, "Amount in USDC", h("span", { class: "hint" }, `Up to ${usdc(overview.caps.perPaymentBaseUnits)} per payment; ${usdc((BigInt(overview.caps.perDayBaseUnits) - BigInt(overview.caps.usedTodayBaseUnits)).toString())} left today.`), amount), error,
      h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Continue"), h("button", { class: "btn", type: "button", onclick: close }, "Cancel")));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const baseUnits = usdcToBaseUnits(amount.value.trim());
      if (!baseUnits) return void (error.textContent = "Give the amount in USDC, for example 0.10. Nothing was sent.");
      form.remove();
      const status = liveRegion();
      const confirm = h("button", { class: "btn primary", type: "button" }, `Pay ${usdc(baseUnits)}`);
      const notYet = h("p", { class: "money" }, "Nothing has been sent yet.");
      step.append(h("p", {}, `Pay ${usdc(baseUnits)} to ${detail.summary.name} on ${networkWords(overview.network)}. It goes to this verified address and nowhere else:`), addressEl(payTo.address), notYet, status,
        h("div", { class: "actions" }, confirm, h("button", { class: "btn", type: "button", onclick: close }, "Close")));
      listen(confirm, "click", async () => {
        confirm.remove();
        notYet.remove();
        status.textContent = `Checking the payee record ${storedWhere(overview)}… nothing has been sent yet.`;
        const result = await api<{ paymentId: string }>("POST", "/api/app/payments", { payeeId: detail.summary.id, amount: amount.value.trim(), expectedAddress: payTo.address });
        if (!result.ok) {
          const refusal = result.error.body?.["refusal"] as Refusal | undefined;
          return void (status.textContent = refusal ? refusalText(refusal, overview, baseUnits) : result.error.message);
        }
        await follow(result.data.paymentId, status, overview);
      }, status);
    });
    body.append(form, step);
  }, onClosed);
}

export function addPayeeSheet(network: "mainnet" | "testnet", onClosed: () => void): void {
  openSheet("Add a payee", (close, body) => {
    const name = h("input", { id: "payee-name", name: "name", required: true, maxlength: "60", autocomplete: "off", placeholder: "Flat 4B rent" });
    const address = h("input", { id: "payee-address", name: "address", required: true, class: "mono", autocomplete: "off", spellcheck: "false", placeholder: "0x…" });
    const status = liveRegion();
    const submit = h("button", { class: "btn primary", type: "submit" }, "Add and get a signing link");
    const form = h("form", {}, h("label", { for: "payee-name" }, "Name", name), h("label", { for: "payee-address" }, "Their Sui address", h("span", { class: "hint" }, "Copy it from the payee. It can't be paid until their wallet signs."), address), status,
      h("div", { class: "actions" }, submit, h("button", { class: "btn", type: "button", onclick: close }, "Cancel")));
    listen(form, "submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = "Asking your owner wallet to approve this payee…";
      const result = await withApprovals<{ signUrl: string | null }>("POST", "/api/app/payees", { name: name.value, address: address.value.trim() }, network, status);
      submit.disabled = false;
      if (!result.ok) {
        const refusal = result.error.body?.["refusal"] as Refusal | undefined;
        return void (status.textContent = refusal ? [refusal.message, refusal.nextAction].filter(Boolean).join(" ") : result.error.message);
      }
      form.replaceChildren(h("p", { class: "money" }, "Added. Nothing can be paid to it yet."), h("p", {}, "Send this link to the payee. Their wallet signs once to prove the address is theirs; then it becomes payable."), h("p", {}, h("span", { class: "addr" }, result.data.signUrl ?? "—")),
        h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", onclick: () => void navigator.clipboard.writeText(result.data.signUrl ?? "") }, "Copy link"), h("button", { class: "btn", type: "button", onclick: close }, "Done")));
    }, status);
    body.append(form);
  }, onClosed);
}
