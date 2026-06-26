// The eval ORCHESTRATOR: run every task k times, classify each run
// PASS / FAIL / ERROR, and print a report that separates:
//   - correctness (the headline score, with a ± because the agent is stochastic),
//   - path/style  (preferred-path signal — never gates the score),
//   - errors      (harness/network failures — excluded from the rate),
//   - efficiency  (tool calls/run, budgets are informational).
//
// Env knobs:
//   EVAL_REPEATS=3       runs per task (variance — n=1 is just noise)
//   EVAL_CONCURRENCY=3   tasks in flight at once
//   EVAL_FILTER=<substr> only run tasks whose name includes this (dev loop)
//   OPENROUTER_MODEL=…   which model to score

import { TASKS } from "./tasks";
import { runTask, type Status, type TaskOutcome } from "./harness";

try {
  process.loadEnvFile(".env"); // so spawned agents inherit OPENROUTER_API_KEY
} catch {
  // key may already be in the environment
}

const REPEATS = Number(process.env.EVAL_REPEATS) || 3;
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY) || 3;
const FILTER = process.env.EVAL_FILTER ?? "";
const MODEL = process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash";

// --- tiny color (TTY only; children always run with NO_COLOR) ----------------
const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c("32"), red = c("31"), yellow = c("33"), dim = c("2"), bold = c("1");

// Run up to `n` async tasks concurrently, preserving input order in the output.
async function mapPool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const count = (xs: Status[], s: Status) => xs.filter((x) => x === s).length;

// One row's verdict from its per-repeat statuses.
function verdict(o: TaskOutcome): { label: string; paint: (s: string) => string; flaky: boolean } {
  const pass = count(o.statuses, "pass"), fail = count(o.statuses, "fail"), err = count(o.statuses, "error");
  if (err === o.statuses.length) return { label: "ERROR", paint: yellow, flaky: false };
  if (pass > 0 && fail === 0) return { label: "PASS ", paint: green, flaky: false };
  if (pass === 0 && fail > 0) return { label: "FAIL ", paint: red, flaky: false };
  return { label: "FLAKY", paint: yellow, flaky: true }; // some pass, some fail
}

async function main() {
  const tasks = TASKS.filter((t) => t.name.includes(FILTER));
  console.log(
    bold(`\nbeecork eval`) + dim(` — ${tasks.length} tasks × ${REPEATS} repeat(s) · model ${MODEL}\n`),
  );

  const outcomes = await mapPool(tasks, CONCURRENCY, (t) => runTask(t, REPEATS));

  // Aggregates.
  let passRuns = 0, ratedRuns = 0; // ratedRuns = non-errored
  let styleHit = 0, styleTotal = 0;
  let callSum = 0, callRuns = 0, overBudget = 0;
  let errorTasks = 0, flakyTasks = 0, passTasks = 0, failTasks = 0;

  for (const o of outcomes) {
    const v = verdict(o);
    const pass = count(o.statuses, "pass"), fail = count(o.statuses, "fail"), err = count(o.statuses, "error");
    passRuns += pass;
    ratedRuns += pass + fail;
    if (v.flaky) flakyTasks++;
    else if (v.label.trim() === "PASS") passTasks++;
    else if (v.label.trim() === "FAIL") failTasks++;
    if (err > 0) errorTasks++;

    for (const st of o.styles) if (st !== undefined) { styleTotal++; if (st) styleHit++; }
    for (let i = 0; i < o.statuses.length; i++) {
      if (o.statuses[i] !== "error") { callSum += o.calls[i]; callRuns++; if (o.task.maxCalls != null && o.calls[i] > o.task.maxCalls) overBudget++; }
    }

    const tag = dim(`[${(o.task.group ?? "tool").padEnd(6)}]`);
    const rate = pass + fail > 0 ? `${pass}/${pass + fail}` : "—";
    const styleStr = o.styles.some((s) => s !== undefined)
      ? dim(`  style ${o.styles.filter((s) => s).length}/${o.styles.filter((s) => s !== undefined).length}`)
      : "";
    const errStr = err > 0 ? yellow(`  (${err} errored)`) : "";
    console.log(`${tag} ${v.paint(v.label)}  ${o.task.name.padEnd(48)} ${rate}${styleStr}${errStr}`);
    console.log(dim(`         path: ${o.samplePath}`));
  }

  // Report.
  const pct = ratedRuns ? passRuns / ratedRuns : 0;
  const stderr = ratedRuns ? Math.sqrt((pct * (1 - pct)) / ratedRuns) : 0;
  const pp = (x: number) => `${Math.round(x * 100)}%`;
  console.log(bold(`\nCorrectness:`) + ` ${passRuns}/${ratedRuns} runs passed  (${pp(pct)} ± ${pp(stderr)})`);
  console.log(`By task:     ${passTasks} pass · ${failTasks} fail · ${flakyTasks} flaky · ${errorTasks} with errors`);
  if (styleTotal) console.log(`Path/style:  ${styleHit}/${styleTotal} took the preferred path (where checked)`);
  console.log(`Efficiency:  ${callRuns ? (callSum / callRuns).toFixed(1) : "0"} tool calls/run avg · ${overBudget} run(s) over budget`);
  if (errorTasks) console.log(yellow(`Note:        ${errorTasks} task(s) had errored runs — excluded from the rate (likely network/setup, not the agent).`));
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
