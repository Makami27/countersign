import { WEEKDAYS } from "@countersign/core";
import { clockTime, isoDay } from "./dayGroups.ts";

export type ScheduleTerms = { readonly every: "week" | "two_weeks" | "month" | "year"; readonly day: number; readonly month: number | null };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_MS = 24 * 3600 * 1000;

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function utcDays(terms: ScheduleTerms): string {
  const weekday = WEEKDAYS[terms.day - 1] ?? "";
  if (terms.every === "week") return `every ${weekday}`;
  if (terms.every === "two_weeks") return `every other ${weekday}`;
  if (terms.every === "month") return `on the ${ordinal(terms.day)} of every month`;
  return `on ${terms.day} ${MONTHS[(terms.month ?? 1) - 1] ?? ""} every year`;
}

export function yourTime(utcMidnight: Date, timeZone?: string): string {
  const local = isoDay(utcMidnight, timeZone);
  const utc = utcMidnight.toISOString().slice(0, 10);
  const shift = local < utc ? " the day before" : local > utc ? " the day after" : "";
  return `${clockTime(utcMidnight.toISOString(), timeZone)}${shift} your time`;
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS);
}

export function runsWords(terms: ScheduleTerms, nextDue: string | null, now: Date, timeZone?: string): string {
  const due = nextDue ? new Date(nextDue) : nextUtcMidnight(now);
  return `Runs ${utcDays(terms)} at 00:00 UTC (${yourTime(due, timeZone)})`;
}
