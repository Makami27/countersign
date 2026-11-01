import { test } from "node:test";
import assert from "node:assert/strict";
import { duePeriods, isoWeekLabel } from "../src/schedule.ts";
import type { ScheduleTerms } from "../src/types.ts";

function terms(every: ScheduleTerms["every"], day: number, month: number | null = null): ScheduleTerms {
  return { payeeId: "rent", amountBaseUnits: "1000000", every, day, month };
}

function periods(t: ScheduleTerms, since: string, now: string): string[][] {
  return duePeriods(t, new Date(since), new Date(now)).map((p) => [p.period, p.dueAt.toISOString().slice(0, 10)]);
}

test("V21 weekly periods are ISO weeks: a Sunday in early January belongs to the last week of the old year, and 2026 has a week 53", () => {
  assert.equal(isoWeekLabel(new Date("2026-12-28T00:00:00Z")), "2026-W53");
  assert.equal(isoWeekLabel(new Date("2027-01-03T23:59:59Z")), "2026-W53");
  assert.equal(isoWeekLabel(new Date("2027-01-04T00:00:00Z")), "2027-W01");
  assert.equal(isoWeekLabel(new Date("2026-01-01T00:00:00Z")), "2026-W01");
  assert.deepEqual(periods(terms("week", 7), "2026-12-20T10:00:00Z", "2027-01-12T00:00:00Z"), [["2026-W52", "2026-12-27"], ["2026-W53", "2027-01-03"], ["2027-W01", "2027-01-10"]]);
});

test("V21 a weekly run is due on its weekday at 00:00 UTC, not before, and not on a day before the schedule existed", () => {
  assert.deepEqual(periods(terms("week", 1), "2026-11-02T00:00:01Z", "2026-11-09T00:00:00Z"), [["2026-W46", "2026-11-09"]]);
  assert.deepEqual(periods(terms("week", 1), "2026-11-02T00:00:01Z", "2026-11-08T23:59:59Z"), []);
});

test("V21 two-week periods are fixed pairs of weeks, so editing a schedule never creates a second run in the same pair", () => {
  const every = periods(terms("two_weeks", 1), "2026-11-01T10:00:00Z", "2026-12-31T00:00:00Z");
  assert.ok(every.length >= 4);
  for (let i = 1; i < every.length; i += 1) assert.equal(Date.parse(every[i]?.[1] ?? "") - Date.parse(every[i - 1]?.[1] ?? ""), 14 * 24 * 3600 * 1000);
  const first = every[0]?.[0] ?? "";
  const afterEdit = periods(terms("two_weeks", 3), "2026-11-01T10:00:00Z", "2026-12-31T00:00:00Z");
  assert.deepEqual(afterEdit.map((p) => p[0]), every.map((p) => p[0]));
  assert.match(first, /^\d{4}-\d{2}-\d{2}-2w$/);
});

test("V21 monthly and yearly keys are unchanged: YYYY-MM and YYYY", () => {
  assert.deepEqual(periods(terms("month", 5), "2026-10-30T10:00:00Z", "2026-12-06T00:00:00Z"), [["2026-11", "2026-11-05"], ["2026-12", "2026-12-05"]]);
  assert.deepEqual(periods(terms("year", 2, 3), "2026-10-30T10:00:00Z", "2028-03-03T00:00:00Z"), [["2027", "2027-03-02"], ["2028", "2028-03-02"]]);
});
