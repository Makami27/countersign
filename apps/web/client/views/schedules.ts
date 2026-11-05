import { WEEKDAYS, usdcToBaseUnits } from "@countersign/core";
import { withApprovals } from "../approvals.ts";
import { h, liveRegion, listen, when } from "../dom.ts";
import type { ScheduleItem } from "../types.ts";
import { showMoment } from "../moment.ts";

const LAST_DAY = 28;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function scheduleRow(item: ScheduleItem, network: "mainnet" | "testnet", status: HTMLElement, onChanged: () => void): HTMLElement {
  const remove = h("button", { class: "btn", type: "button" }, "Delete");
  listen(remove, "click", async () => {
    const result = await withApprovals("DELETE", `/api/app/schedules/${encodeURIComponent(item.schedule.scheduleId)}`, {}, network, status);
    status.textContent = result.ok ? "Deleted. It won't run again." : result.error.message;
    if (result.ok) onChanged();
  }, status);
  return h("li", {}, h("span", { class: "v" }, "Scheduled"), h("span", { class: "what" }, h("span", {}, item.says), h("span", { class: "meta" }, item.nextDue ? `Next run ${when(item.nextDue)}.` : "")), remove);
}

export function schedulesPanel(payeeId: string, items: readonly ScheduleItem[], network: "mainnet" | "testnet", onChanged: () => void): HTMLElement {
  const status = liveRegion();
  const rows = items.filter((item) => item.schedule.payeeId === payeeId).map((item) => scheduleRow(item, network, status, onChanged));
  const amount = h("input", { id: "schedule-amount", inputmode: "decimal", autocomplete: "off", placeholder: "0.10" });
  const every = h("select", { id: "schedule-every" }, h("option", { value: "week" }, "Every week"), h("option", { value: "two_weeks" }, "Every two weeks"), h("option", { value: "month", selected: true }, "Every month"), h("option", { value: "year" }, "Every year"));
  const weekday = h("select", { id: "schedule-weekday" }, ...WEEKDAYS.map((name, i) => h("option", { value: String(i + 1) }, name)));
  const day = h("select", { id: "schedule-day" }, ...Array.from({ length: LAST_DAY }, (_, i) => h("option", { value: String(i + 1) }, String(i + 1))));
  const month = h("select", { id: "schedule-month" }, ...MONTHS.map((name, i) => h("option", { value: String(i + 1) }, name)));
  const weekdayField = h("label", { for: "schedule-weekday" }, "Day of the week (UTC)", weekday);
  const dayField = h("label", { for: "schedule-day" }, "Day of the month (1 to 28, UTC)", day);
  const monthField = h("label", { for: "schedule-month" }, "Month", month);
  const showFields = () => {
    const weekly = every.value === "week" || every.value === "two_weeks";
    weekdayField.hidden = !weekly;
    dayField.hidden = weekly;
    monthField.hidden = every.value !== "year";
  };
  every.addEventListener("change", showFields);
  showFields();
  const form = h("form", {}, h("label", { for: "schedule-amount" }, "Amount in USDC", amount), h("label", { for: "schedule-every" }, "How often", every), weekdayField, monthField, dayField, status,
    h("div", { class: "actions" }, h("button", { class: "btn", type: "submit" }, "Schedule payment")));
  listen(form, "submit", async (event) => {
    event.preventDefault();
    if (!usdcToBaseUnits(amount.value.trim())) return void (status.textContent = "Give the amount in USDC, for example 0.10. Nothing was changed.");
    const weekly = every.value === "week" || every.value === "two_weeks";
    const body = { payeeId, amount: amount.value.trim(), every: every.value, day: Number(weekly ? weekday.value : day.value), month: every.value === "year" ? Number(month.value) : null };
    const result = await withApprovals("POST", "/api/app/schedules", body, network, status);
    status.textContent = result.ok ? "Scheduled. Each run re-checks the verified address, your caps and Walrus Memory." : result.error.message;
    if (result.ok) {
      showMoment({ title: "Payment scheduled", detail: "Each run re-checks the verified address, your caps and Walrus Memory." });
      onChanged();
    }
  }, status);
  return h("section", { "aria-labelledby": "schedules-title" }, h("h3", { id: "schedules-title" }, "Scheduled payments"),
    h("p", { class: "hint" }, "Each runs once per period on the day you pick. Creating, changing or deleting one needs your wallet's signature."),
    rows.length ? h("ol", { class: "rows" }, ...rows) : h("p", { class: "empty" }, "No scheduled payments."), form);
}
