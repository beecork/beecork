// Tests for the pure approval-policy decision (the security-critical gate). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideApproval, askUserMessage } from "./agent";
import type { ToolDef } from "./types";

const mk = (over: Partial<ToolDef>): ToolDef => ({ name: "t", description: "", parameters: {}, run: async () => "", ...over });
const read = mk({ name: "read_file" });
const write = mk({ name: "write_file", needsApproval: true });
const remember = mk({ name: "remember", mutates: true });
const guarded = mk({ name: "run_bash", needsApproval: true, guard: () => ({ needsApproval: true, reason: "risky" }) });
const bash = mk({ name: "run_bash", needsApproval: true, alwaysAsk: true }); // a non-risky shell call
const bashSafe = mk({ name: "run_bash", needsApproval: true, alwaysAsk: true, guard: () => ({}), safeAutoApprove: () => true });
const bashUnsafe = mk({ name: "run_bash", needsApproval: true, alwaysAsk: true, guard: () => ({}), safeAutoApprove: () => false });

// Decide with sensible defaults; toolName always matches the tool.
const decide = (tool: ToolDef, over: { mode?: "normal" | "auto" | "readonly" | "plan"; autoApprove?: boolean; approvedTools?: Set<string>; approvedGuardKeys?: Set<string>; dangerouslySkip?: boolean } = {}) =>
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

test("out-of-root guard: 'always' sticks per-path (session) — not blanket, not persisted", () => {
  // A guard with a cacheKey (an out-of-root PATH) is cacheable; secret/risky (no key) is not.
  const outOfRoot = mk({ name: "edit_file", needsApproval: true, guard: () => ({ needsApproval: true, reason: "outside root", cacheKey: "path:/Users/x/Desktop/poem.txt" }) });
  // First time: asks, and it's cacheable (offers a sticky "always").
  assert.deepEqual(decide(outOfRoot), { action: "ask", cacheable: true, reason: "outside root", guardKey: "path:/Users/x/Desktop/poem.txt" });
  // After the user answered "always" for THAT key → runs without asking again.
  assert.deepEqual(decide(outOfRoot, { approvedGuardKeys: new Set(["path:/Users/x/Desktop/poem.txt"]) }), { action: "run" });
  // A DIFFERENT out-of-root key is NOT covered → still asks.
  assert.equal(decide(outOfRoot, { approvedGuardKeys: new Set(["path:/other/file"]) }).action, "ask");
  // A keyless guard (secret / risky shell) is never cacheable, even after 'always'.
  assert.deepEqual(decide(guarded), { action: "ask", cacheable: false, reason: "risky" });
});

test("remember (mutates, not needsApproval) runs in normal mode", () => {
  assert.deepEqual(decide(remember), { action: "run" });
});

test("alwaysAsk (run_bash) re-asks every time — never cached, even after 'always'", () => {
  assert.deepEqual(decide(bash), { action: "ask", cacheable: false });
  // still asks even if it was previously approved ("always")
  assert.deepEqual(decide(bash, { approvedTools: new Set(["run_bash"]) }), { action: "ask", cacheable: false });
  // auto mode + headless still skip it (the user opted out of prompts there)
  assert.deepEqual(decide(bash, { mode: "auto" }), { action: "run" });
  assert.deepEqual(decide(bash, { autoApprove: true }), { action: "run" });
});

test("--dangerously-skip-permissions runs everything, but readonly + catastrophic floors hold", () => {
  // Bypass: the guarded/risky shell and needsApproval tools all just run.
  assert.deepEqual(decide(guarded, { dangerouslySkip: true }), { action: "run" });
  assert.deepEqual(decide(write, { dangerouslySkip: true }), { action: "run" });
  assert.deepEqual(decide(bash, { dangerouslySkip: true }), { action: "run" });
  // Floor 1: an explicit read-only mode STILL blocks mutations even under the bypass (orthogonal).
  assert.equal(decide(write, { dangerouslySkip: true, mode: "readonly" }).action, "deny");
  // (Floor 2 — the catastrophic-pattern refusal — lives in run_bash.run, not the gate.)
});

test("sub-agent gate: readonly + autoApprove denies a guarded out-of-root read, allows in-root", () => {
  // This is exactly how the explorer confines its child (subagent.ts): the SAME tested gate.
  const guardedRead = mk({ name: "read_file", guard: (a) => (String(a.path).includes("..") ? { needsApproval: true, reason: "outside root" } : {}) });
  const child = (args: object) => decideApproval(guardedRead, args, { mode: "readonly", autoApprove: true, approvedTools: new Set<string>(), toolName: "read_file" });
  assert.equal(child({ path: "src/x.ts" }).action, "run"); // in-root → runs
  assert.equal(child({ path: "../../etc/passwd" }).action, "deny"); // out-of-root → hard deny, no prompt
});

test("askUserMessage: selected / dismissed / headless", () => {
  assert.match(askUserMessage("Q?", { label: "npm", description: "uses lockfile" }, true), /selected: "npm" — uses lockfile/);
  assert.match(askUserMessage("Q?", null, true), /dismissed/);
  assert.match(askUserMessage("Q?", null, false), /headless|proceed/i);
});

test("graduated approval: a provably-safe shell call runs without asking (normal mode)", () => {
  assert.deepEqual(decide(bashSafe), { action: "run" });
});
test("graduated approval: a non-safe shell call still asks", () => {
  assert.equal(decide(bashUnsafe).action, "ask");
});
test("graduated approval: a non-safe risky command still hits the guard (asks)", () => {
  // isSafeBash internally excludes risky/dangerous/out-of-root, so a risky command's safeAutoApprove is
  // always false → it falls through to the guard. (A tool can't legitimately be both "safe" and "risky".)
  const risky = mk({ name: "run_bash", needsApproval: true, guard: () => ({ needsApproval: true, reason: "risky" }), safeAutoApprove: () => false });
  assert.deepEqual(decide(risky), { action: "ask", cacheable: false, reason: "risky" });
});
test("graduated approval: read-only mode still blocks even a safe shell call", () => {
  assert.equal(decide(bashSafe, { mode: "readonly" }).action, "deny");
});

test("plan mode: reads run, mutations are blocked (like read-only)", () => {
  assert.deepEqual(decide(read, { mode: "plan" }), { action: "run" });   // exploration reads work
  assert.equal(decide(write, { mode: "plan" }).action, "deny");
  assert.equal(decide(remember, { mode: "plan" }).action, "deny");
  assert.equal(decide(bashUnsafe, { mode: "plan" }).action, "deny");     // a non-safe shell command is blocked
});
test("plan mode: provably-safe read-only shell is allowed (so the agent can explore)", () => {
  assert.deepEqual(decide(bashSafe, { mode: "plan" }), { action: "run" });
});
