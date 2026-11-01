import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_ALPHABET as SERVER_ALPHABET, CODE_LENGTH } from "../src/ownerAuth.ts";
import { CODE_ALPHABET, CODE_CHARS, formatCode } from "../client/codeInput.ts";

test("V01 the login box keeps only the code's alphabet, upper-cases it, stops at ten characters and puts the dash after the fifth", () => {
  assert.equal(CODE_ALPHABET, SERVER_ALPHABET);
  assert.equal(CODE_CHARS, CODE_LENGTH);
  assert.equal(formatCode("abcde", 5).value, "ABCDE");
  assert.equal(formatCode("abcdef", 6).value, "ABCDE-F");
  assert.equal(formatCode("a1b0c-d e!fghjkmnp", 18).value, "ABCDE-FGHJK");
  assert.equal(formatCode("ABCDE-FGH23", 11).value, "ABCDE-FGH23");
  assert.equal(formatCode("ABCDEFGH23", 10).value, "ABCDE-FGH23");
  assert.equal(formatCode("  abcde-fgh23\n", 14).value, "ABCDE-FGH23");
});

test("V01 the caret stays where the person was typing after the box reformats", () => {
  assert.deepEqual(formatCode("abcdef", 6), { value: "ABCDE-F", caret: 7 });
  assert.deepEqual(formatCode("ABCDE-FGH", 3), { value: "ABCDE-FGH", caret: 3 });
  assert.deepEqual(formatCode("ABXCDE-FGH", 3), { value: "ABXCD-EFGH", caret: 3 });
  assert.deepEqual(formatCode("ABCDE", 5), { value: "ABCDE", caret: 5 });
});
