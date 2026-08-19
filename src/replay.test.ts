// DETERMINISTIC WHOLE-AGENT TESTS ("replay").
//
// The middle layer beecork was missing: unit tests check pure functions, evals check a real model
// against the real world, and neither catches a LIFECYCLE bug — work that happened but got forgotten,
// a tool pair that lost its partner, a cancel that corrupted history. These drive the REAL runTurn
// with a scripted model (src/scripted.ts) in a real temp workspace, then assert BOTH sides:
// what the filesystem says happened, and what the transcript says happened. A lifecycle bug is
// exactly a disagreement between those two.
//
// process.chdir BEFORE importing: paths.ts freezes projectRoot from cwd at import time, so the
// imports below are dynamic on purpose. Run with: npm test

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const workspace = mkdtempSync(join(tmpdir(), "beecork-replay-"));
const originalCwd = process.cwd();
process.chdir(workspace);

const { runTurn } = await import("./agent");
const { config } = await import("./config");
const { state } = await import("./state");
const { installScriptedModel } = await import("./scripted");
const { probeSandbox } = await import("./sandbox");
const { resetLearnedCeilings, contextBudget } = await import("./context");

// A provider-confirmed overflow HALVES this model's budget for the rest of the PROCESS. Without this
// hook the two overflow tests below left every later test running at a quarter of the real budget
// (measured: 32000 vs 128000), so execution order silently changed what any later test measured.
// It also gives resetLearnedCeilings its only caller — it was a test-only export nothing called.
afterEach(() => resetLearnedCeilings());
const { runExplorer } = await import("./subagent");
const { startJournal, flushJournal, journalPath, resetJournalForTests, record } = await import("./journal");
import type { ScriptStep } from "./scripted";
import type { Message } from "./types";

// Headless, deterministic: no approval prompts, one API attempt (so a scripted failure fails
// immediately instead of consuming three steps), no post-edit verify command.
config.autoApprove = true;
config.retryAttempts = 1;
config.verifyCommand = "";
state.apiKey = "test-key";
state.mode = "normal";

process.on("exit", () => {
  process.chdir(originalCwd);
  rmSync(workspace, { recursive: true, force: true });
});

const neverAsk = async () => {
  throw new Error("the gate asked for approval in a headless test");
};

// Drive one turn against a script. Returns the conversation runTurn handed back — i.e. what would
// be persisted and what the NEXT turn would send to the model.
//
// The agent narrates to stdout; under `node --test` that raw output interleaves with the TAP stream
// and corrupts it, so it is swallowed for the duration of the turn (and restored even on throw).
// `abortAtCall` aborts just before the Nth model call — the deterministic stand-in for Ctrl-C.
async function turn(
  steps: ScriptStep[],
  input: string,
  opts: { abortAtCall?: number; steering?: string[]; live?: Message[] } = {},
) {
  const ac = new AbortController();
  const model = installScriptedModel(steps, {
    onRequest: (i) => {
      if (opts.abortAtCall !== undefined && i === opts.abortAtCall) ac.abort();
    },
  });

  // `live` is the array the CALLER keeps holding — index.ts's crash handler persists this exact
  // reference, so tests can assert on it, not just on what runTurn returns.
  const messages: Message[] = opts.live ?? [{ role: "system", content: "sys" }];
  try {
    const { value: out, narration } = await silenced(() =>
      runTurn(messages, input, neverAsk, new Set<string>(), new Set<string>(), ac.signal, opts.steering),
    );
    return { out, model, narration, live: messages };
  } finally {
    model.restore();
  }
}

// Swallow the agent's narration for the duration of `fn`, and hand it back.
//
// The yield FIRST is load-bearing: node:test flushes a finished test's TAP block on a later tick, so
// without it the previous test's own result line lands in this capture and vanishes — the run then
// silently reports one test FEWER than it ran. (That is exactly what happened when a second test
// grew its own copy of this logic without the yield.) Every stdout swallow in this file goes
// through here.
async function silenced<T>(fn: () => Promise<T>): Promise<{ value: T; narration: string }> {
  await new Promise((r) => setTimeout(r, 0));
  const realWrite = process.stdout.write;
  const realLog = console.log;
  const realError = console.error;
  let narration = "";
  const capture = (x: unknown) => { narration += String(x); return true; };
  process.stdout.write = capture as typeof process.stdout.write;
  console.log = (...a: unknown[]) => capture(a.join(" ") + "\n");
  console.error = (...a: unknown[]) => capture(a.join(" ") + "\n");
  try {
    return { value: await fn(), narration };
  } finally {
    process.stdout.write = realWrite;
    console.log = realLog;
    console.error = realError;
  }
}

const toolResults = (msgs: Message[]) => msgs.filter((m) => m.role === "tool");
const callIds = (msgs: Message[]) => msgs.flatMap((m) => (m.role === "assistant" ? (m.tool_calls ?? []).map((t) => t.id) : []));

// Every assistant tool_call must have exactly one matching tool result, or the provider 400s on the
// next request. This is the invariant the old rollback protected by throwing the turn away; the point
// of the change is to hold it WITHOUT discarding work.
function assertProviderValid(msgs: Message[]) {
  const answered = new Set(msgs.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
  for (const id of callIds(msgs)) {
    assert.ok(answered.has(id), `tool_call ${id} has no matching tool result — the provider would reject this`);
  }
  for (const m of msgs.filter((m) => m.role === "tool")) {
    assert.ok(callIds(msgs).includes(m.tool_call_id!), `tool result ${m.tool_call_id} answers no call`);
  }
}

// ---------------------------------------------------------------------------
// The headline regression: a completed side effect must not vanish from history
// because a LATER model request failed.
// ---------------------------------------------------------------------------

test("edit succeeds, next model request fails → the edit stays in history", async () => {
  const { out } = await turn(
    [
      { tools: [{ id: "c1", name: "write_file", args: { path: "api.ts", content: "export const x = 1;\n" } }] },
      { httpError: 500 }, // the follow-up request dies AFTER the write already landed
    ],
    "create api.ts",
  );

  // The world: the file really was written.
  assert.ok(existsSync(join(workspace, "api.ts")), "the tool actually wrote the file");
  assert.match(readFileSync(join(workspace, "api.ts"), "utf8"), /export const x = 1;/);

  // The record: history must agree with the world.
  assert.equal(callIds(out).length, 1, "the assistant's tool call survived the failed follow-up");
  assert.equal(toolResults(out).length, 1, "the write's result survived the failed follow-up");
  assertProviderValid(out);
});

test("cancel after an edit → the edit stays in history and stays provider-valid", async () => {
  const { out } = await turn(
    [
      { tools: [{ id: "c1", name: "write_file", args: { path: "cancelled.ts", content: "kept\n" } }] },
      { text: "unreachable — the user cancels before this lands" },
    ],
    "write then cancel",
    { abortAtCall: 1 }, // Ctrl-C just before the SECOND model call, i.e. after the write finished
  );

  assert.ok(existsSync(join(workspace, "cancelled.ts")), "the write landed before the cancel");
  assert.equal(toolResults(out).length, 1, "a cancel must not erase a completed write");
  assertProviderValid(out);
});

// ---------------------------------------------------------------------------
// The crash-save path. index.ts persists the array reference it passed IN, so anything that swaps
// the conversation for a new array mid-turn silently truncates what a SIGTERM would save.
// ---------------------------------------------------------------------------

test("mid-turn compaction keeps the caller's array live (what a SIGTERM would persist)", async () => {
  const live: Message[] = [{ role: "system", content: "sys" }];
  // Force compaction on every step: a tiny budget makes estimateTokens exceed it immediately.
  const realBudget = config.maxContextTokens;
  config.maxContextTokens = 1;
  try {
    // Pad history so there is something old enough for compactionStart to summarize.
    for (let i = 0; i < 6; i++) {
      live.push({ role: "user", content: `earlier question ${i}` });
      live.push({ role: "assistant", content: `earlier answer ${i}` });
    }
    const { out } = await turn(
      [
        { tools: [{ id: "c1", name: "write_file", args: { path: "compacted.ts", content: "kept\n" } }] },
        { text: "Done." },
      ],
      "write compacted.ts",
      { live },
    );

    assert.ok(existsSync(join(workspace, "compacted.ts")), "the write landed");
    // The caller's reference must reflect the turn — not the pre-compaction snapshot of it.
    assert.equal(toolResults(live).length, 1, "the caller's array still holds the turn's tool result");
    assert.deepEqual(live, out, "runTurn's return and the caller's live array agree");
    assertProviderValid(live);
  } finally {
    config.maxContextTokens = realBudget;
  }
});

test("a clean turn is unchanged: tool call, result, then a text answer", async () => {
  const { out } = await turn(
    [
      { tools: [{ id: "c1", name: "write_file", args: { path: "clean.ts", content: "ok\n" } }] },
      { text: "Done — created clean.ts." },
    ],
    "create clean.ts",
  );

  assert.ok(existsSync(join(workspace, "clean.ts")));
  assertProviderValid(out);
  assert.equal(out[out.length - 1].role, "assistant");
  assert.match(String(out[out.length - 1].content), /Done/);
});

// ---------------------------------------------------------------------------
// Context-overflow recovery. Our token count is an ESTIMATE, so a provider can refuse a prompt we
// believed fit. That must become a bounded recovery, not a dead turn — and it must stay bounded.
// ---------------------------------------------------------------------------

test("a provider-confirmed overflow compacts harder and retries exactly ONCE", async () => {
  const { out, model } = await turn(
    [
      { httpError: 400, body: '{"error":{"message":"This model maximum context length is 32768 tokens"}}' },
      { text: "Recovered and answered." }, // the retry succeeds
    ],
    "say something",
  );

  assert.equal(model.consumed(), 2, "one failed call + exactly one retry");
  assert.equal(out[out.length - 1].role, "assistant");
  assert.match(String(out[out.length - 1].content), /Recovered/);
  assertProviderValid(out);
});

test("a SECOND overflow ends the turn instead of looping — and keeps the work", async () => {
  const overflow = {
    httpError: 400,
    body: '{"error":{"message":"prompt is too long: 200000 tokens > 32768 maximum"}}',
  } as const;

  const { out, model } = await turn(
    [
      { tools: [{ id: "c1", name: "write_file", args: { path: "overflowed.ts", content: "kept\n" } }] },
      overflow, // first overflow → recovery fires
      overflow, // the retry ALSO overflows → must give up, not compact again
    ],
    "write then overflow twice",
  );

  assert.equal(model.consumed(), 3, "no third retry — the recovery is once per turn, not per call");
  assert.ok(existsSync(join(workspace, "overflowed.ts")), "the write landed before the overflow");
  assert.equal(toolResults(out).length, 1, "giving up must still keep the completed write");
  assertProviderValid(out);
});

test("an unrelated 400 is NOT treated as an overflow (no wasted retry, real error surfaces)", async () => {
  const { out, model, narration } = await turn(
    [{ httpError: 400, body: '{"error":{"message":"No endpoints found matching your data policy"}}' }],
    "say something",
  );

  assert.equal(model.consumed(), 1, "a non-overflow 400 must not trigger the compact-and-retry path");
  assert.match(narration, /data policy/, "the real error is shown to the user, not swallowed");
  assert.equal(out.length, 2, "system + the user's message; nothing invented");
});

// ---------------------------------------------------------------------------
// The tool scheduler: what the model sees must not depend on how the work was scheduled.
// ---------------------------------------------------------------------------

test("parallel reads are committed in the model's CALL order, not completion order", async () => {
  // Three files whose read times differ (by size), so completion order won't match call order.
  writeFileSync(join(workspace, "slow.txt"), "s".repeat(200_000));
  writeFileSync(join(workspace, "mid.txt"), "m".repeat(20_000));
  writeFileSync(join(workspace, "fast.txt"), "f");

  const { out } = await turn(
    [
      {
        tools: [
          { id: "c1", name: "read_file", args: { path: "slow.txt" } },
          { id: "c2", name: "read_file", args: { path: "mid.txt" } },
          { id: "c3", name: "read_file", args: { path: "fast.txt" } },
        ],
      },
      { text: "Read all three." },
    ],
    "read three files",
  );

  const ids = toolResults(out).map((m) => m.tool_call_id);
  assert.deepEqual(ids, ["c1", "c2", "c3"], "results follow the order the model asked for");
  assertProviderValid(out);
});

test("a batch larger than the concurrency cap still completes, in order", async () => {
  const n = config.maxParallelTools * 2 + 3; // spans several chunks, with a ragged last one
  for (let i = 0; i < n; i++) writeFileSync(join(workspace, `f${i}.txt`), `contents ${i}`);

  const { out } = await turn(
    [
      { tools: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: "read_file", args: { path: `f${i}.txt` } })) },
      { text: "Read them all." },
    ],
    "read many files",
  );

  assert.deepEqual(
    toolResults(out).map((m) => m.tool_call_id),
    Array.from({ length: n }, (_, i) => `p${i}`),
    "chunking must not reorder or drop results",
  );
  assertProviderValid(out);
});

// ---------------------------------------------------------------------------
// Structured outcomes: beecork must not decide anything from how a result is WORDED.
// ---------------------------------------------------------------------------

test("a SUCCESSFUL read whose contents start with 'Error' is not mislabelled a failure", async () => {
  writeFileSync(join(workspace, "log.txt"), "Error budget: 3 remaining\nError rate: 0.1%\n");

  const { out, narration } = await turn(
    [
      { tools: [{ id: "c1", name: "read_file", args: { path: "log.txt" } }] },
      { text: "Read the log." },
    ],
    "read log.txt",
  );

  assert.match(String(toolResults(out)[0].content), /Error budget/, "the contents reach the model intact");
  assert.doesNotMatch(narration, /✗ failed/, "a successful read must not render as a failed call");
});

test("an unknown tool fails as data (NOT_FOUND), and the turn carries on", async () => {
  const { out } = await turn(
    [
      { tools: [{ id: "c1", name: "no_such_tool", args: {} }] },
      { text: "That tool does not exist." },
    ],
    "call a bogus tool",
  );

  assert.match(String(toolResults(out)[0].content), /^Error: unknown tool/, "the model is told, in words");
  assertProviderValid(out);
});

// ---------------------------------------------------------------------------
// The execution journal. The transcript answers "what should the model see next?"; the journal
// answers "what did this agent actually do?" — including the things a transcript structurally
// cannot say: how a turn ENDED, what was approved, and which failure code a tool returned.
// ---------------------------------------------------------------------------

async function journalOf(fn: () => Promise<unknown>): Promise<any[]> {
  resetJournalForTests();
  await startJournal("test/model");
  await fn();
  await flushJournal();
  const path = journalPath()!;
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("the journal records a completed turn: session, turn, step, tool, outcome, end", async () => {
  const rows = await journalOf(() =>
    turn(
      [
        { tools: [{ id: "c1", name: "write_file", args: { path: "journaled.ts", content: "ok\n" } }] },
        { text: "Done." },
      ],
      "write journaled.ts",
    ),
  );

  const types = rows.map((r) => r.type);
  for (const expected of ["session_started", "turn_started", "step_started", "tool_started", "tool_finished", "turn_finished"]) {
    assert.ok(types.includes(expected), `journal is missing ${expected} (got ${types.join(", ")})`);
  }

  // seq is contiguous and ordered — that is what makes the file replayable rather than just a log.
  assert.deepEqual(rows.map((r) => r.seq), rows.map((_, i) => i + 1));
  assert.ok(rows.every((r) => r.v === 1 && typeof r.time === "string"));

  const finished = rows.find((r) => r.type === "tool_finished");
  assert.equal(finished.name, "write_file");
  assert.equal(finished.ok, true);
  assert.equal(typeof finished.ms, "number");

  assert.equal(rows.at(-1).type, "turn_finished");
  assert.equal(rows.at(-1).status, "completed", "a turn that answered is recorded as completed");
});

test("a turn that ERRORS is recorded as error — the outcome is data, not a missing message", async () => {
  const rows = await journalOf(() =>
    turn(
      [
        { tools: [{ id: "c1", name: "write_file", args: { path: "journal-err.ts", content: "kept\n" } }] },
        { httpError: 500 },
      ],
      "write then fail",
    ),
  );

  // The completed side effect is in the record even though the turn died after it.
  const finished = rows.find((r) => r.type === "tool_finished");
  assert.equal(finished.ok, true, "the write really succeeded, and the record says so");

  const end = rows.at(-1);
  assert.equal(end.type, "turn_finished");
  assert.equal(end.status, "error");
  assert.match(String(end.error), /500/, "the reason the turn ended is recorded, not just that it did");
});

test("a CANCELLED turn is recorded as cancelled", async () => {
  const rows = await journalOf(() =>
    turn(
      [
        { tools: [{ id: "c1", name: "write_file", args: { path: "journal-cancel.ts", content: "kept\n" } }] },
        { text: "never reached" },
      ],
      "write then cancel",
      { abortAtCall: 1 },
    ),
  );
  assert.equal(rows.at(-1).status, "cancelled");
});

test("the journal never stores full tool output — it is a record, not a second copy", async () => {
  writeFileSync(join(workspace, "big.txt"), "PAYLOAD".repeat(5000));
  const rows = await journalOf(() =>
    turn(
      [
        { tools: [{ id: "c1", name: "read_file", args: { path: "big.txt" } }] },
        { text: "Read it." },
      ],
      "read big.txt",
    ),
  );
  const finished = rows.find((r) => r.type === "tool_finished");
  assert.ok(finished.summary.length < 400, `summary should be bounded, got ${finished.summary.length} chars`);
});

// ---------------------------------------------------------------------------
// The sandbox, reached the way the MODEL reaches it: through a real run_bash tool call in a real
// turn. The unit tests prove the profile confines; this proves the profile is actually applied.
// ---------------------------------------------------------------------------

// Gate on CONFINEMENT BEING AVAILABLE, not on platform. The kernel assertions below are the only
// thing that proves the sandbox confines anything, and gating them on macOS meant they ALL skipped on
// the Linux CI runner — where bwrap isn't installed either, so nothing exercised the sandbox at all
// and the suite was green with zero confinement.
const confined = (await probeSandbox()).kind === "active";

test("a LITERAL out-of-project path is stopped by policy, before the sandbox is even needed", async () => {
  const escape = join(homedir(), `.beecork-replay-literal-${process.pid}`);
  rmSync(escape, { force: true });
  try {
    const { out } = await turn(
      [
        { tools: [{ id: "c1", name: "run_bash", args: { command: `echo pwned > ${JSON.stringify(escape)}`, explanation: "escape attempt" } }] },
        { text: "Tried." },
      ],
      "write outside the project",
    );
    assert.equal(existsSync(escape), false);
    assert.match(String(toolResults(out)[0].content), /Blocked/, "the out-of-root guard sees the literal path");
  } finally {
    rmSync(escape, { force: true });
  }
});

test("REAL (confined): a command with NO path text still can't escape — policy is blind here, the kernel isn't", { skip: !confined }, async () => {
  // The whole argument for having a sandbox at all, in one command.
  //
  // beecork's out-of-root guard is a TEXTUAL heuristic: it expands $HOME, $PWD, ${IFS} and ~, then
  // looks for absolute paths and ../ escapes. A bare `cd` contains none of those — and goes straight
  // to the user's home directory. There is nothing for a parser to find, so the guard correctly lets
  // it through. Only something that judges the write by its DESTINATION can stop it.
  const escape = join(homedir(), `.beecork-replay-escape-${process.pid}`);
  rmSync(escape, { force: true });
  try {
    const { out } = await turn(
      [
        {
          tools: [{
            id: "c1",
            name: "run_bash",
            args: { command: `cd && echo pwned > .beecork-replay-escape-${process.pid}`, explanation: "no path text at all" },
          }],
        },
        { text: "Tried." },
      ],
      "write outside the project the sneaky way",
    );

    const result = String(toolResults(out)[0].content);
    assert.doesNotMatch(result, /Blocked/, "policy cannot see this one — that is the premise of the test");
    assert.equal(existsSync(escape), false, "the OS must refuse the write that policy could not judge");
    assert.match(result, /^Error/, "and the model is told it failed");
  } finally {
    rmSync(escape, { force: true });
  }
});

test("REAL (confined): a model-issued run_bash CAN still write inside the workspace", { skip: !confined }, async () => {
  const { out } = await turn(
    [
      { tools: [{ id: "c1", name: "run_bash", args: { command: "echo hello > sandboxed.txt", explanation: "normal write" } }] },
      { text: "Wrote it." },
    ],
    "write inside the project",
  );

  assert.ok(existsSync(join(workspace, "sandboxed.txt")), "ordinary in-project work must be unaffected");
  assert.doesNotMatch(String(toolResults(out)[0].content), /^Error/);
});

// ---------------------------------------------------------------------------
// The `explore` sub-agent, driven end to end. subagent.test.ts exercises runTool directly, which is
// exactly why a bug in runExplorer's OWN dispatch (it fed every tool result back through
// splitResult, yielding `undefined` text) survived a green suite. Drive the real child loop.
// ---------------------------------------------------------------------------

test("the explore sub-agent passes REAL tool text to its child model", async () => {
  writeFileSync(join(workspace, "explored.txt"), "DISTINCTIVE-CONTENT-42");

  const model = installScriptedModel([
    // The child reads a file…
    { tools: [{ id: "e1", name: "read_file", args: { path: "explored.txt" } }] },
    // …then answers. Its answer is the explorer's return value.
    { text: "The file contains DISTINCTIVE-CONTENT-42." },
  ]);
  try {
    const { value: report } = await silenced(() => runExplorer("what is in explored.txt?", undefined, undefined));
    assert.match(report, /DISTINCTIVE-CONTENT-42/, "the explorer reports what it actually read");

    // The regression itself: whatever the child was SHOWN must be the file's real contents.
    const childSawToolResult = model.requests
      .flatMap((r) => (r.messages ?? []) as { role?: string; content?: unknown }[])
      .filter((m) => m.role === "tool")
      .map((m) => String(m.content));
    assert.ok(childSawToolResult.length > 0, "the child model was given a tool result");
    for (const c of childSawToolResult) {
      assert.notEqual(c, "undefined", "the child must never be handed the string 'undefined'");
    }
    assert.ok(
      childSawToolResult.some((c) => c.includes("DISTINCTIVE-CONTENT-42")),
      `the child must see the file's real contents, got: ${JSON.stringify(childSawToolResult)}`,
    );
  } finally {
    model.restore();
  }
});

// ---------------------------------------------------------------------------
// The post-edit auto-check. Two properties worth protecting: it runs ONCE per assistant message
// (after the LAST edit), not once per edit — a 5-edit batch must not run five typechecks — and its
// pass/fail verdict is now DATA (runVerify returns {ok, text}) rather than re-derived by reading the
// first word of its own output back.
// ---------------------------------------------------------------------------

test("auto-check runs ONCE after a multi-edit batch, and its verdict is data", async () => {
  const counter = join(workspace, "verify-runs.txt");
  rmSync(counter, { force: true });
  const prev = config.verifyCommand;
  // Records each invocation, then fails — so we can assert on BOTH the count and the failure path.
  config.verifyCommand = `echo ran >> ${JSON.stringify(counter)}; exit 1`;
  try {
    const { out, narration } = await turn(
      [
        {
          tools: [
            { id: "v1", name: "write_file", args: { path: "v-a.ts", content: "a\n" } },
            { id: "v2", name: "write_file", args: { path: "v-b.ts", content: "b\n" } },
            { id: "v3", name: "write_file", args: { path: "v-c.ts", content: "c\n" } },
          ],
        },
        { text: "Wrote three files." },
      ],
      "write three files",
    );

    const runs = readFileSync(counter, "utf8").trim().split("\n").filter(Boolean).length;
    assert.equal(runs, 1, `the auto-check must run once for the whole batch, ran ${runs}×`);

    // The failing verdict reaches the model, attached to the LAST edit's result.
    const lastEdit = toolResults(out).find((m) => m.tool_call_id === "v3");
    assert.match(String(lastEdit!.content), /auto-check/, "the check's output is attached to the last edit");
    assert.match(String(lastEdit!.content), /FAILED/, "and the model is told it failed");
    assert.doesNotMatch(String(toolResults(out).find((m) => m.tool_call_id === "v1")!.content), /auto-check/);

    assert.match(narration, /✗ failed/, "and the user sees a failed chip, from the verdict not the wording");
  } finally {
    config.verifyCommand = prev;
    rmSync(counter, { force: true });
  }
});

test("an empty completion ends the turn — it is NOT a step-limit turn", async () => {
  // `messages.pop(); break;` left `answered` false, so the loop fell into the step-cap branch:
  // an extra billed model call, narration that contradicted itself ("empty response" then
  // "reached the 50-step limit" at step 0), and a journal row claiming status "step_limit".
  const rows = await journalOf(() => turn([{}, { text: "unreachable wrap-up" }], "say nothing"));
  const model = rows; // journalOf returns the parsed journal
  const end = model.at(-1);
  assert.equal(end.type, "turn_finished");
  assert.equal(end.status, "empty", "the journal must say what actually happened");
});

test("an empty completion does not issue a second, billed model call", async () => {
  const { model, narration } = await turn([{}, { text: "unreachable wrap-up" }], "say nothing");
  assert.equal(model.consumed(), 1, "the wrap-up call must not fire — the model just said nothing");
  assert.match(narration, /empty response/);
  assert.doesNotMatch(narration, /step limit/, "…and the narration must not contradict itself");
});


// ---------------------------------------------------------------------------
// The journal's own stated invariant: SUMMARIES, never full payloads.
// ---------------------------------------------------------------------------

test("record() bounds free text — including fields nobody remembered to wrap (audit M4)", async () => {
  resetJournalForTests();
  await startJournal("test/model");
  record({ type: "turn_started", turnId: "t1", input: "x".repeat(50_000) });
  // The one that matters most: api.ts builds this from `await response.text()`, so it is the ENTIRE
  // provider response body — remote-controlled and unbounded, in a file that promises summaries.
  record({ type: "turn_finished", turnId: "t1", status: "error", steps: 1, error: "HTTP 400: " + "y".repeat(100_000) });
  await flushJournal();
  const rows = readFileSync(journalPath()!, "utf8").trim().split("\n").map((l) => JSON.parse(l));

  const started = rows.find((r) => r.type === "turn_started");
  assert.ok(started.input.length < 1100, `prompt must be capped, got ${started.input.length}`);
  assert.match(started.input, /…\[\+\d+\]$/, "…and marked, so a truncated row is not mistaken for a complete one");

  const finished = rows.find((r) => r.type === "turn_finished");
  assert.ok(finished.error.length < 600, `provider body must be capped, got ${finished.error.length}`);

  // Identity fields are never touched — truncating one would break replay correlation.
  assert.equal(finished.turnId, "t1");
  assert.equal(finished.status, "error");
});

test("a NEW journal field is bounded by default, not by remembering (audit M4)", async () => {
  resetJournalForTests();
  await startJournal("test/model");
  // The invariant itself, not today's three fields: the old shape applied brief() at three call
  // sites and forgot three others. Cast in a field that does not exist yet.
  record({ type: "step_started", turnId: "t1", step: 0, somethingNew: "z".repeat(9000) } as never);
  await flushJournal();
  const row = readFileSync(journalPath()!, "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
  assert.ok(row.somethingNew.length < 600, `an unanticipated field must still be bounded, got ${row.somethingNew.length}`);
});

test("a learned context ceiling does not leak into later tests", () => {
  // Pins the afterEach hook above: without it the overflow tests halve the budget for the rest of the
  // process, and everything after them silently measures against a quarter of the real window.
  // Keyed by MODEL — assert on the one the overflow tests actually poisoned (state.model), not a
  // name they never touch, or this test passes whether or not the hook exists.
  assert.equal(contextBudget(state.model), config.maxContextTokens, "the budget must start clean in each test");
});
