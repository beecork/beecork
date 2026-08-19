// The Shift+Tab mode rotation + labels. Locks that `plan` is in the cycle (audit M2 was a
// mis-documented rotation) and that every mode has a label. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextMode, modeLabel, type Mode, parseMode } from "./state";

test("nextMode cycles normal → auto → readonly → plan → normal", () => {
  const seen: Mode[] = ["normal"];
  let m: Mode = "normal";
  for (let i = 0; i < 4; i++) { m = nextMode(m); seen.push(m); }
  assert.deepEqual(seen, ["normal", "auto", "readonly", "plan", "normal"]);
});

test("modeLabel gives a human label for every mode", () => {
  assert.equal(modeLabel("normal"), "normal");
  assert.equal(modeLabel("auto"), "auto-approve");
  assert.equal(modeLabel("readonly"), "read-only");
  assert.equal(modeLabel("plan"), "plan");
});

test("BEECORK_MODE accepts the spelling modeLabel PRINTS (audit M3)", () => {
  // The statusline and prompt tag show "read-only"; the parser only accepted "readonly" and fell
  // back to "normal" — a fully writing, fully shelling agent — with no warning. The displayed
  // spelling being the rejected one is what made this a trap rather than a typo.
  assert.equal(modeLabel("readonly"), "read-only", "…which is the string a user would copy");
  assert.equal(parseMode("read-only"), "readonly");
  assert.equal(parseMode("auto-approve"), "auto");
  assert.equal(parseMode("readonly"), "readonly");
  assert.equal(parseMode(" READONLY "), "readonly", "trimmed and case-folded, like every other knob");
  assert.equal(parseMode(undefined), "normal");
});
