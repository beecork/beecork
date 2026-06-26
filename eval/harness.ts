// The eval HARNESS: how we run the agent under test and judge one run.
//
// Three jobs live here:
//   1. runAgent  — spawn the agent headless in a temp dir and capture what it
//      printed + the tool-call trace + how it exited. Includes a REACTIVE stdin
//      feeder (see below) and HOME isolation.
//   2. runTask   — run a whole task (possibly several sequential processes in the
//      same dir), repeat it k times, and classify each run PASS / FAIL / ERROR.
//   3. helpers   — usedTool / usedToolWithArg / judge, used by checkers.
//
// Why a reactive feeder? node's readline hands a line ONLY to a question that is
// already pending. If we pre-write `prompt\nanswer\nexit\n` and the agent is busy
// on the network when those lines arrive, the extra lines fire 'line' events with
// no listener and are silently DROPPED — so a scripted approval answer never
// reaches the [y/n] prompt. The fix: watch the child's stdout and write the NEXT
// line only when the buffer ends with a prompt the child is blocked on
// ("you: " or the approval prompt). NO_COLOR makes those prompts plain text.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TSX = join(process.cwd(), "node_modules/.bin/tsx");
const ENTRY = join(process.cwd(), "src/index.ts");

// Where task temp dirs live. macOS os.tmpdir() is a long, hash-laden
// /var/folders/.../T path; embedded in the agent's "Working directory:" system
// prompt, that specific shape makes some models (e.g. glm-5.2 via some providers)
// return empty/truncated streams ~100% of the time — a measurement artifact that
// has nothing to do with the agent. A short, normal-looking base avoids it.
const TMP_BASE = process.env.EVAL_TMP_BASE ?? (existsSync("/tmp") ? "/tmp" : tmpdir());
const taskTmp = () => mkdtemp(join(TMP_BASE, "agenteval-"));

// The exact prompts the child blocks on (plain text under NO_COLOR).
const USER_PROMPT = "you: ";
const APPROVE_PROMPT = "[a]lways: ";
const RUN_TIMEOUT_MS = Number(process.env.EVAL_RUN_TIMEOUT_MS) || 180_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ToolCall = { tool: string; args: string; step: number };

// A checker returns either a bare boolean (correctness only — the existing 14
// tasks) or {correct, style}: correctness is the headline score, style is a
// SEPARATE non-gating "did it take the preferred path" signal.
export type CheckResult = boolean | { correct: boolean; style?: boolean };

// One agent process: a user prompt (or several `turns` in one process), whether
// the permission gate is active, and how to answer it.
export type RunSpec = {
  prompt?: string; // single user turn
  turns?: string[]; // multiple user turns in ONE process (e.g. to force compaction)
  autoApprove?: boolean; // default true; false exercises the real permission gate
  approve?: "y" | "n" | "a"; // reply to every approval prompt (when autoApprove=false)
  env?: Record<string, string>; // per-run env overrides (VERIFY_COMMAND, MAX_CONTEXT_TOKENS, …)
};

export type Task = {
  name: string;
  group?: "tool" | "loop" | "safety" | "memory" | "hard";
  difficulty?: "easy" | "med" | "hard";
  setup?: (dir: string) => Promise<void>;
  // Single-process tasks set these directly; multi-process tasks use `runs`.
  prompt?: string;
  turns?: string[];
  autoApprove?: boolean;
  approve?: "y" | "n" | "a";
  env?: Record<string, string>;
  runs?: RunSpec[]; // multiple = sequential FRESH processes in the SAME dir
  check: (dir: string, output: string, trace: ToolCall[]) => Promise<CheckResult>;
  maxCalls?: number; // generous efficiency budget (reported, never fails a task)
};

export type RunResult = { output: string; trace: ToolCall[]; exitCode: number | null; errored: boolean };
export type Status = "pass" | "fail" | "error";
export type TaskOutcome = {
  task: Task;
  statuses: Status[]; // one per repeat
  styles: (boolean | undefined)[]; // style verdict per repeat (undefined = N/A)
  calls: number[]; // trace length per repeat
  samplePath: string; // a representative tool path, for the report
};

// ---------------------------------------------------------------------------
// HOME isolation: every spawned agent otherwise reads the developer's real
// ~/.beecork (cork.md + memory.md) via loadInstructions — a confound that can
// make memory tests spuriously pass. Point HOME at one empty temp dir instead.
// ---------------------------------------------------------------------------
let isolatedHome: string | null = null;
async function getIsolatedHome(): Promise<string> {
  if (!isolatedHome) isolatedHome = await mkdtemp(join(tmpdir(), "agenteval-home-"));
  return isolatedHome;
}

// Build the child's environment. Centralized so the AUTO_APPROVE truthiness trap
// (Boolean("0") === true) can't be made per-task: to DISABLE the gate we delete
// the var entirely; to enable headless we set it to "1".
function childEnv(spec: RunSpec, home: string, tracePath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", TRACE_FILE: tracePath, HOME: home };
  const autoApprove = spec.autoApprove ?? true;
  if (autoApprove) env.AUTO_APPROVE = "1";
  else delete env.AUTO_APPROVE; // gate ON — never set it to "0"
  return { ...env, ...spec.env };
}

// Run ONE agent process in `dir`. Reactive feeder drives stdin; on close we read
// the trace file the agent wrote, and decide whether the RUN itself errored
// (crash / missing key / caught API error) vs. simply produced a wrong answer.
export async function runAgent(dir: string, spec: RunSpec): Promise<RunResult> {
  const home = await getIsolatedHome();
  const tracePath = dir + ".trace.json"; // sibling, not inside the task dir
  const userLines = spec.turns ?? (spec.prompt != null ? [spec.prompt] : []);
  const approve = spec.approve ?? "n"; // default deny if asked unexpectedly

  return new Promise<RunResult>((resolve) => {
    const child = spawn(TSX, [ENTRY], { cwd: dir, env: childEnv(spec, home, tracePath) });

    let out = "";
    let buf = ""; // rolling tail used only for prompt detection
    let next = 0; // index of the next user line to send
    let done = false;

    const kill = () => {
      if (!child.killed) child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      out += "\n[harness: run timed out]";
      kill();
    }, RUN_TIMEOUT_MS);

    // Act only when the child is BLOCKED on a known prompt (buffer ends with it).
    const onChunk = (chunk: Buffer) => {
      const s = chunk.toString();
      out += s;
      buf += s;
      if (buf.endsWith(APPROVE_PROMPT)) {
        child.stdin.write(approve + "\n");
        buf = ""; // consumed — wait for fresh output before acting again
      } else if (buf.endsWith(USER_PROMPT)) {
        // Send "exit" as a normal line, NOT stdin.end(): the REPL breaks cleanly
        // and writes its trace + prints "bye!". Calling end() while a question is
        // already PENDING abandons that promise (the loop empties and the child
        // exits 0) BEFORE the trace is written — so the run would look tool-less.
        child.stdin.write(next < userLines.length ? userLines[next++] + "\n" : "exit\n");
        buf = "";
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", (d) => (out += d.toString())); // stderr: errors, not prompts

    child.on("close", async (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      let trace: ToolCall[] = [];
      try {
        trace = JSON.parse(await readFile(tracePath, "utf8"));
      } catch {
        // no trace (made no tool calls, or crashed before writing it)
      }
      await rm(tracePath, { force: true });
      const noOp = trace.length === 0 && !/bot: /.test(out); // agent did nothing: no tools, no answer
      const errored =
        code !== 0 ||
        out.trim() === "" ||
        /No OpenRouter API key/.test(out) || // the agent's missing-key message (index.ts)
        /\[error\] /.test(out) || // runTurn's caught-API-error marker
        noOp; // an empty/no-op turn is an infra failure, not a wrong answer → ERROR not FAIL
      resolve({ output: out, trace, exitCode: code, errored });
    });
  });
}

// ---------------------------------------------------------------------------
// Running a whole task: setup → run (1+ processes, same dir) → check → classify.
// ---------------------------------------------------------------------------
function specsFor(task: Task): RunSpec[] {
  if (task.runs) return task.runs;
  return [{ prompt: task.prompt, turns: task.turns, autoApprove: task.autoApprove, approve: task.approve, env: task.env }];
}

function normalize(res: CheckResult): { correct: boolean; style?: boolean } {
  return typeof res === "boolean" ? { correct: res } : res;
}

// One attempt at a task. ERROR (not FAIL) when any run errored or the checker
// threw — so a flaky network never masquerades as an agent regression.
async function runOnce(task: Task): Promise<{ status: Status; style?: boolean; calls: number; path: string }> {
  const dir = await taskTmp();
  try {
    if (task.setup) await task.setup(dir);
    let last: RunResult | null = null;
    for (const spec of specsFor(task)) {
      last = await runAgent(dir, spec);
      if (last.errored) {
        return { status: "error", calls: last.trace.length, path: pathOf(last.trace) };
      }
    }
    if (!last) return { status: "error", calls: 0, path: "(no run)" };

    let result: CheckResult;
    try {
      result = await task.check(dir, last.output, last.trace);
    } catch {
      return { status: "error", calls: last.trace.length, path: pathOf(last.trace) }; // checker threw
    }
    const { correct, style } = normalize(result);
    return { status: correct ? "pass" : "fail", style, calls: last.trace.length, path: pathOf(last.trace) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const pathOf = (trace: ToolCall[]) => (trace.length ? trace.map((t) => t.tool).join(" → ") : "(no tools)");

// Run a task `repeats` times and gather the outcomes.
export async function runTask(task: Task, repeats: number): Promise<TaskOutcome> {
  const statuses: Status[] = [];
  const styles: (boolean | undefined)[] = [];
  const calls: number[] = [];
  let samplePath = "(no tools)";
  for (let i = 0; i < repeats; i++) {
    const r = await runOnce(task);
    statuses.push(r.status);
    styles.push(r.style);
    calls.push(r.calls);
    samplePath = r.path;
  }
  return { task, statuses, styles, calls, samplePath };
}

// ---------------------------------------------------------------------------
// Checker helpers
// ---------------------------------------------------------------------------
export const usedTool = (trace: ToolCall[], name: string) => trace.some((t) => t.tool === name);

// Was a tool called with arguments matching a predicate? (trace.args is a JSON
// string — agent records call.function.arguments verbatim.) Lets a checker grade
// HOW a tool was used, e.g. read_file with an offset/limit (a real ranged read).
export const usedToolWithArg = (trace: ToolCall[], name: string, pred: (args: any) => boolean) =>
  trace.some((t) => {
    if (t.tool !== name) return false;
    try {
      return pred(JSON.parse(t.args));
    } catch {
      return false;
    }
  });

// LLM-as-judge: ask the model PASS/FAIL on a subjective criterion. NOISY — use
// only when a code-check can't express the criterion, and gate it behind a cheap
// code-check first.
export async function judge(criterion: string, content: string): Promise<boolean> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash",
      messages: [
        { role: "system", content: "You are a strict grader. Reply with ONLY the word PASS or FAIL." },
        { role: "user", content: `Criterion: ${criterion}\n\n--- content ---\n${content}\n--- end ---\n\nDoes the content meet the criterion?` },
      ],
    }),
  });
  const verdict = ((await res.json()).choices?.[0]?.message?.content ?? "").toUpperCase();
  return verdict.includes("PASS");
}
