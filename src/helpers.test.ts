// Unit tests for the pure helpers. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, transcript, compactionStart } from "./context";
import { renderTodos, markLines } from "./ui";
import type { Message } from "./types";

test("estimateTokens ≈ characters / 4", () => {
  assert.equal(estimateTokens([{ role: "user", content: "abcd" }]), 1);
  assert.equal(estimateTokens([{ role: "user", content: "12345678" }]), 2);
});

test("transcript formats roles, tool calls, and tool results", () => {
  const t = transcript([
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "1", type: "function", function: { name: "read_file", arguments: "{}" } }],
    },
    { role: "tool", content: "file contents", tool_call_id: "1" },
  ]);
  assert.match(t, /user: hi/);
  assert.match(t, /assistant called: read_file/);
  assert.match(t, /\[tool result\] file contents/);
});

test("renderTodos shows the right checkboxes", () => {
  const out = renderTodos([
    { content: "a", status: "completed" },
    { content: "b", status: "in_progress" },
    { content: "c", status: "pending" },
  ]);
  assert.equal(out, "[x] a\n[~] b\n[ ] c");
  assert.equal(renderTodos([]), "(todo list empty)");
});

test("compactionStart snaps the cut back to a user message", () => {
  const msgs: Message[] = [
    { role: "system", content: "s" }, // 0
    { role: "user", content: "u1" }, // 1
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "1", type: "function", function: { name: "x", arguments: "{}" } }],
    }, // 2
    { role: "tool", content: "r", tool_call_id: "1" }, // 3
    { role: "assistant", content: "a" }, // 4
    { role: "user", content: "u2" }, // 5
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "2", type: "function", function: { name: "x", arguments: "{}" } }],
    }, // 6
    { role: "tool", content: "r", tool_call_id: "2" }, // 7
  ];
  assert.equal(compactionStart(msgs, 3), 5); // raw 5 is already a user message
  assert.equal(compactionStart(msgs, 2), 5); // raw 6 (tool_calls) → snap back to 5
  assert.equal(compactionStart(msgs, 1), 5); // raw 7 (tool) → snap back to 5
});

test("markLines is vertically symmetric (top mirrors bottom)", () => {
  const lines = markLines(24);
  assert.ok(lines.length > 2);
  const flip = (s: string) => s.replace(/[▀▄]/g, (c) => (c === "▀" ? "▄" : "▀"));
  for (let i = 0; i < lines.length; i++) {
    assert.equal(flip(lines[i]), lines[lines.length - 1 - i], `row ${i} should mirror row ${lines.length - 1 - i}`);
  }
});
