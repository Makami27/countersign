import { test } from "node:test";
import assert from "node:assert/strict";
import { UNKNOWN_DAY_HEADING, clockTime, groupByDay } from "../client/dayGroups.ts";

type Entry = { readonly id: string; readonly at: string };

function entry(id: string, at: string): Entry {
  return { id, at };
}

function groups(items: readonly Entry[], now: string, timeZone: string) {
  return groupByDay(items, (e) => e.at, new Date(now), timeZone).map((g) => [g.heading, g.items.map((e) => e.id)]);
}

test("T01 entries group under Today, Yesterday, then the date, newest day and newest entry first", () => {
  const items = [entry("older", "2026-11-05T09:00:00Z"), entry("today-early", "2026-11-07T08:00:00Z"), entry("yesterday", "2026-11-06T12:00:00Z"), entry("today-late", "2026-11-07T16:00:00Z")];
  assert.deepEqual(groups(items, "2026-11-07T18:00:00Z", "UTC"), [
    ["Today", ["today-late", "today-early"]],
    ["Yesterday", ["yesterday"]],
    ["Thu 5 Nov", ["older"]],
  ]);
});

test("T01 days with nothing on them don't appear", () => {
  const items = [entry("a", "2026-11-07T08:00:00Z"), entry("b", "2026-11-01T08:00:00Z")];
  assert.deepEqual(groups(items, "2026-11-07T18:00:00Z", "UTC").map(([heading]) => heading), ["Today", "Sun 1 Nov"]);
  assert.deepEqual(groups([], "2026-11-07T18:00:00Z", "UTC"), []);
});

test("T02 one second either side of midnight falls on different days", () => {
  const items = [entry("before", "2026-11-06T23:59:59Z"), entry("after", "2026-11-07T00:00:00Z")];
  assert.deepEqual(groups(items, "2026-11-07T00:00:01Z", "UTC"), [["Today", ["after"]], ["Yesterday", ["before"]]]);
});

test("T02 what was Today becomes Yesterday as soon as midnight passes", () => {
  const items = [entry("a", "2026-11-06T23:59:59Z")];
  assert.deepEqual(groups(items, "2026-11-06T23:59:59Z", "UTC"), [["Today", ["a"]]]);
  assert.deepEqual(groups(items, "2026-11-07T00:00:00Z", "UTC"), [["Yesterday", ["a"]]]);
  assert.deepEqual(groups(items, "2026-11-08T00:00:00Z", "UTC"), [["Fri 6 Nov", ["a"]]]);
});

test("T03 the same two moments group by the viewer's own time zone", () => {
  const items = [entry("a", "2026-11-05T22:45:00Z"), entry("b", "2026-11-05T23:15:00Z")];
  const now = "2026-11-05T23:30:00Z";
  assert.deepEqual(groups(items, now, "UTC"), [["Today", ["b", "a"]]]);
  assert.deepEqual(groups(items, now, "Africa/Lagos"), [["Today", ["b"]], ["Yesterday", ["a"]]]);
  assert.deepEqual(groups(items, now, "Pacific/Auckland"), [["Today", ["b", "a"]]]);
  assert.deepEqual(groups(items, now, "America/Los_Angeles"), [["Today", ["b", "a"]]]);
});

test("T03 a clock-change night still finds Yesterday", () => {
  const items = [entry("a", "2026-03-08T06:00:00Z")];
  assert.deepEqual(groups(items, "2026-03-09T04:30:00Z", "America/New_York"), [["Yesterday", ["a"]]]);
  assert.deepEqual(groups([entry("b", "2026-11-01T05:30:00Z")], "2026-11-02T05:30:00Z", "America/New_York"), [["Yesterday", ["b"]]]);
});

test("T04 across new year, Yesterday still works and only other years show the year", () => {
  assert.deepEqual(groups([entry("a", "2026-12-31T12:00:00Z")], "2027-01-01T09:00:00Z", "UTC"), [["Yesterday", ["a"]]]);
  assert.deepEqual(groups([entry("b", "2026-12-30T12:00:00Z")], "2027-01-01T09:00:00Z", "UTC"), [["Wed 30 Dec 2026", ["b"]]]);
  assert.deepEqual(groups([entry("c", "2027-01-01T01:00:00Z")], "2027-01-03T09:00:00Z", "UTC"), [["Fri 1 Jan", ["c"]]]);
});

test("T04 the year comes from the viewer's time zone, not UTC", () => {
  const items = [entry("a", "2027-01-01T02:00:00Z")];
  assert.deepEqual(groups(items, "2027-01-03T09:00:00Z", "America/Los_Angeles"), [["Thu 31 Dec 2026", ["a"]]]);
});

test("T05 times show as 24-hour clock in the viewer's time zone", () => {
  assert.equal(clockTime("2026-11-05T14:32:00Z", "UTC"), "14:32");
  assert.equal(clockTime("2026-11-05T00:05:00Z", "UTC"), "00:05");
  assert.equal(clockTime("2026-11-05T14:32:00Z", "Africa/Lagos"), "15:32");
  assert.equal(clockTime("2026-11-05T23:30:00Z", "Asia/Kolkata"), "05:00");
  assert.equal(clockTime("not a time"), "—");
});

test("T06 an entry with an unreadable time goes last under its own heading, never under a made-up date", () => {
  const items = [entry("bad", "not a time"), entry("good", "2026-11-07T08:00:00Z")];
  assert.deepEqual(groups(items, "2026-11-07T18:00:00Z", "UTC"), [["Today", ["good"]], [UNKNOWN_DAY_HEADING, ["bad"]]]);
});
