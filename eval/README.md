# Eval harness

Measures the agent objectively: runs it on tasks with deterministic checkers and
prints a success rate. This is how we tell if a change (prompt / tool / model)
actually helped — instead of guessing.

The goal is a number you'd **trust to gate a change** — which means it has to (a)
measure the *agent* (its loop, safety gate, memory, compaction, verification), not
just the toolbelt; (b) report **variance**, because the agent is stochastic; and
(c) separate real agent failures from network/harness errors.

## Run it

```bash
npm run eval
# faster dev loop — one repeat, just the tasks whose name matches:
EVAL_REPEATS=1 EVAL_FILTER="permission" npm run eval
# score a different model:
OPENROUTER_MODEL=z-ai/glm-5.2 npm run eval
```

Env knobs: `EVAL_REPEATS` (default 3), `EVAL_CONCURRENCY` (default 3),
`EVAL_FILTER` (substring on task name), `OPENROUTER_MODEL`.

## Files

- **`tasks.ts`** — the suite. Each task is `{ name, group, difficulty, setup?, … , check }`.
- **`harness.ts`** — how a task is run and judged: `runAgent` (spawns the agent
  headless, drives stdin, captures output + trace + exit), `runTask` (repeats +
  PASS/FAIL/ERROR classification), and checker helpers.
- **`fixtures.ts`** — content used by setups (e.g. the `verify.js` check script).
- **`run.ts`** — the orchestrator: runs everything, aggregates, prints the report.

## A task

```ts
{
  name, group, difficulty,
  setup?(dir),                 // create starting files in a fresh temp dir
  prompt | turns | runs,       // what the agent is asked (see below)
  autoApprove?, approve?,      // exercise the permission gate (default: auto-approve)
  env?,                        // per-task env (VERIFY_COMMAND, MAX_CONTEXT_TOKENS, …)
  check(dir, output, trace),   // objective verdict
  maxCalls?,                   // efficiency budget (reported, never fails a task)
}
```

- **`prompt`** — one user turn (the common case).
- **`turns: string[]`** — several user turns in **one** process (e.g. to force a
  long conversation that triggers compaction).
- **`runs: RunSpec[]`** — several **separate** processes in the **same** dir (e.g.
  write a memory in session #1, recall it in a fresh session #2).

### The checker contract: correctness vs. style

`check` returns either a **bare boolean** (correctness) or `{ correct, style }`:

- **`correct`** — did the *world* end up right? This is the **headline score**.
- **`style`** — did it take the *preferred path* (e.g. used `edit_file` not
  `write_file`, or `search` before editing)? Reported **separately** and it
  **never gates the score**.

Why split them? Folding "did it our way" into pass/fail is teaching-to-the-test: a
correct-but-different solution shows as a regression, and you end up tuning the
prompt to satisfy the checker. Keeping `style` non-gating fixes that.

Three kinds of check, in order of preference:
1. **File/output checks** (deterministic) — `file contains "8080"`.
2. **Trace checks** (deterministic) — `usedTool(trace, "edit_file")`, or
   `usedToolWithArg(trace, "read_file", a => a.offset)` to grade *how* a tool was used.
3. **LLM-judge** (`judge(criterion, content)`) — subjective quality only. Noisy, so
   gate it behind a cheap code-check first.

## PASS / FAIL / ERROR

Each run is classified:

- **PASS / FAIL** — the agent ran and the checker decided.
- **ERROR** — the *run* failed, not the agent: non-zero exit, empty output, a
  missing API key, the agent's `[error]` marker (a caught API error), or the
  checker itself throwing. ERRORs are **excluded from the pass-rate** so a flaky
  network never reads as an agent regression.

With `EVAL_REPEATS > 1`, a task that sometimes passes and sometimes fails is marked
**FLAKY** — the honest signal that `n=1` would have hidden.

## Task groups (what's covered)

- **tool** — one capability per tool (read/write/edit/search/list/bash/range, plus
  `web_fetch` reading a URL and `web_search` degrading gracefully with no key).
- **loop** — the agentic control loop, e.g. reacting to a failing auto-check.
- **safety** — the permission gate (a denied destructive command, an approved one)
  and **path confinement** (refusing reads/writes outside the project root).
- **memory** — `remember` + **recall across a fresh session**, and survival across
  context **compaction**.
- **hard** — multi-file refactors with real tests, plausible-wrong traps, restraint
  (don't edit what's already correct), cross-module bugs, ambiguity, under-specified
  requests. These are where a weak vs. strong model actually separate.

## The flywheel (turning real failures into tasks)

1. While using the agent (`npm run dev`), when it does badly, type **`/bad`** — the
   conversation is saved to `eval/failures/`. (`/good` saves to `eval/good/`.)
2. Later, open a saved failure, decide what "correct" would have been, and add a new
   task to `tasks.ts` with a checker that captures it.
3. Re-run `npm run eval`. The new task fails (the bug, pinned). Fix the
   prompt/tool/loop until it passes **and the whole suite still passes**. The task
   stays forever as a guard.

(Raw transcripts in `failures/`/`good/` are gitignored — commit the distilled
*tasks*, not the raw logs.)

## Deferred: self-improvement loop

A GEPA-style loop (reflect on failures → propose a prompt/tool tweak → re-run → keep
only if the score improves, with a **held-out** slice to catch overfitting) is the
planned next phase — worth building only now that the suite is broad enough that
optimizing against it isn't just overfitting a handful of tasks.
```
