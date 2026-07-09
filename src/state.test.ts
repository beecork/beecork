// The Shift+Tab mode rotation + labels. Locks that `plan` is in the cycle (audit M2 was a
// mis-documented rotation) and that every mode has a label. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextMode, modeLabel, type Mode } from "./state";

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
