// Tests for the line diff. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineDiff } from "./diff";

test("marks a changed line as remove + add, keeps context unchanged", () => {
  const d = lineDiff("a\nb\nc", "a\nB\nc");
  assert.equal(d, "  a\n- b\n+ B\n  c");
});

test("pure additions are all '+'", () => {
  assert.equal(lineDiff("", "x\ny"), "+ x\n+ y");
});

test("pure deletions are all '-'", () => {
  assert.equal(lineDiff("x\ny", ""), "- x\n- y");
});

test("identical text has no +/- lines", () => {
  const d = lineDiff("one\ntwo", "one\ntwo");
  assert.doesNotMatch(d, /^[+-] /m);
});
