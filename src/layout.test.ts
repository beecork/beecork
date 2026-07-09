import { test } from "node:test";
import assert from "node:assert/strict";
import { rowColOf, inputLayout, moveVertIndex, windowStart } from "./layout";

test("rowColOf: newlines-before and column-after-last-newline", () => {
  assert.deepEqual(rowColOf(""), { row: 0, col: 0 });
  assert.deepEqual(rowColOf("abc"), { row: 0, col: 3 });
  assert.deepEqual(rowColOf("ab\ncd"), { row: 1, col: 2 });
  assert.deepEqual(rowColOf("ab\n"), { row: 1, col: 0 }); // cursor just after a newline → column 0
  assert.deepEqual(rowColOf("a\nb\nc"), { row: 2, col: 1 });
});

test("inputLayout: single line, no wrap — cursor col includes the prompt width", () => {
  const r = inputLayout("hello", "hel", 5, 80);
  assert.deepEqual(r, { totalPhys: 1, curPhysRow: 0, curPhysCol: 8 }); // 5 (prompt) + 3 (hel)
});

test("inputLayout: a logical line wider than cols wraps to multiple physical rows", () => {
  const text = "a".repeat(10);
  const r = inputLayout(text, text, 0, 8); // 10 cols of text in an 8-wide terminal
  assert.deepEqual(r, { totalPhys: 2, curPhysRow: 1, curPhysCol: 2 }); // wraps once; cursor at 10 % 8 = 2 on row 1
});

test("inputLayout: multi-line buffer — cursor row counts physical rows of earlier lines", () => {
  const r = inputLayout("ab\ncd\nef", "ab\nc", 0, 80);
  assert.deepEqual(r, { totalPhys: 3, curPhysRow: 1, curPhysCol: 1 });
});

test("inputLayout: empty buffer still occupies one physical row", () => {
  const r = inputLayout("", "", 5, 80);
  assert.deepEqual(r, { totalPhys: 1, curPhysRow: 0, curPhysCol: 5 });
});

test("inputLayout: wide (2-col) characters count as two display columns", () => {
  // "世" is East-Asian Wide → width 2. Two of them = 4 cols; +2 prompt = 6.
  const r = inputLayout("世世", "世世", 2, 80);
  assert.equal(r.curPhysCol, 6);
});

test("moveVertIndex: up/down keep the column and clamp at the ends", () => {
  const buf = "abc\ndefg\nhi"; // rows: abc | defg | hi
  assert.equal(moveVertIndex(buf, 5, -1), 1); // in "defg" col1 → up into "abc" col1
  assert.equal(moveVertIndex(buf, 5, 1), 10); // in "defg" col1 → down into "hi" col1
  assert.equal(moveVertIndex(buf, 1, -1), null); // already on the first row → nowhere to go
  assert.equal(moveVertIndex(buf, 10, 1), null); // already on the last row
});

test("moveVertIndex: column is clamped to the destination line length", () => {
  const buf = "abcdef\ngh"; // long line then a short one
  assert.equal(moveVertIndex(buf, 5, 1), 9); // col5 down into "gh" (len 2) → clamps to end (index 9)
});

test("windowStart: no horizontal scroll while the cursor fits in the window", () => {
  assert.equal(windowStart("short", 5, 80), 0);
  assert.equal(windowStart("abc", 0, 10), 0);
});

test("windowStart: scrolls right just enough to keep the cursor visible", () => {
  const text = "a".repeat(20);
  assert.equal(windowStart(text, 20, 10), 11); // keep the last <10 columns before the cursor visible
});
