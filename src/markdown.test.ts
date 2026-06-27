// Tests for the streaming markdown→ANSI renderer. Run with: npm test
// (node --test runs non-TTY, so ui.color is a no-op → assertions see plain text.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarkdownStream } from "./markdown";

function render(md: string): string {
  let out = "";
  const stream = createMarkdownStream((s) => { out += s; });
  for (const ch of md) stream.push(ch); // feed char-by-char to exercise line buffering
  stream.end();
  return out;
}

test("inline markdown syntax is removed", () => {
  const out = render("a **bold** and `code` and *italic*\n");
  assert.ok(out.includes("bold") && !out.includes("**"), "bold markers stripped");
  assert.ok(out.includes("code") && !out.includes("`"), "code backticks stripped");
});

test("pipe table drops the separator row and aligns columns", () => {
  const out = render("| A | B |\n|---|---|\n| x | yy |\n| zzzz | w |\n\nafter\n");
  assert.ok(!/---/.test(out), "the |---| separator row is dropped");
  const barCols = out.split("\n").filter((l) => l.includes("│")).map((l) => l.indexOf("│"));
  assert.ok(barCols.length >= 2 && barCols.every((c) => c === barCols[0]), "column bars aligned");
});

test("bullet lists render with a bullet glyph", () => {
  const out = render("- one\n- two\n");
  assert.ok(out.includes("• one") && out.includes("• two"));
});

test("fenced code content passes through", () => {
  const out = render("```js\nconst x = 1;\n```\n");
  assert.ok(out.includes("const x = 1;"));
});

test("an unterminated code fence still closes (no hang/asymmetry)", () => {
  const out = render("```js\nconst x = 1;\n"); // no closing fence
  assert.ok(out.includes("const x = 1;"));
});
