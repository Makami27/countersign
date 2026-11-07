const LOCALE = "en-GB";
const UNKNOWN_DAY = "unknown";

export const UNKNOWN_DAY_HEADING = "Date not known";

export type DayGroup<T> = { readonly key: string; readonly heading: string; readonly items: readonly T[] };

type Part = "weekday" | "day" | "month" | "year";

function isoDay(at: Date, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayBefore(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) - 1)).toISOString().slice(0, 10);
}

function dateWords(at: Date, withYear: boolean, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", year: "numeric", ...(timeZone ? { timeZone } : {}) }).formatToParts(at);
  const part = (type: Part) => parts.find((p) => p.type === type)?.value ?? "";
  return [part("weekday"), part("day"), part("month"), withYear ? part("year") : ""].filter(Boolean).join(" ");
}

function headingFor(day: string, at: Date, now: Date, timeZone: string | undefined): string {
  const today = isoDay(now, timeZone);
  if (day === today) return "Today";
  if (day === dayBefore(today)) return "Yesterday";
  return dateWords(at, day.slice(0, 4) !== today.slice(0, 4), timeZone);
}

export function groupByDay<T>(items: readonly T[], atOf: (item: T) => string, now: Date, timeZone?: string): readonly DayGroup<T>[] {
  const days = new Map<string, { at: Date; items: { item: T; ms: number }[] }>();
  for (const item of items) {
    const at = new Date(atOf(item));
    const ms = at.getTime();
    const key = Number.isNaN(ms) ? UNKNOWN_DAY : isoDay(at, timeZone);
    const day = days.get(key) ?? { at, items: [] };
    day.items.push({ item, ms });
    days.set(key, day);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a === UNKNOWN_DAY ? 1 : b === UNKNOWN_DAY ? -1 : b.localeCompare(a)))
    .map(([key, day]) => ({
      key,
      heading: key === UNKNOWN_DAY ? UNKNOWN_DAY_HEADING : headingFor(key, day.at, now, timeZone),
      items: [...day.items].sort((a, b) => b.ms - a.ms).map((entry) => entry.item),
    }));
}

export function clockTime(iso: string, timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timeZone ? { timeZone } : {}) }).format(at);
}
