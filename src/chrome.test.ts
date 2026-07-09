// Statusline sanitization (audit H1): a lower-trust model name / branch must not smuggle terminal
// escapes into the pinned status bar. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusText } from "./chrome";
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
