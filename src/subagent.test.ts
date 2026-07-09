// Sub-agent tests: the pure exploreLoop driven by FAKE deps (no network/fs), plus the read-only /
// depth-1 allow-list guarantee and the restricted-dispatch airtightness. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { exploreLoop, EXPLORER_TOOLS, type ExploreDeps } from "./subagent";
import { runTool, toolDefs } from "./tools";
import type { Message, ToolCall, ToolDef } from "./types";

const tc = (name: string, args: object, id = "c1"): ToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const asst = (content: string | null, tool_calls?: ToolCall[]): Message => ({ role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) });

// A deps factory: `script` yields the model's responses in order; dispatch/gate are configurable.
function fakeDeps(script: Message[], over: Partial<ExploreDeps> = {}): ExploreDeps & { dispatched: ToolCall[] } {
  let i = 0;
  const dispatched: ToolCall[] = [];
  return {
    dispatched,
    call: async () => script[i++] ?? asst("(no more)"),
    dispatch: async (c) => { dispatched.push(c); return `result of ${c.function.name}`; },
    gate: () => ({ ok: true }),
    maxSteps: 10,
    ...over,
  };
}

test("exploreLoop: tool call → dispatched → final text returned", async () => {
  const deps = fakeDeps([asst(null, [tc("read_file", { path: "a.ts" })]), asst("Findings: a.ts does X.")]);
  const out = await exploreLoop(deps, "what does a.ts do", undefined);
  assert.equal(out, "Findings: a.ts does X.");
  assert.equal(deps.dispatched.length, 1);
  assert.equal(deps.dispatched[0].function.name, "read_file");
});

test("exploreLoop: a denied tool is NOT dispatched; the denial is fed back", async () => {
  const deps = fakeDeps(
    [asst(null, [tc("read_file", { path: "../../etc/passwd" })]), asst("I could not read that; here is what I found in-root.")],
    { gate: (name, args) => (String(args.path).includes("..") ? { ok: false, reason: "out of root" } : { ok: true }) },
  );
  const out = await exploreLoop(deps, "read secrets", undefined);
  assert.match(out, /could not read/);
  assert.equal(deps.dispatched.length, 0, "denied call must never reach dispatch");
});

test("exploreLoop: budget exhausted → one no-tools wrap-up call, its text returned", async () => {
  let lastInclude: boolean | undefined;
  const deps = fakeDeps([], {
    maxSteps: 2,
    call: async (_m, includeTools) => { lastInclude = includeTools; return includeTools ? asst(null, [tc("search", { pattern: "x" })]) : asst("Summary after budget."); },
  });
  const out = await exploreLoop(deps, "find x", undefined);
  assert.equal(out, "Summary after budget.");
  assert.equal(lastInclude, false, "wrap-up call must disable tools");
});

test("exploreLoop: empty completion and abort → sentinels", async () => {
  const empty = fakeDeps([], { maxSteps: 3, call: async (_m, incl) => (incl ? asst(null) : asst("wrapped")) });
  assert.equal(await exploreLoop(empty, "t", undefined), "wrapped"); // empty tool-call turn → wrap-up
  const ac = new AbortController();
  ac.abort();
  const out = await exploreLoop(fakeDeps([asst("x")]), "t", undefined, ac.signal);
  assert.match(out, /cancelled/);
});

test("allow-list: exactly the 5 read/web tools, and NO mutating tool or `explore`", () => {
  assert.deepEqual([...EXPLORER_TOOLS].sort(), ["list_dir", "read_file", "search", "web_fetch", "web_search"]);
  for (const banned of ["write_file", "edit_file", "run_bash", "remember", "update_todos", "ask_user", "explore"]) {
    assert.ok(!EXPLORER_TOOLS.has(banned), `${banned} must NOT be available to the explorer`);
  }
});

test("restricted dispatch map is airtight: an emitted write_file → unknown tool, never runs", async () => {
  const childByName = new Map<string, ToolDef>(toolDefs.filter((t) => EXPLORER_TOOLS.has(t.name)).map((t) => [t.name, t]));
  const res = await runTool(tc("write_file", { path: "x", content: "y" }), undefined, childByName);
  assert.match(res, /unknown tool/i);
});
