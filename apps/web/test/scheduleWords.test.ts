import { test } from "node:test";
import assert from "node:assert/strict";
import { nextUtcMidnight, ordinal, runsWords } from "../client/scheduleWords.ts";

const MONTHLY = { every: "month", day: 1, month: null } as const;
const NOW = new Date("2026-11-08T10:00:00Z");

test("S01 a schedule shows its UTC day and time with the viewer's own time next to it", () => {
  assert.equal(runsWords(MONTHLY, "2026-12-01T00:00:00.000Z", NOW, "Africa/Lagos"), "Runs on the 1st of every month at 00:00 UTC (01:00 your time)");
  assert.equal(runsWords(MONTHLY, "2026-12-01T00:00:00.000Z", NOW, "UTC"), "Runs on the 1st of every month at 00:00 UTC (00:00 your time)");
  assert.equal(runsWords(MONTHLY, "2026-12-01T00:00:00.000Z", NOW, "Asia/Kolkata"), "Runs on the 1st of every month at 00:00 UTC (05:30 your time)");
});

test("S01 west of UTC the local time falls on the day before, and it says so", () => {
  assert.equal(runsWords(MONTHLY, "2026-12-01T00:00:00.000Z", NOW, "America/New_York"), "Runs on the 1st of every month at 00:00 UTC (19:00 the day before your time)");
  assert.equal(runsWords({ every: "week", day: 1, month: null }, "2026-11-09T00:00:00.000Z", NOW, "America/Los_Angeles"), "Runs every Monday at 00:00 UTC (16:00 the day before your time)");
});

test("S01 the local time follows daylight saving through the next run's date", () => {
  assert.equal(runsWords(MONTHLY, "2026-07-01T00:00:00.000Z", NOW, "Europe/London"), "Runs on the 1st of every month at 00:00 UTC (01:00 your time)");
  assert.equal(runsWords(MONTHLY, "2026-12-01T00:00:00.000Z", NOW, "Europe/London"), "Runs on the 1st of every month at 00:00 UTC (00:00 your time)");
});

test("S02 every period reads in plain words", () => {
  assert.equal(runsWords({ every: "two_weeks", day: 3, month: null }, null, NOW, "UTC"), "Runs every other Wednesday at 00:00 UTC (00:00 your time)");
  assert.equal(runsWords({ every: "year", day: 5, month: 3 }, null, NOW, "Pacific/Auckland"), "Runs on 5 March every year at 00:00 UTC (13:00 your time)");
  assert.equal(nextUtcMidnight(NOW).toISOString(), "2026-11-09T00:00:00.000Z");
});

test("S02 days of the month read as 1st, 2nd, 3rd, 11th, 21st", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "28th"]);
});
