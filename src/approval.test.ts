// Tests for the pure approval-policy decision (the security-critical gate). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideApproval } from "./agent";
import type { ToolDef } from "./types";

const mk = (over: Partial<ToolDef>): ToolDef => ({ name: "t", description: "", parameters: {}, run: async () => "", ...over });
const read = mk({ name: "read_file" });
const write = mk({ name: "write_file", needsApproval: true });
const remember = mk({ name: "remember", mutates: true });
const guarded = mk({ name: "run_bash", needsApproval: true, guard: () => ({ needsApproval: true, reason: "risky" }) });

// Decide with sensible defaults; toolName always matches the tool.
const decide = (tool: ToolDef, over: { mode?: "normal" | "auto" | "readonly"; autoApprove?: boolean; approvedTools?: Set<string> } = {}) =>
  decideApproval(tool, {}, { mode: "normal", autoApprove: false, approvedTools: new Set<string>(), toolName: tool.name, ...over });

test("a read-only tool runs in every mode (incl. read-only)", () => {
  assert.deepEqual(decide(read), { action: "run" });
  assert.deepEqual(decide(read, { mode: "readonly" }), { action: "run" });
  assert.deepEqual(decide(read, { mode: "auto" }), { action: "run" });
});

test("read-only mode blocks mutating tools (needsApproval OR mutates)", () => {
  assert.equal(decide(write, { mode: "readonly" }).action, "deny");
  assert.equal(decide(remember, { mode: "readonly" }).action, "deny");
});

test("per-tool gate asks (cacheable) in normal mode; runs once approved", () => {
  assert.deepEqual(decide(write), { action: "ask", cacheable: true });
  assert.deepEqual(decide(write, { approvedTools: new Set(["write_file"]) }), { action: "run" });
});

test("auto mode and headless skip the per-tool gate", () => {
  assert.deepEqual(decide(write, { mode: "auto" }), { action: "run" });
  assert.deepEqual(decide(write, { autoApprove: true }), { action: "run" });
});

test("per-CALL hard guard asks (not cacheable), even in auto mode; headless denies", () => {
  assert.deepEqual(decide(guarded), { action: "ask", cacheable: false, reason: "risky" });
  assert.deepEqual(decide(guarded, { mode: "auto" }), { action: "ask", cacheable: false, reason: "risky" }); // hard guard still asks
  const h = decide(guarded, { autoApprove: true });
  assert.equal(h.action, "deny");
  assert.equal(h.action === "deny" && h.kind, "headless");
});

test("remember (mutates, not needsApproval) runs in normal mode", () => {
  assert.deepEqual(decide(remember), { action: "run" });
});
