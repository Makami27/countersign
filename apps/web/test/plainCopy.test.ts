import { test } from "node:test";
import assert from "node:assert/strict";
import { plainCopy } from "../client/plainCopy.ts";

const A = `0x${"ab".repeat(32)}`;

test("C06 copying strips the group spaces and line breaks from an address, wherever it sits in the selection", () => {
  const grouped = `0x ${A.slice(2).match(/.{4}/g)?.join(" ")}`;
  assert.equal(plainCopy(grouped), A);
  assert.equal(plainCopy(grouped.replaceAll(" ", "\n")), A);
  assert.equal(plainCopy(`Pay to ${grouped} today`), `Pay to ${A} today`);
});

test("C06 a few copied groups join up, a link loses wrap breaks, and ordinary text is left alone", () => {
  assert.equal(plainCopy("abab abab abab"), "abababababab");
  assert.equal(plainCopy("https://countersign.example/sign/ab\ncd"), "https://countersign.example/sign/abcd");
  assert.equal(plainCopy("Pay the landlord on Friday"), "Pay the landlord on Friday");
  assert.equal(plainCopy("rent 12 due"), "rent 12 due");
});
