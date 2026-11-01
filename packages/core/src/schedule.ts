import { canonicalJson, openRecord } from "./records.ts";
import type { RecordSigner, StoredText } from "./ports.ts";
import type { ScheduleRecord, ScheduleTerms } from "./types.ts";

export const LAST_SCHEDULE_DAY = 28;
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export type DuePeriod = { readonly period: string; readonly dueAt: Date };

export function schedulesNamespace(ownerId: string): string {
  return `countersign:${ownerId}:schedules`;
}

export function scheduleRunKey(scheduleId: string, period: string): string {
  return `schedule:${scheduleId}:${period}`;
}

export function scheduledPaymentId(scheduleId: string, period: string): string {
  return `pay_${scheduleRunKey(scheduleId, period).replaceAll(":", "_")}`;
}

const DAY_MS = 24 * 3600 * 1000;
const PAIR_EPOCH_MONDAY = Date.UTC(1970, 0, 5);

function monthNumber(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function mondayOf(date: Date): number {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return midnight - ((date.getUTCDay() + 6) % 7) * DAY_MS;
}

export function isoWeekLabel(date: Date): string {
  const thursday = new Date(mondayOf(date) + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function weekPeriods(terms: ScheduleTerms, since: Date, now: Date): DuePeriod[] {
  const pairs = terms.every === "two_weeks";
  const periods: DuePeriod[] = [];
  for (let monday = mondayOf(since); monday <= now.getTime(); monday += 7 * DAY_MS) {
    const weeksSinceEpoch = Math.round((monday - PAIR_EPOCH_MONDAY) / (7 * DAY_MS));
    if (pairs && weeksSinceEpoch % 2 !== 0) continue;
    const dueAt = new Date(monday + (terms.day - 1) * DAY_MS);
    if (dueAt >= since && dueAt <= now) periods.push({ period: pairs ? `${new Date(monday).toISOString().slice(0, 10)}-2w` : isoWeekLabel(dueAt), dueAt });
  }
  return periods;
}

export function duePeriods(terms: ScheduleTerms, since: Date, now: Date): DuePeriod[] {
  if (terms.every === "week" || terms.every === "two_weeks") return weekPeriods(terms, since, now);
  const yearly = terms.every === "year";
  const periods: DuePeriod[] = [];
  for (let n = monthNumber(since); n <= monthNumber(now); n += 1) {
    const year = Math.floor(n / 12);
    const month = n % 12;
    if (yearly && month !== (terms.month ?? 1) - 1) continue;
    const dueAt = new Date(Date.UTC(year, month, terms.day));
    if (dueAt >= since && dueAt <= now) periods.push({ period: yearly ? String(year) : `${year}-${String(month + 1).padStart(2, "0")}`, dueAt });
  }
  return periods;
}

export function scheduleHeads(signer: RecordSigner, ownerId: string, records: readonly StoredText[]): Map<string, ScheduleRecord> {
  const byId = new Map<string, ScheduleRecord[]>();
  for (const { text } of records) {
    const opened = openRecord(signer, text);
    if (!opened.ok || opened.record.type !== "schedule" || opened.record.ownerId !== ownerId) continue;
    byId.set(opened.record.scheduleId, [...(byId.get(opened.record.scheduleId) ?? []), opened.record]);
  }
  const heads = new Map<string, ScheduleRecord>();
  for (const [id, versions] of byId) {
    const top = Math.max(...versions.map((v) => v.version));
    const atTop = new Set(versions.filter((v) => v.version === top).map(canonicalJson));
    const head = versions.find((v) => v.version === top);
    if (head && atTop.size === 1) heads.set(id, head);
  }
  return heads;
}
