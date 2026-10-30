import { test } from "node:test";
import assert from "node:assert/strict";
import { TEST_NAMESPACE_ROOT, isRealUseNamespace, payeeNamespace, refusalsNamespace } from "../src/payeeBook.ts";

test("D9 the real-use memory count includes only this owner's countersign namespaces, never test namespaces or other owners", () => {
  assert.equal(isRealUseNamespace("sam", payeeNamespace("sam", "rent")), true);
  assert.equal(isRealUseNamespace("sam", refusalsNamespace("sam")), true);
  assert.equal(isRealUseNamespace("sam", `${TEST_NAMESPACE_ROOT}2026-10-30:payee:rent`), false);
  assert.equal(isRealUseNamespace("sam", payeeNamespace("samantha", "rent")), false);
  assert.equal(isRealUseNamespace("sam", "countersign-spike-2026-10-30T20-46-45-854Z"), false);
});
