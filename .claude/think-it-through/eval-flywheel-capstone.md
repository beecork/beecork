# Eval Flywheel + Self-Improvement Capstone

_Brief for the beecork project (formerly "cliagent"; CLI coding agent, `src/index.ts`). Status: in progress._

## Intention

We have a tiny eval harness. We want to widen it toward the mainstream 2026 best practice — the **"eval flywheel" / Eval-Driven Development** — and then put a **self-improvement loop** on top. Goal is primarily **learning** (understand each piece by building it), keeping our ethos: build slowly, minimal dependencies, understand every line.

**Scope decision (made):**
- **NOW:** trace evals + flywheel hook (+ start growing the suite).
- **LATER:** the self-improvement loop — deferred until the suite is broad enough to be meaningful (on a 3-task suite it would just overfit; building it now buys understanding, not capability). Captured below as a future plan.

## How it is now (verified — we built it this session)

- `eval/run.ts` (+ `npm run eval`): a `TASKS` array of `{name, prompt, setup, check}`. For each task it makes a temp dir, runs the agent as a headless subprocess (`spawn tsx src/index.ts`, `AUTO_APPROVE=1`, `NO_COLOR=1`), then a **deterministic checker** inspects the files/output. Prints PASS/FAIL + a success rate. Got 3/3 on 3 easy tasks.
- `src/index.ts`: the agent — 7 tools, permissions + `AUTO_APPROVE` headless mode, streaming, multi-model, context compaction, planning todos, retry/loop-detect/graceful-cap, an auto-verify hook.
- **What it checks today:** only the **final output** (file contents, printed answer). Deterministic only. No judge. No trace. No real-usage loop.

## What the June-2026 research says (the standard we're matching)

- Our "failures → tasks → growing suite" IS the standard **"eval flywheel"** ("every failure becomes a test case, every fix validated"). Our "TDD for agents" = recognized **Eval-Driven Development** (green suite = ship gate). **Validated.**
- **Golden dataset** best from production logs; 20–50 to start, 50–200 to run on every change; re-run whole suite vs a baseline; set **regression-tolerance thresholds**.
- **Biggest gap in ours: trace/trajectory evals.** Grade *how* the agent worked (right tools, right inputs, right number of steps) — not just the final file. A correct file produced in 40 wasteful steps should not score full marks.
- **LLM-as-judge** is needed for subjective quality BUT is **unreliable** (RAND 2026: no judge uniformly reliable; >50% error on hard cases; breaks on formatting/paraphrasing). Use code-checks first; judges only where necessary, calibrated against human labels + stress-tested.
- **Observability is its own pillar**: offline golden-dataset evals + runtime guardrails + production tracing/drift. The "watch real conversations + 👍/👎" idea is this pillar — complements, doesn't replace, the golden set.
- **Overfitting is a documented hazard** ("When 'Better' Prompts Hurt"). Mitigate with regression tolerance + **held-out slices** the optimizer can't see.
- **Self-improvement is mature**: **GEPA** (ICLR 2026, on **DSPy**) does exactly reflect-on-failures → evolve prompt/tool-descriptions → evaluate → keep-if-better; ~$2–10/run; beats RL by ~20% with 35× fewer rollouts. Confirms: **self-improvement is only as good as the eval underneath it.**

## The four pieces (with pros/cons) — to build

### 1. Trace-level evals (the biggest gap)
Check the trajectory, not just the result: which tools were called, with what, how many steps.
- **Pros:** closes the #1 gap; catches "right answer, wrong/wasteful path"; cheap (we already print the tool trace — just capture + assert on it).
- **Cons:** trajectory assertions can be brittle (many valid paths exist); must assert loosely (e.g. "used edit_file, not write_file" / "≤ N steps") not exact sequences.

### 2. Flywheel / observability hook
Log each real conversation; capture 👍/👎; a 👎 can be turned into a new eval task.
- **Pros:** the mature core pattern; makes the suite grow from reality; directly uses the "watch real usage" instinct.
- **Cons:** turning a messy real convo into a clean checkable task needs a human (or a careful step); storage/format decisions.

### 3. Self-improvement loop (GEPA-style) — DEFERRED (build later, once suite is bigger)
Reflect on failing tasks → propose a system-prompt (and/or tool-description) tweak → re-run the eval → keep only if score improved (and no regressions).
- **Pros:** the capstone; demystifies GEPA; genuinely useful once the suite grows.
- **Cons:** **overfits a tiny suite** (will "improve" the 3 tasks while maybe hurting real use); needs guardrails; extra LLM calls/cost.

### 4. Overfitting guardrails
Held-out slice (tasks the optimizer never sees, used only to detect overfitting); keep-change-only-if-improves; regression tolerance.
- **Pros:** the thing that makes #3 safe/honest.
- **Cons:** with a tiny suite, the held-out set is also tiny → weak signal (a known limitation we accept for the learning version).

## Risks

- **Overfitting** is the headline risk for #3 on our small suite. We accept it for learning, mitigate with held-out tasks, and note the score is "directionally educational, not production-trustworthy" until the suite grows.
- **Judge unreliability** if we add #2-judge — keep deterministic-first.

## Decisions (resolved)

- **Scope now:** trace evals + flywheel hook. Self-improver deferred.
- **Flywheel:** minimal + honest — slash commands mark 👍/👎 and save 👎 transcripts to `eval/failures/`; a human converts each into a task (writes the checker) later. (Fully automatic conversion is unreliable because the checker is bespoke.)
- **Checker types:** support BOTH — deterministic code-checks (primary: files / trace / output) AND an optional **LLM-judge** checker for subjective tasks. Deterministic-first; judge used sparingly and treated as noisy.
- **Self-improver (LATER):** our own minimal GEPA-style version (reflect on failures → tweak system prompt → re-run eval → keep-if-better), with a held-out slice. System prompt first; tool descriptions later. Build once the suite is broad enough to be worth optimizing against.

## v1 build order (NOW)

1. **Trace capture** — the headless agent emits a machine-readable trace of its tool calls (names + step count) that the eval can read.
2. **Trace checkers** — `check` helpers that assert on the trace (e.g. "used `edit_file` not `write_file`", "≤ N steps").
3. **Judge checker (optional type)** — a checker that calls the model to grade a subjective task; deterministic-first, used sparingly.
4. **Flywheel capture** — `/good` `/bad` slash commands that save the current conversation transcript (👎 → `eval/failures/`).
5. **Grow the suite** — add a couple of harder / trace-based tasks; document how to turn a saved failure into a task.

## Decision & next step

**GO** — build v1 (steps 1–5) now, slowly, one piece at a time (build → explain → show → test), keeping minimal deps. The self-improvement loop is documented as the next phase, to build once the suite is broad enough to be worth optimizing against.
