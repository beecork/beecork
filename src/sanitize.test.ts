// Regression tests for stripControl — the terminal-injection sanitizer every model/repo/network
// controlled string passes through before being printed. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripControl } from "./ui";

test("stripControl removes ESC / CR / C0 / C1 / DEL, keeps TAB and NEWLINE", () => {
  // The ESC byte is stripped, which DEFANGS the sequence: without a leading ESC, "[2K" is inert
  // text and can't move the cursor / clear the screen. The security property is "no ESC/CR remains".
  const cleaned = stripControl("\x1b[2K\rspoof");
  assert.equal(cleaned, "[2Kspoof");
  assert.ok(!/[\x1b\r]/.test(cleaned), "no ESC or CR survives");
  assert.equal(stripControl("a\x1b]0;title\x07b"), "a]0;titleb"); // OSC ESC + BEL stripped, brackets kept
  assert.equal(stripControl("x\x07\x08\x00y"), "xy"); // BEL / BS / NUL (C0) stripped
  assert.equal(stripControl("hi\x7fthere"), "hithere"); // DEL
  assert.equal(stripControl("a\x9bb\x85c"), "abc"); // C1 controls
  assert.equal(stripControl("keep\ttab\nnewline"), "keep\ttab\nnewline"); // TAB + NEWLINE preserved
});

test("stripControl preserves printable and astral characters", () => {
  assert.equal(stripControl("hello world 123 !@#"), "hello world 123 !@#");
  assert.equal(stripControl("café 你好 🐝"), "café 你好 🐝");
});
