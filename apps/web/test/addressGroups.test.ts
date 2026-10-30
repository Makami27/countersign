import { test } from "node:test";
import assert from "node:assert/strict";
import { differingGroupCount, groupAddress, spokenAddress } from "../client/addressGroups.ts";

const REAL = "0x91ac3f0e7b2d4c18a9e05f6b3d71c2e48f0a9b6d5c3e2f1a0b9c8d7e6f5a77e0";
const FAKE = "0x91ac08d2e6f15a3b9c0e7d4f2b81c6a9e0f35d72b1c84a6e9f03d2b75c1877e0";

test("V05 a full address is set in sixteen groups of four after 0x, with nothing dropped", () => {
  const grouped = groupAddress(REAL.toUpperCase().replace("0X", "0x"));
  assert.equal(grouped.groups.length, 17);
  assert.equal(grouped.groups.map((g) => g.text).join(""), REAL);
  assert.ok(grouped.groups.slice(1).every((g) => g.text.length === 4));
});

test("V10 comparison marks the copied groups as same and every differing group as diff", () => {
  const grouped = groupAddress(FAKE, { against: REAL });
  const marks = grouped.groups.slice(1).map((g) => g.mark);
  assert.equal(marks[0], "same");
  assert.equal(marks.at(-1), "same");
  assert.equal(differingGroupCount(grouped), 14);
  assert.equal(grouped.groups[0]?.mark, null);
});

test("V05 lists may shorten an address to its first and last group, and say so", () => {
  const grouped = groupAddress(REAL, { short: true });
  assert.equal(grouped.short, true);
  assert.deepEqual(grouped.groups.map((g) => g.text), ["0x91ac", "…", "77e0"]);
  assert.equal(grouped.full, REAL);
});

test("Q03 screen readers hear the whole address character by character, even when it is shown short", () => {
  assert.equal(groupAddress(REAL, { short: true }).label, spokenAddress(REAL));
  assert.match(spokenAddress("0xab"), /^Address 0 x a b$/);
});

test("text that is not a hex address is shown as written, never grouped or marked", () => {
  const grouped = groupAddress("not-an-address", { against: REAL });
  assert.deepEqual(grouped.groups, [{ text: "not-an-address", mark: null }]);
});
