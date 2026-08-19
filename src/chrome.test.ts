// Statusline sanitization (audit H1): a lower-trust model name / branch must not smuggle terminal
// escapes into the pinned status bar. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusText, parseGitStatus, chromeGeometry, historyStep, historyAt } from "./chrome";
import { stripAnsi } from "./ui";
import { state } from "./state";

test("statusText strips terminal escapes from the model name (H1)", () => {
  const saved = state.model;
  try {
    // A malicious project settings.json could set this: ESC[2J (clear), OSC title, a BEL.
    state.model = "vendor/evil\x1b[2J\x1b]0;pwned\x07model";
    const s = statusText();
    // stripAnsi removes the intended SGR color codes; after that, NO escape/BEL may remain — if the
    // stripControl wrap were dropped, ESC[2J / the OSC / the BEL would survive here.
    assert.doesNotMatch(stripAnsi(s), /\x1b|\x07/);
  } finally {
    state.model = saved;
  }
});

test("parseGitStatus reads branch + dirty from ONE porcelain call (audit perf)", () => {
  assert.equal(parseGitStatus("## main\n"), "main");
  assert.equal(parseGitStatus("## main...origin/main\n M a.ts\n"), "main*");
  assert.equal(parseGitStatus("## HEAD (no branch)\n M a.ts\n"), "HEAD*");
  // The bug this fix also closes: with no commits yet, `rev-parse` exited non-zero and the old code
  // bailed — so a fresh repo showed no branch at all.
  assert.equal(parseGitStatus("## No commits yet on main\n"), "main");
  assert.equal(parseGitStatus(""), "", "unparseable → no branch, not a crash");
});

// --- reserved-row geometry --------------------------------------------------

test("chromeGeometry reserves four rows and leaves the rest to the conversation", () => {
  const g = chromeGeometry(24);
  assert.deepEqual(g, { status: 24, borderBottom: 23, input: 22, borderTop: 21, regionBottom: 20 });
  // an open dropdown grows the reserved band downward out of the scroll region
  assert.equal(chromeGeometry(24, 5).regionBottom, 15);
});

test("chromeGeometry treats an unreported terminal size as unknown, not as zero rows", () => {
  // A pty whose window size was never set reports 0. Read as a literal height it collapsed every row
  // onto row 1 — including the scroll region, so the whole conversation scrolled inside ONE thin row
  // with the chrome drawn on top of it. 0 must fall back to the default height instead.
  assert.deepEqual(chromeGeometry(0), chromeGeometry(24));
  assert.ok(chromeGeometry(0).regionBottom > 1, "a 0-row report must not squeeze the transcript into one row");
});

test("chromeGeometry never emits a row below 1, however small the terminal", () => {
  for (const r of [1, 2, 3, 4, 5]) {
    for (const v of Object.values(chromeGeometry(r, 3))) {
      assert.ok(Number.isInteger(v) && v >= 1, `row ${v} at ${r} rows`); // a negative row is an invalid escape
    }
  }
});

// --- history recall in the pinned input --------------------------------------

test("historyStep/historyAt walk the history and come back to a blank new line", () => {
  const h = ["one", "two", "three"];
  let i = h.length; // the new, unsubmitted line
  assert.equal(historyAt(h, i), "");
  i = historyStep(h.length, i, -1); assert.equal(historyAt(h, i), "three"); // ↑ = most recent first
  i = historyStep(h.length, i, -1); assert.equal(historyAt(h, i), "two");
  i = historyStep(h.length, i, -1); assert.equal(historyAt(h, i), "one");
  i = historyStep(h.length, i, -1); assert.equal(historyAt(h, i), "one");   // ↑ stops at the oldest
  i = historyStep(h.length, i, 1);  assert.equal(historyAt(h, i), "two");
  i = historyStep(h.length, i, 1);  assert.equal(historyAt(h, i), "three");
  i = historyStep(h.length, i, 1);  assert.equal(historyAt(h, i), "");      // ↓ off the end = blank again
  i = historyStep(h.length, i, 1);  assert.equal(historyAt(h, i), "");      // and stays there
});

test("historyStep on an empty history never moves off zero", () => {
  assert.equal(historyStep(0, 0, -1), 0);
  assert.equal(historyStep(0, 0, 1), 0);
  assert.equal(historyAt([], 0), "");
});
